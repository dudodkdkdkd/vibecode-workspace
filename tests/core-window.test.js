// Run on macOS: node --test tests/core-window.test.js
// Flow tests use a scripted UI; widget tests build the real NSAlert views and replace only
// the single place that shows a window (present), like the project-selection tests do.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const windowSource = fs.readFileSync(path.join(root, 'core', 'window.js'), 'utf8');
const library = windowSource.split('function run(argv)')[0];
const PRESENT = 'function present(alert, widgets) {\n    return alert.runModal;\n}';
assert.ok(library.includes(PRESENT), 'present() hook changed: update the test harness');

function jxa(source, args = []) {
    return execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-', ...args], {
        input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
}

const STATE = (overrides = {}) => Object.assign({
    workspaces: [
        { name: 'Patigon', projects: ['A', 'B'], shortcut: true, missing: [] },
        { name: 'Solo', projects: ['B'], shortcut: false, missing: [] },
    ],
    projects: ['A', 'B', 'C'],
    entries: [{ id: 'setup', title: 'Einrichten' }, { id: 'remote', title: 'Remote' }],
}, overrides);

// ------------------------------------------------------------------ Ablauf

function flowRun(script) {
    return JSON.parse(jxa(`${library}
const script = ${JSON.stringify(script)};
const calls = [];
const next = (key) => {
    if (!(script[key] || []).length) throw new Error('Missing scripted answer: ' + key);
    return script[key].shift();
};
const ui = {
    main: (state, selected) => { calls.push(['main', selected]); return next('main'); },
    edit: (state, draft, existing, message) => { calls.push(['edit', draft, existing && existing.name, message]); return next('edit'); },
    more: (entries) => { calls.push(['more', entries.map((entry) => entry.id)]); return next('more'); },
    confirmDelete: (name) => { calls.push(['confirmDelete', name]); return next('confirmDelete'); },
    info: (text) => calls.push(['info', text]),
    error: (text) => calls.push(['error', text]),
};
const backend = {
    state: () => { calls.push(['state']); return script.state; },
    save: (workspace) => { calls.push(['save', workspace]); const failure = (script.saveErrors || []).shift(); if (failure) throw new Error(failure); },
    remove: (name) => calls.push(['remove', name]),
    start: (name) => calls.push(['start', name]),
    open: (id) => calls.push(['open', id]),
    syncShortcuts: () => { calls.push(['sync']); return '2 Shortcuts erneuert.'; },
};
function run() { flow(ui, backend); return JSON.stringify(calls); }
`));
}

const kinds = (calls) => calls.map((call) => call[0]);

test('Starten startet den gewählten Workspace und schließt das Fenster', () => {
    const calls = flowRun({ state: STATE(), main: [{ action: 'start', name: 'Solo' }] });
    assert.deepEqual(calls.filter((c) => c[0] !== 'state'), [['main', null], ['start', 'Solo']]);
});

test('Neuer Workspace: Namenskonflikt zeigt die Meldung und behält alle Eingaben', () => {
    const draft = { name: 'Patigon', projects: ['A'], shortcut: true };
    const calls = flowRun({
        state: STATE(),
        main: [{ action: 'new', name: 'Solo' }, { action: 'close' }],
        edit: [draft, Object.assign({}, draft, { name: 'Patigon 2' })],
        saveErrors: ['execution error: VibeCode: Es gibt schon einen Workspace „Patigon“. (1)'],
    });
    const edits = calls.filter((c) => c[0] === 'edit');
    assert.equal(edits.length, 2);
    assert.equal(edits[0][3], '');
    assert.deepEqual(edits[1][1], draft);                       // Eingaben bleiben stehen
    assert.match(edits[1][3], /^Es gibt schon einen Workspace „Patigon“\./);   // ohne Fehlerpräfix
    assert.deepEqual(calls.filter((c) => c[0] === 'save').map((c) => c[1].name), ['Patigon', 'Patigon 2']);
    assert.deepEqual(calls.find((c) => c[0] === 'main' && c[1]), ['main', 'Patigon 2']);   // neu gespeicherter vorgewählt
});

test('Bearbeiten übergibt den alten Namen zum Umbenennen', () => {
    const calls = flowRun({
        state: STATE(),
        main: [{ action: 'edit', name: 'Solo' }, { action: 'close' }],
        edit: [{ name: 'Allein', projects: ['B'], shortcut: true }],
    });
    assert.deepEqual(calls.find((c) => c[0] === 'save')[1],
        { name: 'Allein', projects: ['B'], shortcut: true, renameFrom: 'Solo' });
    assert.equal(calls.find((c) => c[0] === 'edit')[2], 'Solo');
});

test('Abbrechen im Editor speichert nichts', () => {
    const calls = flowRun({
        state: STATE(), main: [{ action: 'edit', name: 'Solo' }, { action: 'close' }], edit: [null],
    });
    assert.ok(!kinds(calls).includes('save'));
});

test('Löschen verlangt eine Bestätigung; bei Nein wird weiter bearbeitet', () => {
    const calls = flowRun({
        state: STATE(),
        main: [{ action: 'edit', name: 'Solo' }, { action: 'close' }],
        edit: [{ remove: true }, { remove: true }],
        confirmDelete: [false, true],
    });
    assert.deepEqual(kinds(calls).filter((k) => ['confirmDelete', 'remove', 'edit'].includes(k)),
        ['edit', 'confirmDelete', 'edit', 'confirmDelete', 'remove']);
    assert.deepEqual(calls.find((c) => c[0] === 'remove'), ['remove', 'Solo']);
});

test('ohne bekannte Projekte erklärt das Fenster, was zu tun ist, statt einen leeren Editor zu zeigen', () => {
    const calls = flowRun({
        state: STATE({ projects: [] }), main: [{ action: 'new', name: null }, { action: 'close' }],
    });
    assert.ok(!kinds(calls).includes('edit'));
    assert.match(calls.find((c) => c[0] === 'error')[1], /Repository-Ordner/);
});

test('Mehr öffnet Modul-Einträge oder erneuert die Shortcuts', () => {
    const calls = flowRun({
        state: STATE(), main: [{ action: 'more' }, { action: 'more' }, { action: 'more' }, { action: 'close' }],
        more: ['remote', 'sync', null],
    });
    assert.deepEqual(calls.find((c) => c[0] === 'more'), ['more', ['setup', 'remote']]);
    assert.deepEqual(calls.find((c) => c[0] === 'open'), ['open', 'remote']);
    assert.deepEqual(calls.find((c) => c[0] === 'info'), ['info', '2 Shortcuts erneuert.']);
});

test('ein Fehler beim Start oder Speichern beendet das Fenster nicht', () => {
    const calls = flowRun({
        state: STATE(), main: [{ action: 'more' }, { action: 'close' }], more: ['setup'],
    });
    assert.ok(kinds(calls).includes('open'));            // sauberer Durchlauf als Gegenprobe
});

// ------------------------------------------------------------------ Widgets

function widgets(body, prelude = '') {
    return jxa(`${library.replace(PRESENT, 'function present(alert, widgets) { return scriptedPresent(alert, widgets); }')}
const titles = (alert) => { const out = []; for (let i = 0; i < alert.buttons.count; i += 1) out.push(ObjC.unwrap(alert.buttons.objectAtIndex(i).title)); return out; };
const STATE = ${JSON.stringify(STATE())};
const FIRST = Number($.NSAlertFirstButtonReturn);   // the bridged constant would concatenate as text with "+"
${prelude}
function run() { ${body} }
`);
}

test('Hauptfenster: Zusammenfassung, Workspace-Auswahl und Schaltflächen', () => {
    const out = JSON.parse(widgets(`
        const built = buildMain(STATE, 'Solo');
        const empty = buildMain({ workspaces: [], projects: [], entries: [] });
        return JSON.stringify({
            text: ObjC.unwrap(built.alert.informativeText),
            popup: Array.from({ length: built.popup.numberOfItems }, (_, i) => ObjC.unwrap(built.popup.itemTitleAtIndex(i))),
            selected: ObjC.unwrap(built.popup.titleOfSelectedItem),
            buttons: titles(built.alert),
            picked: [collectMain(built, FIRST), collectMain(built, FIRST + 1), collectMain(built, FIRST + 4), collectMain(built, FIRST + 5)],
            emptyButtons: titles(empty.alert), emptyPopup: empty.popup === null,
            emptyText: ObjC.unwrap(empty.alert.informativeText),
            emptyPick: collectMain(empty, FIRST),
        });`));
    assert.equal(out.text, 'Patigon: A, B · Schreibtisch ✓\nSolo: B · kein Shortcut');
    assert.deepEqual(out.popup, ['Patigon', 'Solo']);
    assert.equal(out.selected, 'Solo');
    assert.deepEqual(out.buttons, ['Starten', 'Bearbeiten…', 'Neuer Workspace…', 'Mehr…', 'Schließen']);
    assert.deepEqual(out.picked, [{ action: 'start', name: 'Solo' }, { action: 'edit', name: 'Solo' },
        { action: 'close', name: 'Solo' }, null]);   // außerhalb der Schaltflächen: nichts
    assert.deepEqual(out.emptyButtons, ['Neuer Workspace…', 'Mehr…', 'Schließen']);
    assert.ok(out.emptyPopup);
    assert.match(out.emptyText, /Noch kein Workspace/);
    assert.deepEqual(out.emptyPick, { action: 'new', name: null });
});

test('Hauptfenster warnt, wenn ein Projekt des Workspaces nicht mehr existiert', () => {
    const text = widgets(`
        const state = { workspaces: [{ name: 'Alt', projects: ['A', 'weg'], shortcut: true, missing: ['weg'] }], projects: ['A'], entries: [] };
        return ObjC.unwrap(buildMain(state, null).alert.informativeText);`);
    assert.equal(text, 'Alt: A, weg · Schreibtisch ✓ · ⚠︎ nicht gefunden: weg');
});

test('Editor: echte Checkboxen, vorbelegt, fehlende Projekte sichtbar, Eingaben auslesbar', () => {
    const out = JSON.parse(widgets(`
        const existing = STATE.workspaces[0];
        const draft = { name: 'Für Patigon', projects: ['B', 'weg'], shortcut: true };
        const built = buildEdit(STATE, draft, existing, '');
        const before = collectEdit(built);
        built.boxes[0].performClick(null);       // A an
        built.boxes[1].performClick(null);       // B aus
        built.shortcut.performClick(null);       // Shortcut aus
        built.field.stringValue = $('  Neuer Name  ');
        return JSON.stringify({
            rows: built.boxes.map((box) => ObjC.unwrap(box.title)),
            before, after: collectEdit(built),
            buttons: titles(built.alert), title: ObjC.unwrap(built.alert.messageText),
            fresh: titles(buildEdit(STATE, { name: '', projects: [], shortcut: false }, null, '').alert),
        });`));
    assert.deepEqual(out.rows, ['A', 'B', 'C', 'weg (nicht gefunden)']);
    assert.deepEqual(out.before, { name: 'Für Patigon', projects: ['B', 'weg'], shortcut: true });
    assert.deepEqual(out.after, { name: 'Neuer Name', projects: ['A', 'weg'], shortcut: false });
    assert.deepEqual(out.buttons, ['Speichern', 'Abbrechen', 'Löschen…']);
    assert.deepEqual(out.fresh, ['Speichern', 'Abbrechen']);
    assert.equal(out.title, 'Workspace „Patigon“ bearbeiten');
});

test('Editor verlangt Name und mindestens ein Projekt, bevor gespeichert wird', () => {
    const out = JSON.parse(widgets(`
        steps.push({ response: FIRST },                                   // nichts eingegeben
            { response: FIRST, name: 'Neu' },                             // Name, aber kein Projekt
            { response: FIRST, clicks: [2] });                            // Projekt C, Name bleibt
        const result = nativeUi({}).edit(STATE, { name: '', projects: [], shortcut: false }, null, '');
        return JSON.stringify({ result, notes });`, `
        const steps = [];
        const notes = [];
        function scriptedPresent(alert, built) {
            notes.push(ObjC.unwrap(alert.informativeText));
            const step = steps.shift();
            if (step.name) built.field.stringValue = $(step.name);
            for (const index of step.clicks || []) built.boxes[index].performClick(null);
            return step.response;
        }`));
    assert.deepEqual(out.result, { name: 'Neu', projects: ['C'], shortcut: false });
    assert.equal(out.notes.length, 3);
    assert.equal(out.notes[1], 'Gib dem Workspace einen Namen.');
    assert.equal(out.notes[2], 'Wähle mindestens ein Projekt aus.');
});

test('Editor: Abbrechen und Löschen liefern die richtigen Signale', () => {
    const out = JSON.parse(widgets(`
        const ui = nativeUi({});
        const existing = STATE.workspaces[1];
        const draft = { name: 'Solo', projects: ['B'], shortcut: false };
        response = FIRST + 1; const cancelled = ui.edit(STATE, draft, existing, '');
        response = FIRST + 2; const removed = ui.edit(STATE, draft, existing, '');
        response = FIRST; const confirmed = ui.confirmDelete('Solo');
        response = FIRST + 1; const refused = ui.confirmDelete('Solo');
        return JSON.stringify({ cancelled, removed, confirmed, refused });`, `
        let response;
        function scriptedPresent() { return response; }`));
    assert.deepEqual(out, { cancelled: null, removed: { remove: true }, confirmed: true, refused: false });
});

test('Mehr: Modul-Titel werden zu Befehlen, "Shortcuts erneuern" zu sync, Zurück zu null', () => {
    const out = JSON.parse(widgets(`
        let chosen;
        const app = { chooseFromList: (items) => { app.items = items; return chosen; } };
        const ui = nativeUi(app);
        chosen = ['Remote']; const remote = ui.more(STATE.entries);
        chosen = ['Schreibtisch-Shortcuts erneuern']; const sync = ui.more(STATE.entries);
        chosen = false; const back = ui.more(STATE.entries);
        return JSON.stringify({ remote, sync, back, items: app.items });`));
    assert.deepEqual(out, { remote: 'remote', sync: 'sync', back: null,
        items: ['Einrichten', 'Remote', 'Schreibtisch-Shortcuts erneuern'] });
});

// ------------------------------------------------------------------ Verbindung zu vibecode.py

test('Aufrufe an vibecode.py: Argumente werden einzeln und sicher gequotet', () => {
    const commands = JSON.parse(jxa(`${library}
const seen = [];
const app = { doShellScript: (command) => { seen.push(command); return '{"workspaces":[],"projects":[],"entries":[]}'; } };
function run() {
    const backend = makeBackend(app, '/usr/bin/python3', '/pfad mit leerzeichen/vibecode.py');
    backend.state();
    backend.save({ name: "O'Brien", projects: ['A b', '-x'], shortcut: true, renameFrom: 'Alt' });
    backend.save({ name: 'Ohne', projects: ['A'], shortcut: false, renameFrom: null });
    backend.remove('-seltsam'); backend.start('S'); backend.open('remote'); backend.syncShortcuts();
    return JSON.stringify(seen);
}`));
    const base = "'/usr/bin/python3' '/pfad mit leerzeichen/vibecode.py'";
    assert.deepEqual(commands, [
        `${base} '_state'`,
        `${base} 'save' '--name=O'\\''Brien' '--project=A b' '--project=-x' '--shortcut' '--rename-from=Alt'`,
        `${base} 'save' '--name=Ohne' '--project=A' '--no-shortcut'`,
        `${base} 'delete' '--name=-seltsam'`,
        `${base} 'start' '--name=S'`,
        `${base} 'open' 'remote'`,
        `${base} 'shortcuts' 'sync'`,
    ]);
});

test('echter Roundtrip über doShellScript: Umlaute, Hochkomma und & kommen unverändert an', (t) => {
    const dir = fs.mkdtempSync('/private/tmp/vibecode-test-');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const fake = path.join(dir, 'fake core', 'vibecode.py');
    fs.mkdirSync(path.dirname(fake));
    fs.writeFileSync(fake, `import json, sys
if sys.argv[1] == '_state':
    print(json.dumps({'workspaces': [], 'projects': [], 'entries': [], 'echo': sys.argv[1:]}, ensure_ascii=False))
else:
    print(json.dumps(sys.argv[1:], ensure_ascii=False))
`);
    const name = "Für 'Patigon' & Co \"x\"";
    const result = JSON.parse(jxa(`${library}
function run(argv) {
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    const backend = makeBackend(app, argv[0], argv[1]);
    return JSON.stringify({ state: backend.state(),
        saved: JSON.parse(backend.save({ name: ${JSON.stringify(name)}, projects: ['Ä b'], shortcut: true, renameFrom: null })) });
}`, [execFileSync('/usr/bin/which', ['python3'], { encoding: 'utf8' }).trim(), fake]));
    assert.deepEqual(result.state.workspaces, []);
    assert.deepEqual(result.saved, ['save', `--name=${name}`, '--project=Ä b', '--shortcut']);
});

test('Fehlermeldungen von vibecode.py werden ohne technisches Präfix angezeigt', () => {
    const out = JSON.parse(jxa(`${library}
function run() {
    return JSON.stringify([
        cleanMessage(new Error('execution error: Error: VibeCode: Es gibt schon einen Workspace. (1)')),
        cleanMessage(new Error('Irgendwas anderes')), cleanMessage('nur Text')]);
}`));
    assert.deepEqual(out, ['Es gibt schon einen Workspace. (1)', 'Irgendwas anderes', 'nur Text']);
});
