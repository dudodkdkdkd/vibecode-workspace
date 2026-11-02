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
const PRESENT_DASHBOARD = library.slice(library.indexOf('function presentDashboard(built) {'),
    library.indexOf('function nativeUi(app) {')).trim();
assert.ok(PRESENT_DASHBOARD.startsWith('function presentDashboard') && PRESENT_DASHBOARD.endsWith('}'),
    'presentDashboard() hook changed: update the test harness');

function jxa(source, args = []) {
    return execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-', ...args], {
        input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
}

const STATE = (overrides = {}) => Object.assign({
    workspaces: [
        { name: 'Demo', projects: ['A', 'B'], shortcut: true, missing: [] },
        { name: 'Solo', projects: ['B'], shortcut: false, missing: [] },
    ],
    projects: ['A', 'B', 'C'],
    entries: [{ id: 'setup', title: 'Einrichten', status: { text: '3 Projekte eingerichtet', level: 'ok' } },
        { id: 'remote', title: 'Remote', status: { text: 'Wachhalten AUS', level: 'off' } },
        { id: 'launch', title: 'Auswählen', status: null }],
}, overrides);

const SSH = {
    available: true, guided: true, share: true, errors: [],
    hosts: [{ host: 'spark', root: '~/projects', repos: 12 }],
    mac: { user: 'user', host: 'remote-mac.local', port: 22 },
};
const SPARK = { kind: 'host', name: 'spark', title: 'spark', detail: '~/projects · 12 Repositories',
    label: 'spark — ~/projects · 12 Repositories' };
const REMOTE_MAC = { kind: 'mac', name: 'remote-mac.local', title: 'user@remote-mac.local', detail: 'Mac · direkter Zugang',
    label: 'user@remote-mac.local (Mac)' };
const SSH_JSON = JSON.stringify(SSH);
const ssh = (overrides = {}) => STATE({ ssh: Object.assign({}, SSH, overrides) });
const result = (code, out, err = '') => ({ code, out, err });
const FOLDERS = {
    canAddLocal: true, canAddRemote: true, errors: [],
    local: [{ path: '/Users/example/Github', exists: true, repos: 14, truncated: false },
        { path: '/Volumes/Alt', exists: false, repos: 0, truncated: false },
        { path: '/Users/example/leer', exists: true, repos: 0, truncated: false },
        { path: '/Users/example/riesig', exists: true, repos: 1, truncated: true }],
    remote: [{ host: 'spark', root: '~/projects', repos: 12 }, { host: 'studio', root: '/srv', repos: 0 }],
};
const TERM = (name, type = 'Shell', prompt = '', cwd = '') => ({ name, type, prompt, cwd });
const PRESETS = {
    available: true, errors: [],
    defaults: { local: [TERM('Frontend', 'Eigener Befehl', 'npm run dev', 'frontend'), TERM('Claude', 'Claude Code')],
        remote: [TERM('Shell')] },
    repos: [{ name: 'alpha', path: '/g/alpha', remote: false, custom: true },
        { name: 'beta', path: '/g/beta', remote: false, custom: false },
        { name: 'r [SSH: spark]', path: 'vscode-remote://ssh-remote+spark/h/r', remote: true, custom: false }],
    items: [{ name: 'alpha', path: '/g/alpha', remote: false,
        terminals: [TERM('Dev', 'Eigener Befehl', 'npm run dev', 'frontend'), TERM('Agent', 'Claude Code')], urls: ['http://localhost:5173'] }],
    orphans: [{ name: 'moved', path: '/alt/moved', terminals: [TERM('Shell')], urls: [], suggestion: { name: 'moved', path: '/neu/moved' } },
        { name: 'lost', path: '/alt/lost', terminals: [], urls: ['http://a.test', 'http://b.test'], suggestion: null }],
};
const withPresets = (overrides = {}) => STATE({ presets: Object.assign({}, PRESETS, overrides) });
const withFolders = (overrides = {}) => STATE({ folders: Object.assign({}, FOLDERS, overrides) });
const ok = (message, warning = null) => ({ message, warning });

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
    dashboard: (state) => { calls.push(['dashboard']); return next('dashboard'); },
    edit: (state, draft, existing, message) => { calls.push(['edit', draft, existing && existing.name, message]); return next('edit'); },
    confirmDelete: (name) => { calls.push(['confirmDelete', name]); return next('confirmDelete'); },
    info: (text) => calls.push(['info', text]),
    error: (text) => calls.push(['error', text]),
    newKind: (kinds) => { calls.push(['newKind', kinds]); return next('newKind'); },
    askLine: (title) => { calls.push(['askLine', title]); return next('askLine'); },
    share: (output) => { calls.push(['share', output]); return next('share'); },
    confirmAllow: (name, fingerprint) => { calls.push(['confirmAllow', name, fingerprint]); return next('confirmAllow'); },
    pickFolders: () => { calls.push(['pickFolders']); return next('pickFolders'); },
    askRemoteFolder: (note) => { calls.push(['askRemoteFolder', note]); return next('askRemoteFolder'); },
    confirmRemoveFolder: (label) => { calls.push(['confirmRemoveFolder', label]); return next('confirmRemoveFolder'); },
    editPreset: (repo, draft, custom, note) => { calls.push(['editPreset', repo.name, draft, custom, note]); return next('editPreset'); },
    pickRepo: (repos) => { calls.push(['pickRepo', repos.map((repo) => repo.name)]); return next('pickRepo'); },
    confirmResetPreset: (label) => { calls.push(['confirmResetPreset', label]); return next('confirmResetPreset'); },
    confirmMovePreset: (label, target) => { calls.push(['confirmMovePreset', label, target]); return next('confirmMovePreset'); },
};
const backend = {
    state: () => { calls.push(['state']); return script.state; },
    save: (workspace) => { calls.push(['save', workspace]); const failure = (script.saveErrors || []).shift(); if (failure) throw new Error(failure); },
    remove: (name) => calls.push(['remove', name]),
    start: (name) => { calls.push(['start', name]); if (script.startError) throw new Error(script.startError); },
    open: (id) => { calls.push(['open', id]); if (script.openError) throw new Error(script.openError); },
    syncShortcuts: () => { calls.push(['sync']); return '2 Shortcuts erneuert.'; },
    folder: (action, options) => {
        calls.push(['folder', action, options]);
        const answer = next('folderResults');
        if (answer && answer.throw) throw new Error(answer.throw);
        return answer;
    },
    preset: (action, options) => {
        calls.push(['preset', action, options]);
        const answer = next('presetResults');
        if (answer && answer.throw) throw new Error(answer.throw);
        return answer;
    },
    sshOpen: (kind, name) => calls.push(['sshOpen', kind, name || null]),
    ssh: (action, line) => { calls.push(['ssh', action, line === undefined ? null : line]); return next('sshResults'); },
};
function run() { flow(ui, backend); return JSON.stringify(calls); }
`));
}

const kinds = (calls) => calls.map((call) => call[0]);

test('Starten startet den gewählten Workspace und schließt das Fenster', () => {
    const calls = flowRun({ state: STATE(), dashboard: [{ action: 'start', name: 'Solo' }] });
    assert.deepEqual(calls.filter((c) => c[0] !== 'state'), [['dashboard'], ['start', 'Solo']]);
});

test('Neuer Workspace: Namenskonflikt zeigt die Meldung und behält alle Eingaben', () => {
    const draft = { name: 'Demo', projects: ['A'], shortcut: true };
    const calls = flowRun({
        state: STATE(),
        dashboard: [{ action: 'new' }, { action: 'close' }],
        edit: [draft, Object.assign({}, draft, { name: 'Demo 2' })],
        saveErrors: ['execution error: VibeCode: Es gibt schon einen Workspace „Demo“. (1)'],
    });
    const edits = calls.filter((c) => c[0] === 'edit');
    assert.equal(edits.length, 2);
    assert.equal(edits[0][3], '');
    assert.deepEqual(edits[1][1], draft);                       // Eingaben bleiben stehen
    assert.match(edits[1][3], /^Es gibt schon einen Workspace „Demo“\./);   // ohne Fehlerpräfix
    assert.deepEqual(calls.filter((c) => c[0] === 'save').map((c) => c[1].name), ['Demo', 'Demo 2']);
    assert.equal(kinds(calls).filter((k) => k === 'dashboard').length, 2);      // danach zurück zur Übersicht
});

test('Bearbeiten übergibt den alten Namen zum Umbenennen', () => {
    const calls = flowRun({
        state: STATE(),
        dashboard: [{ action: 'edit', name: 'Solo' }, { action: 'close' }],
        edit: [{ name: 'Allein', projects: ['B'], shortcut: true }],
    });
    assert.deepEqual(calls.find((c) => c[0] === 'save')[1],
        { name: 'Allein', projects: ['B'], shortcut: true, renameFrom: 'Solo' });
    assert.equal(calls.find((c) => c[0] === 'edit')[2], 'Solo');
});

test('Abbrechen im Editor speichert nichts', () => {
    const calls = flowRun({
        state: STATE(), dashboard: [{ action: 'edit', name: 'Solo' }, { action: 'close' }], edit: [null],
    });
    assert.ok(!kinds(calls).includes('save'));
});

test('Löschen verlangt eine Bestätigung; bei Nein wird weiter bearbeitet', () => {
    const calls = flowRun({
        state: STATE(),
        dashboard: [{ action: 'edit', name: 'Solo' }, { action: 'close' }],
        edit: [{ remove: true }, { remove: true }],
        confirmDelete: [false, true],
    });
    assert.deepEqual(kinds(calls).filter((k) => ['confirmDelete', 'remove', 'edit'].includes(k)),
        ['edit', 'confirmDelete', 'edit', 'confirmDelete', 'remove']);
    assert.deepEqual(calls.find((c) => c[0] === 'remove'), ['remove', 'Solo']);
});

test('ohne bekannte Projekte erklärt das Fenster, was zu tun ist, statt einen leeren Editor zu zeigen', () => {
    const calls = flowRun({
        state: STATE({ projects: [] }), dashboard: [{ action: 'new' }, { action: 'close' }],
    });
    assert.ok(!kinds(calls).includes('edit'));
    assert.match(calls.find((c) => c[0] === 'error')[1], /Repository-Ordner/);
});

test('Öffnen startet das Modul im Terminal und schließt das Fenster', () => {
    const calls = flowRun({ state: STATE(), dashboard: [{ action: 'open', id: 'remote' }] });
    assert.deepEqual(calls.find((c) => c[0] === 'open'), ['open', 'remote']);
    assert.equal(kinds(calls).filter((k) => k === 'dashboard').length, 1);
});

test('Shortcuts erneuern zeigt das Ergebnis und bleibt in der Übersicht', () => {
    const calls = flowRun({ state: STATE(), dashboard: [{ action: 'sync' }, { action: 'close' }] });
    assert.deepEqual(calls.find((c) => c[0] === 'info'), ['info', '2 Shortcuts erneuert.']);
    assert.equal(kinds(calls).filter((k) => k === 'dashboard').length, 2);
});

test('ein Fehler beim Starten oder Öffnen beendet das Fenster nicht', () => {
    for (const [action, extra] of [[{ action: 'start', name: 'Solo' }, { startError: 'VibeCode: Launcher fehlt' }],
        [{ action: 'open', id: 'remote' }, { openError: 'Terminal nicht erreichbar' }]]) {
        const calls = flowRun(Object.assign({ state: STATE(), dashboard: [action, { action: 'close' }] }, extra));
        assert.equal(calls.filter((c) => c[0] === 'error').length, 1);
        assert.equal(kinds(calls).filter((k) => k === 'dashboard').length, 2);   // zurück zur Übersicht
    }
});

const sshNew = { action: 'sshNew' };
const sshShare = { action: 'sshShare' };
const back = { action: 'close' };

test('SSH: Verbinden öffnet die gewählte Verbindung im Terminal und schließt das Fenster', () => {
    for (const item of [SPARK, REMOTE_MAC]) {
        const calls = flowRun({ state: ssh(), dashboard: [{ action: 'connect', item }] });
        assert.deepEqual(calls.find((c) => c[0] === 'sshOpen'), ['sshOpen', item.kind, item.name]);
        assert.equal(kinds(calls).filter((k) => k === 'dashboard').length, 1);   // danach kein Fenster mehr
    }
});

test('SSH: der Zustand wird bei jedem Durchlauf frisch gelesen', () => {
    const calls = flowRun({ state: ssh(), dashboard: [sshShare, back], sshResults: [result(0, 'Wachhalten           AN')],
        share: ['done'] });
    assert.equal(kinds(calls).filter((k) => k === 'state').length, kinds(calls).filter((k) => k === 'dashboard').length);
});

test('SSH: geführte Einrichtung öffnet das Setup im Terminal', () => {
    const calls = flowRun({ state: ssh(), dashboard: [sshNew], newKind: ['guided'] });
    assert.deepEqual(calls.find((c) => c[0] === 'newKind'), ['newKind', ['guided', 'line']]);
    assert.deepEqual(calls.find((c) => c[0] === 'sshOpen'), ['sshOpen', 'guided', null]);
});

test('SSH: Verbinden per Zeile – bereits freigegeben', () => {
    const calls = flowRun({
        state: ssh(), dashboard: [sshNew, back], newKind: ['line'],
        askLine: ['workspace remote ssh join user@remote-mac.local SHA256:abc'],
        sshResults: [result(0, '✔ Verbunden mit user@remote-mac.local.')],
    });
    assert.deepEqual(calls.find((c) => c[0] === 'ssh' && c[1] === 'join'),
        ['ssh', 'join', 'workspace remote ssh join user@remote-mac.local SHA256:abc']);
    assert.deepEqual(calls.find((c) => c[0] === 'info'), ['info', '✔ Verbunden mit user@remote-mac.local.']);
});

test('SSH: noch nicht freigegeben zeigt nur die allow-Zeile und sagt, was am anderen Mac zu tun ist', () => {
    const cli = [
        'Noch nicht freigegeben. Auf dem Remote-Mac ausführen (in der Zwischenablage):',
        "  workspace remote ssh allow 'ssh-ed25519 AAAAkey user@client'",
        'Fingerprint dieses Schlüssels: SHA256:xyz',
        'Danach hier: workspace remote ssh join',
    ].join('\n');
    const calls = flowRun({
        state: ssh(), dashboard: [sshNew, back], newKind: ['line'],
        askLine: ['workspace remote ssh join user@remote-mac.local'], sshResults: [result(2, cli)],
    });
    const text = calls.find((c) => c[0] === 'info')[1];
    assert.match(text, /^Noch nicht freigegeben\./);
    assert.ok(text.includes("workspace remote ssh allow 'ssh-ed25519 AAAAkey user@client'"));
    assert.match(text, /Diesen Mac freigeben… → Schlüssel eintragen/);
    assert.match(text, /Bereich SSH/);
    assert.ok(!text.includes('Danach hier: workspace remote ssh join'));      // CLI-Hinweis gehört nicht ins Fenster
});

test('SSH: Fehler bei der Verbindung, Abbruch und Auswahl "Zurück" ändern nichts', () => {
    const failed = flowRun({
        state: ssh(), dashboard: [sshNew, back], newKind: ['line'],
        askLine: ['x'], sshResults: [result(1, '', 'Host-Schlüssel stimmt NICHT überein')],
    });
    assert.deepEqual(failed.find((c) => c[0] === 'error'), ['error', 'Host-Schlüssel stimmt NICHT überein']);

    const cancelled = flowRun({
        state: ssh(), dashboard: [sshNew, sshNew, back], newKind: ['line', null], askLine: [null],
    });
    assert.ok(!kinds(cancelled).includes('error'));
    assert.equal(cancelled.filter((c) => c[0] === 'ssh' && typeof c[1] === 'string').length, 0);   // kein Backend-Aufruf
});

test('SSH: Diesen Mac freigeben – Status, Wach halten, dann Schlüssel mit Bestätigung eintragen', () => {
    const status = 'Entfernte Anmeldung  AN (Port 22)\nWachhalten           AUS\n  workspace remote ssh join t@h SHA256:abc';
    const awake = status.replace('AUS', 'AN');
    const key = JSON.stringify({ name: 'user@client', fingerprint: 'SHA256:xyz', known: false });
    const calls = flowRun({
        state: ssh(), dashboard: [sshShare, back],
        sshResults: [result(0, status), result(0, awake), result(0, key), result(0, 'Freigegeben.')],
        share: ['wake', 'allow'], askLine: ["workspace remote ssh allow 'ssh-ed25519 AAAA user@client'"],
        confirmAllow: [true],
    });
    const backend = calls.filter((c) => c[0] === 'ssh' && typeof c[1] === 'string' && c.length === 3);
    assert.deepEqual(backend.map((c) => c[1]), ['share', 'share-wake', 'allow-check', 'allow']);
    assert.deepEqual(calls.filter((c) => c[0] === 'share').map((c) => c[1]), [status, awake]);
    assert.deepEqual(calls.find((c) => c[0] === 'confirmAllow'), ['confirmAllow', 'user@client', 'SHA256:xyz']);
    assert.match(calls.find((c) => c[0] === 'info')[1], /^Freigegeben: user@client\./);
});

test('SSH: ein abgelehnter oder schon bekannter Schlüssel wird nicht geschrieben', () => {
    const line = "workspace remote ssh allow 'ssh-ed25519 AAAA n'";
    const declined = flowRun({
        state: ssh(), dashboard: [sshShare, back],
        sshResults: [result(0, 'x'), result(0, JSON.stringify({ name: 'n', fingerprint: 'SHA256:f', known: false }))],
        share: ['allow'], askLine: [line], confirmAllow: [false],
    });
    assert.ok(!declined.some((c) => c[0] === 'ssh' && c[1] === 'allow'));

    const known = flowRun({
        state: ssh(), dashboard: [sshShare, back],
        sshResults: [result(0, 'x'), result(0, JSON.stringify({ name: 'n', fingerprint: 'SHA256:f', known: true }))],
        share: ['allow'], askLine: [line],
    });
    assert.ok(!known.some((c) => c[0] === 'confirmAllow' || (c[0] === 'ssh' && c[1] === 'allow')));
    assert.match(known.find((c) => c[0] === 'info')[1], /schon freigegeben/);

    const invalid = flowRun({
        state: ssh(), dashboard: [sshShare, back],
        sshResults: [result(0, 'x'), result(1, '', 'Erwartet wird genau eine Zeile')],
        share: ['allow'], askLine: ['kaputt'],
    });
    assert.deepEqual(invalid.find((c) => c[0] === 'error'), ['error', 'Erwartet wird genau eine Zeile']);
    assert.ok(!invalid.some((c) => c[0] === 'confirmAllow'));
});

test('SSH: schlägt das Freigeben fehl, zeigt das Fenster den Grund', () => {
    const calls = flowRun({
        state: ssh(), dashboard: [sshShare, back],
        sshResults: [result(1, '', 'Konfiguration kaputt')], share: [],
    });
    assert.deepEqual(calls.find((c) => c[0] === 'error'), ['error', 'Konfiguration kaputt']);
    assert.ok(!kinds(calls).includes('share'));
});

test('Suchordner: gewählte Ordner werden hinzugefügt und das Ergebnis mit Hinweis gezeigt', () => {
    const calls = flowRun({
        state: withFolders(), dashboard: [{ action: 'addFolder' }, back], pickFolders: [['/g']],
        folderResults: [ok('Ordner hinzugefügt: /g (14 Repositories)')],
    });
    assert.deepEqual(calls.find((c) => c[0] === 'folder'), ['folder', 'add', { path: '/g' }]);
    assert.deepEqual(calls.find((c) => c[0] === 'info'), ['info', 'Ordner hinzugefügt: /g (14 Repositories)']);
});

test('Suchordner: mehrere Ordner, einer scheitert: die anderen werden trotzdem hinzugefügt', () => {
    const calls = flowRun({
        state: withFolders(), dashboard: [{ action: 'addFolder' }, back], pickFolders: [['/a', '/b', '/c']],
        folderResults: [ok('Ordner hinzugefügt: /a (0 Repositories)', 'Darin wurden keine Git-Repositories gefunden'),
            { throw: 'execution error: VibeCode: Dieser Ordner wird schon durchsucht: /b (1)' },
            ok('Ordner hinzugefügt: /c (2 Repositories)')],
    });
    assert.deepEqual(calls.filter((c) => c[0] === 'folder').map((c) => c[2].path), ['/a', '/b', '/c']);
    assert.deepEqual(calls.find((c) => c[0] === 'info')[1].split('\n\n'), [
        'Ordner hinzugefügt: /a (0 Repositories)\n⚠︎ Darin wurden keine Git-Repositories gefunden',
        '/b\n⚠︎ Dieser Ordner wird schon durchsucht: /b (1)',
        'Ordner hinzugefügt: /c (2 Repositories)']);
});

test('Suchordner: Abbrechen in der Ordnerwahl ändert nichts', () => {
    for (const picked of [null, []]) {
        const calls = flowRun({ state: withFolders(), dashboard: [{ action: 'addFolder' }, back], pickFolders: [picked] });
        assert.ok(!kinds(calls).includes('folder'));
        assert.ok(!kinds(calls).includes('info'));
    }
});

test('Suchordner: Remote-Ordner hinzufügen, auch wenn die Anmeldung noch nicht klappt', () => {
    const calls = flowRun({
        state: withFolders(), dashboard: [{ action: 'addRemoteFolder' }, { action: 'addRemoteFolder' }, back],
        askRemoteFolder: [{ host: 'spark', root: '~/p' }, { host: 'studio', root: '' }],
        folderResults: [ok('Remote-Ordner hinzugefügt: spark:~/p (7 Repositories)'),
            ok('Remote-Ordner hinzugefügt: studio:~ (0 Repositories). Gespeichert, aber die Suche ist fehlgeschlagen',
                'Permission denied (publickey).')],
    });
    assert.deepEqual(calls.filter((c) => c[0] === 'folder').map((c) => [c[1], c[2]]),
        [['add-remote', { host: 'spark', root: '~/p' }], ['add-remote', { host: 'studio', root: '' }]]);
    const infos = calls.filter((c) => c[0] === 'info').map((c) => c[1]);
    assert.equal(infos[0], 'Remote-Ordner hinzugefügt: spark:~/p (7 Repositories)');
    assert.match(infos[1], /Gespeichert, aber die Suche ist fehlgeschlagen/);
    assert.match(infos[1], /⚠︎ Permission denied \(publickey\)\./);
    assert.match(infos[1], /Geführte Einrichtung/);                          // sagt, wie man die Anmeldung einrichtet
});

test('Suchordner: ungültiger Host oder Abbruch beenden das Fenster nicht', () => {
    const cancelled = flowRun({
        state: withFolders(), dashboard: [{ action: 'addRemoteFolder' }, back], askRemoteFolder: [null] });
    assert.ok(!kinds(cancelled).includes('folder'));
    const invalid = flowRun({
        state: withFolders(), dashboard: [{ action: 'addRemoteFolder' }, back],
        askRemoteFolder: [{ host: '-oProxyCommand=x', root: '~' }],
        folderResults: [{ throw: 'execution error: VibeCode: Ungültiger SSH-Host. (1)' }],
    });
    assert.deepEqual(invalid.find((c) => c[0] === 'error'), ['error', 'Ungültiger SSH-Host. (1)']);
    assert.equal(kinds(invalid).filter((k) => k === 'dashboard').length, 2);         // zurück zur Übersicht
});

test('Suchordner: Entfernen verlangt eine Bestätigung und kennt lokal und remote', () => {
    const local = { action: 'removeFolder', kind: 'local', path: '/Users/example/Github', label: '/Users/example/Github' };
    const remote = { action: 'removeFolder', kind: 'remote', host: 'spark', label: 'spark:~/projects' };
    const calls = flowRun({
        state: withFolders(), dashboard: [local, remote, local, back],
        confirmRemoveFolder: [true, true, false], folderResults: [ok('a'), ok('b')],
    });
    assert.deepEqual(calls.filter((c) => c[0] === 'confirmRemoveFolder').map((c) => c[1]),
        ['/Users/example/Github', 'spark:~/projects', '/Users/example/Github']);
    assert.deepEqual(calls.filter((c) => c[0] === 'folder').map((c) => [c[1], c[2]]),
        [['remove', { path: '/Users/example/Github' }], ['remove-remote', { host: 'spark' }]]);   // beim "Nein" nichts
});

test('Presets: Preset anlegen startet mit den Standard-Terminals des Repositories (lokal oder remote)', () => {
    for (const [index, expectedNames] of [[1, ['Frontend', 'Claude']], [2, ['Shell']]]) {
        const repo = PRESETS.repos[index];
        const calls = flowRun({
            state: withPresets(), dashboard: [{ action: 'newPreset' }, back], pickRepo: [repo],
            editPreset: [{ terminals: [TERM('Neu')], urls: ['http://localhost:1'] }], presetResults: [ok('Preset gespeichert')],
        });
        const edit = calls.find((c) => c[0] === 'editPreset');
        assert.equal(edit[1], repo.name);
        assert.deepEqual(edit[2].terminals.map((t) => t.name), expectedNames);
        assert.equal(edit[3], false);                                                  // noch kein eigenes Preset
        assert.deepEqual(calls.find((c) => c[0] === 'preset'),
            ['preset', 'save', { path: repo.path, data: { terminals: [TERM('Neu')], urls: ['http://localhost:1'] } }]);
    }
});

test('Presets: Bearbeiten beginnt mit dem gespeicherten Preset', () => {
    const changed = { terminals: [TERM('Dev', 'Eigener Befehl', 'npm start', 'frontend')], urls: [] };
    const calls = flowRun({
        state: withPresets(), dashboard: [{ action: 'editPreset', path: '/g/alpha' }, back],
        editPreset: [changed], presetResults: [ok('x')],
    });
    const edit = calls.find((c) => c[0] === 'editPreset');
    assert.deepEqual(edit[2], { terminals: PRESETS.items[0].terminals, urls: ['http://localhost:5173'] });
    assert.equal(edit[3], true);
    assert.deepEqual(calls.find((c) => c[0] === 'preset')[2], { path: '/g/alpha', data: changed });
});

test('Presets: ein abgelehntes Preset zeigt den Grund und behält alle Eingaben', () => {
    const wrong = { terminals: [TERM('A', 'Shell', '', '../x')], urls: [] };
    const fixed = { terminals: [TERM('A', 'Shell', '', 'x')], urls: [] };
    const calls = flowRun({
        state: withPresets(), dashboard: [{ action: 'editPreset', path: '/g/alpha' }, back],
        editPreset: [wrong, fixed],
        presetResults: [{ throw: 'execution error: VibeCode: Terminal 1 („A“): Bitte einen relativen Unterordner ohne „..“ angeben. (1)' }, ok('ok')],
    });
    const edits = calls.filter((c) => c[0] === 'editPreset');
    assert.equal(edits.length, 2);
    assert.deepEqual(edits[1][2], wrong);                                              // nichts muss neu getippt werden
    assert.match(edits[1][4], /^Terminal 1 \(„A“\): Bitte einen relativen Unterordner/);
    assert.equal(calls.filter((c) => c[0] === 'preset').length, 2);
});

test('Presets: Abbrechen, Zurücksetzen mit Rückfrage und zu viele Terminals', () => {
    const cancelled = flowRun({ state: withPresets(), dashboard: [{ action: 'editPreset', path: '/g/alpha' }, back], editPreset: [null] });
    assert.ok(!kinds(cancelled).includes('preset'));

    const reset = flowRun({
        state: withPresets(), dashboard: [{ action: 'editPreset', path: '/g/alpha' }, back],
        editPreset: [{ reset: true }, { reset: true }], confirmResetPreset: [false, true], presetResults: [ok('zurückgesetzt')],
    });
    assert.deepEqual(reset.filter((c) => c[0] === 'confirmResetPreset').map((c) => c[1]), ['alpha', 'alpha']);
    assert.deepEqual(reset.filter((c) => c[0] === 'preset'), [['preset', 'reset', { path: '/g/alpha' }]]);
    assert.equal(reset.filter((c) => c[0] === 'editPreset').length, 2);                // bei "Nein" geht der Editor weiter

    const many = Array.from({ length: 13 }, (_, i) => TERM(`T${i}`));
    const tooMany = flowRun({ state: withPresets({ items: [Object.assign({}, PRESETS.items[0], { terminals: many })] }),
        dashboard: [{ action: 'editPreset', path: '/g/alpha' }, back] });
    assert.ok(!kinds(tooMany).includes('editPreset'));
    assert.match(tooMany.find((c) => c[0] === 'error')[1], /mehr als 12 Terminals/);
});

test('Presets: Zurücksetzen und Entfernen aus der Übersicht fragen nach', () => {
    const row = { action: 'resetPreset', path: '/alt/lost', label: 'lost' };
    const calls = flowRun({
        state: withPresets(), dashboard: [row, row, back], confirmResetPreset: [true, false], presetResults: [ok('x')],
    });
    assert.deepEqual(calls.filter((c) => c[0] === 'preset'), [['preset', 'reset', { path: '/alt/lost' }]]);
    assert.equal(calls.filter((c) => c[0] === 'confirmResetPreset').length, 2);
});

test('Presets: Übernehmen überträgt das Preset auf das neue Repository, nur nach Rückfrage', () => {
    const row = { action: 'movePreset', path: '/alt/moved', to: '/neu/moved', label: 'moved', toLabel: '/neu/moved' };
    const calls = flowRun({
        state: withPresets(), dashboard: [row, row, back], confirmMovePreset: [true, false], presetResults: [ok('Preset übernommen.')],
    });
    assert.deepEqual(calls.filter((c) => c[0] === 'confirmMovePreset').map((c) => [c[1], c[2]]),
        [['moved', '/neu/moved'], ['moved', '/neu/moved']]);
    assert.deepEqual(calls.filter((c) => c[0] === 'preset'), [['preset', 'move', { path: '/alt/moved', to: '/neu/moved' }]]);
});

test('Presets: ohne Auswahl in der Repository-Liste passiert nichts', () => {
    const calls = flowRun({ state: withPresets(), dashboard: [{ action: 'newPreset' }, back], pickRepo: [null] });
    assert.deepEqual(calls.find((c) => c[0] === 'pickRepo'), ['pickRepo', ['alpha', 'beta', 'r [SSH: spark]']]);
    assert.ok(!kinds(calls).includes('editPreset'));
});

// ------------------------------------------------------------------ Widgets

function widgets(body, prelude = '') {
    return jxa(`${library.replace(PRESENT, 'function present(alert, widgets) { return scriptedPresent(alert, widgets); }')
        .replace(PRESENT_DASHBOARD, 'function presentDashboard(built) { return scriptedDashboard(built); }')}
const titles = (alert) => { const out = []; for (let i = 0; i < alert.buttons.count; i += 1) out.push(ObjC.unwrap(alert.buttons.objectAtIndex(i).title)); return out; };
const STATE = ${JSON.stringify(STATE())};
const FIRST = Number($.NSAlertFirstButtonReturn);   // the bridged constant would concatenate as text with "+"
function scriptedDashboard() { throw new Error('scriptedDashboard not provided'); }
${prelude}
function run() { ${body} }
`);
}

const MODEL_STATE = Object.assign(ssh(), {
    workspaces: [
        { name: 'Demo', projects: ['A', 'B'], shortcut: true, missing: [] },
        { name: 'Alt', projects: ['A', 'weg'], shortcut: false, missing: ['weg'] },
    ],
});

test('Übersicht: alles Eingerichtete steht direkt da, nichts hinter "Mehr…"', () => {
    const rows = JSON.parse(widgets(`return JSON.stringify(dashboardModel(${JSON.stringify(MODEL_STATE)}));`));
    const sections = rows.filter((row) => row.type === 'section').map((row) => row.text);
    assert.deepEqual(sections, ['Workspaces', 'SSH', 'Projekte & Module']);
    const items = rows.filter((row) => row.type === 'item');
    assert.deepEqual(items.map((row) => row.title), [
        'Demo', 'Alt', 'spark', 'user@remote-mac.local', 'Einrichten', 'Remote', 'Auswählen']);
    // Shortcut und Warnung stehen vor der (langen) Projektliste: dort wird gekürzt.
    assert.equal(items[0].detail, 'Schreibtisch ✓ · A, B');
    assert.equal(items[1].detail, 'kein Shortcut · ⚠︎ nicht gefunden: weg · A, weg');
    assert.deepEqual(items.map((row) => row.level), ['ok', 'warn', 'ok', 'ok', 'ok', 'off', 'none']);
    assert.deepEqual(items[2].detail, '~/projects · 12 Repositories');
    assert.equal(items[4].detail, '3 Projekte eingerichtet');
    assert.equal(items[6].detail, '');                                            // Modul ohne Status
    assert.deepEqual(items[0].buttons.map((b) => b.label), ['Starten', 'Bearbeiten…']);
    assert.deepEqual(items[0].buttons[0].action, { action: 'start', name: 'Demo' });
    assert.deepEqual(items[3].buttons[0].action, { action: 'connect', item: REMOTE_MAC });
    assert.deepEqual(items[5].buttons[0].action, { action: 'open', id: 'remote' });
    const footers = rows.filter((row) => row.type === 'footer').map((row) => row.buttons.map((b) => b.label));
    assert.deepEqual(footers, [['Neuer Workspace…', 'Shortcuts erneuern'], ['Neue Verbindung…', 'Diesen Mac freigeben…']]);
});

test('Übersicht: leerer Zustand sagt klar, dass nichts eingerichtet ist', () => {
    const rows = JSON.parse(widgets(`return JSON.stringify(dashboardModel({ workspaces: [], projects: [], entries: [],
        ssh: { available: true, guided: true, share: false, hosts: [], mac: null, errors: ['hosts: kaputt'] } }));`));
    const notes = rows.filter((row) => row.type === 'note');
    assert.deepEqual(notes.map((row) => row.text), [
        'Noch kein Workspace angelegt.', 'Noch keine Verbindung eingerichtet.', '⚠︎ hosts: kaputt']);
    assert.equal(notes[2].level, 'warn');
    const footers = rows.filter((row) => row.type === 'footer').map((row) => row.buttons.map((b) => b.label));
    assert.deepEqual(footers, [['Neuer Workspace…'], ['Neue Verbindung…']]);   // ohne Freigabe-Modul kein Freigeben
    assert.ok(!rows.some((row) => row.text === 'Projekte & Module'));            // ohne Module kein leerer Bereich
});

test('Übersicht: der SSH-Bereich erscheint nur, wenn ein Modul SSH anbietet', () => {
    const sections = (extra) => JSON.parse(widgets(`return JSON.stringify(dashboardModel(Object.assign({}, STATE, ${extra}))
        .filter((row) => row.type === 'section').map((row) => row.text));`));
    assert.ok(!sections('{}').includes('SSH'));
    assert.ok(!sections('{ ssh: { available: false, hosts: [], mac: null, errors: [] } }').includes('SSH'));
    assert.ok(sections(`{ ssh: ${SSH_JSON} }`).includes('SSH'));
});

test('Übersicht: echte Knöpfe lösen beim Klick genau die Aktion ihrer Zeile aus', () => {
    const out = JSON.parse(widgets(`
        const built = buildDashboard(dashboardModel(${JSON.stringify(MODEL_STATE)}));
        const clicked = built.buttons.map((button) => {
            dashboardAction = null;
            button.view.performClick(null);          // echte Target-Action, ohne Fenster auf dem Schirm
            return { title: button.title, action: dashboardAction, expected: button.action };
        });
        const escape = ObjC.unwrap(built.buttons[built.buttons.length - 1].view.keyEquivalent);
        dashboardAction = null;
        built.window.delegate.windowWillClose(null);  // rotes Schließen-Kästchen
        return JSON.stringify({ titles: built.buttons.map((b) => b.title), clicked, escape,
            title: ObjC.unwrap(built.window.title), afterClose: dashboardAction });`));
    assert.deepEqual(out.titles, ['Starten', 'Bearbeiten…', 'Starten', 'Bearbeiten…', 'Neuer Workspace…',
        'Shortcuts erneuern', 'Verbinden', 'Verbinden', 'Neue Verbindung…', 'Diesen Mac freigeben…',
        'Öffnen', 'Öffnen', 'Öffnen', 'Schließen']);
    for (const click of out.clicked) assert.deepEqual(click.action, click.expected, click.title);
    assert.deepEqual(out.clicked[out.clicked.length - 1].action, { action: 'close' });
    assert.equal(out.escape, '\u001b');                                           // Esc schließt
    assert.equal(out.title, 'VibeCode Workspace');
    assert.deepEqual(out.afterClose, { action: 'close' });
});

test('Übersicht: viele Einträge scrollen, statt das Fenster über den Bildschirm wachsen zu lassen', () => {
    const out = JSON.parse(widgets(`
        const many = Array.from({ length: 40 }, (_, i) => ({ name: 'W' + i, projects: ['A'], shortcut: false, missing: [] }));
        const big = buildDashboard(dashboardModel(Object.assign({}, STATE, { workspaces: many })));
        const small = buildDashboard(dashboardModel({ workspaces: [], projects: [], entries: [] }));
        const height = (built) => Number(built.window.contentView.frame.size.height);
        return JSON.stringify({ big: height(big), bigTotal: big.total, small: height(small), smallTotal: small.total,
            max: maxContent() });`));
    assert.ok(out.max >= 420 && out.max <= 780);          // richtet sich nach dem Bildschirm, aber in festen Grenzen
    assert.equal(out.big, out.max + 52);                  // gedeckelt: sichtbarer Teil + Fußleiste
    assert.ok(out.bigTotal > out.max);
    assert.equal(out.small, out.smallTotal + 52);         // kleine Übersicht passt genau
});

test('Übersicht: die native Oberfläche liefert die Aktion der angeklickten Schaltfläche', () => {
    const out = JSON.parse(widgets(`
        const ui = nativeUi({});
        return JSON.stringify({ chosen: ui.dashboard(${JSON.stringify(MODEL_STATE)}), seen });`, `
        const seen = [];
        function scriptedDashboard(built) {
            seen.push(built.buttons.map((button) => button.title).length);
            const target = built.buttons.find((button) => button.title === 'Verbinden');
            dashboardAction = null;
            target.view.performClick(null);
            return dashboardAction;
        }`));
    assert.deepEqual(out.chosen, { action: 'connect', item: SPARK });
    assert.deepEqual(out.seen, [14]);
});

test('Editor: echte Checkboxen, vorbelegt, fehlende Projekte sichtbar, Eingaben auslesbar', () => {
    const out = JSON.parse(widgets(`
        const existing = STATE.workspaces[0];
        const draft = { name: 'Für Demo', projects: ['B', 'weg'], shortcut: true };
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
    assert.deepEqual(out.before, { name: 'Für Demo', projects: ['B', 'weg'], shortcut: true });
    assert.deepEqual(out.after, { name: 'Neuer Name', projects: ['A', 'weg'], shortcut: false });
    assert.deepEqual(out.buttons, ['Speichern', 'Abbrechen', 'Löschen…']);
    assert.deepEqual(out.fresh, ['Speichern', 'Abbrechen']);
    assert.equal(out.title, 'Workspace „Demo“ bearbeiten');
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
    const name = "Für 'Demo' & Co \"x\"";
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

// ------------------------------------------------------------------ SSH-Widgets

test('Freigabe-Dialog: Wach halten erscheint nur, solange der Mac nicht schon wach gehalten wird', () => {
    const out = JSON.parse(widgets(`
        const asleep = buildShare('Wachhalten           AUS (Mac kann einschlafen)');
        const awake = buildShare('Wachhalten           AN');
        return JSON.stringify({ asleep: titles(asleep.alert), awake: titles(awake.alert),
            actions: [asleep.actions, awake.actions], text: ObjC.unwrap(asleep.alert.informativeText) });`));
    assert.deepEqual(out.asleep, ['Schlüssel eintragen…', 'Wach halten', 'Fertig']);
    assert.deepEqual(out.awake, ['Schlüssel eintragen…', 'Fertig']);
    assert.match(out.text, /Zwischenablage/);
    assert.match(out.text, /Wachhalten           AUS/);
});

test('SSH-Eingaben: Abbrechen liefert null, Auswahlliste und Bestätigung sind eindeutig', () => {
    const out = JSON.parse(widgets(`
        let behaviour;
        const app = {
            displayDialog: (prompt, options) => {
                app.shown = { prompt, options };
                if (behaviour === 'cancel') { const e = new Error('abgebrochen'); e.errorNumber = -128; throw e; }
                if (behaviour === 'boom') throw new Error('anderer Fehler');
                return { textReturned: 'eingefügte Zeile' };
            },
            chooseFromList: (items) => { app.items = items; return behaviour === 'back' ? false : [items[1]]; },
        };
        const ui = nativeUi(app);
        behaviour = 'ok'; const typed = ui.askLine('Titel', 'Prompt');
        const options = app.shown.options;
        behaviour = 'cancel'; const cancelled = ui.askLine('Titel', 'Prompt');
        behaviour = 'boom'; let other = null; try { ui.askLine('T', 'P'); } catch (error) { other = error.message; }
        behaviour = 'pick'; const kind = ui.newKind(['guided', 'line']);
        behaviour = 'back'; const none = ui.newKind(['guided', 'line']);
        response = FIRST; const yes = ui.confirmAllow('user@client', 'SHA256:xyz');
        response = FIRST + 1; const no = ui.confirmAllow('user@client', 'SHA256:xyz');
        return JSON.stringify({ typed, cancelled, other, kind, none, yes, no, items: app.items,
            defaultButton: options.defaultButton, cancelButton: options.cancelButton, seen });`, `
        let response;
        const seen = [];
        function scriptedPresent(alert) { seen.push(ObjC.unwrap(alert.informativeText)); return response; }`));
    assert.equal(out.typed, 'eingefügte Zeile');
    assert.equal(out.cancelled, null);
    assert.equal(out.other, 'anderer Fehler');
    assert.equal(out.kind, 'line');
    assert.equal(out.none, null);
    assert.equal(out.yes, true);
    assert.equal(out.no, false);
    assert.equal(out.items.length, 2);
    assert.equal(out.cancelButton, 'Abbrechen');
    assert.match(out.seen[0], /Name: user@client\nFingerprint: SHA256:xyz/);
    assert.match(out.seen[0], /deinem eigenen Mac/);
});

test('SSH-Aufrufe an vibecode.py: sicher gequotet, Antwort als {code, out, err}', () => {
    const commands = JSON.parse(jxa(`${library}
const seen = [];
const app = { doShellScript: (command) => { seen.push(command); return '{"code":0,"out":"x","err":""}'; } };
function run() {
    const backend = makeBackend(app, '/usr/bin/python3', '/c/vibecode.py');
    const joined = backend.ssh('join', "workspace remote ssh join t@h 'SHA256:a b'");
    backend.ssh('share'); backend.sshOpen('host', 'spark'); backend.sshOpen('guided');
    return JSON.stringify({ seen, joined });
}`));
    const base = "'/usr/bin/python3' '/c/vibecode.py'";
    assert.deepEqual(commands.seen, [
        `${base} '_ssh' 'join' '--line=workspace remote ssh join t@h '\\''SHA256:a b'\\'''`,
        `${base} '_ssh' 'share'`,
        `${base} 'ssh-open' '--kind=host' '--name=spark'`,
        `${base} 'ssh-open' '--kind=guided'`,
    ]);
    assert.deepEqual(commands.joined, { code: 0, out: 'x', err: '' });
});

// ------------------------------------------------------------------ Suchordner (Modell und Widgets)

test('Übersicht: Repository-Suche zeigt jeden Ordner mit Zahl und Warnung, zwischen Workspaces und SSH', () => {
    const rows = JSON.parse(widgets(`return JSON.stringify(dashboardModel(${JSON.stringify(
        Object.assign(ssh(), { folders: FOLDERS }))}));`));
    assert.deepEqual(rows.filter((row) => row.type === 'section').map((row) => row.text),
        ['Workspaces', 'Repository-Suche', 'SSH', 'Projekte & Module']);
    const start = rows.findIndex((row) => row.text === 'Repository-Suche');
    const items = rows.slice(start).filter((row) => row.type === 'item').slice(0, 6);
    assert.deepEqual(items.map((row) => [row.title, row.detail, row.level]), [
        ['/Users/example/Github', 'Lokal · 14 Repositories', 'ok'],
        ['/Volumes/Alt', '⚠︎ Ordner nicht gefunden', 'warn'],
        ['/Users/example/leer', 'Lokal · ⚠︎ keine Repositories gefunden', 'warn'],
        ['/Users/example/riesig', 'Lokal · 1 Repository · ⚠︎ Ordner sehr groß, Suche abgebrochen', 'warn'],
        ['spark:~/projects', 'SSH · 12 Repositories (zuletzt gefunden)', 'ok'],
        ['studio:/srv', 'SSH · ⚠︎ noch keine Repositories gefunden', 'warn']]);
    assert.ok(items.every((row) => row.middle));                                // Pfade werden in der Mitte gekürzt
    assert.deepEqual(items[0].buttons[0].action,
        { action: 'removeFolder', kind: 'local', path: '/Users/example/Github', label: '/Users/example/Github' });
    assert.deepEqual(items[4].buttons[0].action,
        { action: 'removeFolder', kind: 'remote', host: 'spark', label: 'spark:~/projects' });
    const footer = rows.slice(start).find((row) => row.type === 'footer');
    assert.deepEqual(footer.buttons.map((b) => b.label), ['Ordner hinzufügen…', 'Remote-Ordner hinzufügen…']);
});

test('Übersicht: ohne Suchordner steht ein kurzer Hinweis da, und fehlende Module blenden ihren Knopf aus', () => {
    const model = (folders) => JSON.parse(widgets(`return JSON.stringify(dashboardModel(Object.assign({}, STATE,
        { folders: ${JSON.stringify(folders)} })));`));
    const empty = model({ canAddLocal: true, canAddRemote: false, local: [], remote: [], errors: [] });
    const note = empty.find((row) => row.text && row.text.startsWith('Noch kein Suchordner'));
    assert.equal(note.text, 'Noch kein Suchordner: füge einen Ordner mit deinen Repositories hinzu.');
    assert.ok(note.text.length < 80);                                            // passt in eine Zeile
    const footers = empty.filter((row) => row.type === 'footer').map((row) => row.buttons.map((b) => b.label));
    assert.deepEqual(footers[1], ['Ordner hinzufügen…']);                       // ohne Hosts-Modul kein Remote-Knopf
    const failing = model(Object.assign({}, FOLDERS, { errors: ['Suchordner: Ungültige search-folders.json'] }));
    assert.ok(failing.some((row) => row.type === 'note' && row.level === 'warn' && row.text.includes('search-folders.json')));
    const sections = (folders) => model(folders).filter((row) => row.type === 'section').map((row) => row.text);
    assert.ok(!sections({ canAddLocal: false, canAddRemote: false, local: [], remote: [], errors: [] }).includes('Repository-Suche'));
    assert.deepEqual(JSON.parse(widgets(`return JSON.stringify(dashboardModel(STATE).filter((row) => row.type === 'section')
        .map((row) => row.text));`)), ['Workspaces', 'Projekte & Module']);        // alter Zustand ohne folders
});

test('Übersicht: die Knöpfe der Repository-Suche lösen ihre Aktion aus', () => {
    const out = JSON.parse(widgets(`
        const built = buildDashboard(dashboardModel(${JSON.stringify(withFolders())}));
        const wanted = ['Entfernen', 'Ordner hinzufügen…', 'Remote-Ordner hinzufügen…'];
        const clicked = built.buttons.filter((b) => wanted.includes(b.title)).map((button) => {
            dashboardAction = null;
            button.view.performClick(null);
            return { title: button.title, action: dashboardAction, expected: button.action };
        });
        return JSON.stringify({ clicked });`));
    assert.equal(out.clicked.length, 6 + 2);                                       // 6 Entfernen + 2 Hinzufügen
    for (const click of out.clicked) assert.deepEqual(click.action, click.expected, click.title);
    assert.deepEqual(out.clicked.map((c) => c.action.action).slice(-2), ['addFolder', 'addRemoteFolder']);
});

test('Remote-Ordner-Dialog: Host ist Pflicht, Eingaben bleiben stehen, Abbrechen liefert null', () => {
    const out = JSON.parse(widgets(`
        steps.push({ response: FIRST, root: '~/p' },                               // Host fehlt
            { response: FIRST, host: ' spark ', root: '/srv/git ' });              // jetzt vollständig
        const done = nativeUi({}).askRemoteFolder('');
        steps.push({ response: FIRST + 1, host: 'egal' });
        const cancelled = nativeUi({}).askRemoteFolder('');
        return JSON.stringify({ done, cancelled, notes, drafts });`, `
        const steps = [];
        const notes = [];
        const drafts = [];
        function scriptedPresent(alert, built) {
            notes.push(ObjC.unwrap(alert.informativeText));
            const step = steps.shift();
            drafts.push(ObjC.unwrap(built.root.stringValue));
            if (step.host !== undefined) built.host.stringValue = $(step.host);
            if (step.root !== undefined) built.root.stringValue = $(step.root);
            return step.response;
        }`));
    assert.deepEqual(out.done, { host: 'spark', root: '/srv/git' });
    assert.equal(out.cancelled, null);
    assert.match(out.notes[0], /sucht auf dem Server/);
    assert.equal(out.notes[1], 'Gib den SSH-Host an, zum Beispiel spark oder benutzer@server.');
    assert.equal(out.drafts[1], '~/p');                                            // der Ordner blieb stehen
});

test('Ordnerwahl und Entfernen-Bestätigung sind eindeutig', () => {
    const out = JSON.parse(widgets(`
        let reply;
        const app = { chooseFolder: (options) => { app.options = options; if (reply === 'cancel') { const e = new Error('x'); e.errorNumber = -128; throw e; }
            if (reply === 'boom') throw new Error('anderer Fehler'); return reply; } };
        const ui = nativeUi(app);
        reply = ['/a', '/b c']; const several = ui.pickFolders();
        reply = '/einzeln'; const single = ui.pickFolders();
        reply = 'cancel'; const cancelled = ui.pickFolders();
        reply = 'boom'; let other = null; try { ui.pickFolders(); } catch (error) { other = error.message; }
        response = FIRST; const yes = ui.confirmRemoveFolder('spark:~/p');
        response = FIRST + 1; const no = ui.confirmRemoveFolder('spark:~/p');
        return JSON.stringify({ several, single, cancelled, other, yes, no, multiple: app.options.multipleSelectionsAllowed, seen });`, `
        let response;
        const seen = [];
        function scriptedPresent(alert) { seen.push([ObjC.unwrap(alert.messageText), ObjC.unwrap(alert.informativeText)]); return response; }`));
    assert.deepEqual(out.several, ['/a', '/b c']);
    assert.deepEqual(out.single, ['/einzeln']);
    assert.equal(out.cancelled, null);
    assert.equal(out.other, 'anderer Fehler');
    assert.equal(out.multiple, true);
    assert.equal(out.yes, true);
    assert.equal(out.no, false);
    assert.equal(out.seen[0][0], 'Suchordner „spark:~/p“ entfernen?');
    assert.match(out.seen[0][1], /Repositories und alles auf der Platte oder dem Server bleiben unberührt/);
});

test('Suchordner-Aufrufe an vibecode.py: Pfade werden einzeln gequotet, leere Felder weggelassen', () => {
    const out = JSON.parse(jxa(`${library}
const seen = [];
const app = { doShellScript: (command) => { seen.push(command); return '{"message": "ok", "warning": null}'; } };
function run() {
    const backend = makeBackend(app, '/usr/bin/python3', '/c/vibecode.py');
    const added = backend.folder('add', { path: "/Users/example/Mein 'Ordner' & Co" });
    backend.folder('add-remote', { host: 'spark', root: '' });
    backend.folder('remove-remote', { host: 'user@server' });
    return JSON.stringify({ seen, added });
}`));
    const base = "'/usr/bin/python3' '/c/vibecode.py' 'folders'";
    assert.deepEqual(out.seen, [
        `${base} 'add' '--json' '--path=/Users/example/Mein '\\''Ordner'\\'' & Co'`,
        `${base} 'add-remote' '--json' '--host=spark'`,
        `${base} 'remove-remote' '--json' '--host=user@server'`,
    ]);
    assert.deepEqual(out.added, { message: 'ok', warning: null });
});

test('echter Roundtrip: ein Pfad mit Umlaut, Hochkomma und & erreicht vibecode.py unverändert', (t) => {
    const dir = fs.mkdtempSync('/private/tmp/vibecode-test-');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const fake = path.join(dir, 'fake core', 'vibecode.py');
    fs.mkdirSync(path.dirname(fake));
    fs.writeFileSync(fake, `import json, sys
print(json.dumps({'message': json.dumps(sys.argv[1:], ensure_ascii=False), 'warning': None}, ensure_ascii=False))
`);
    const folder = "/Users/example/Für 'Repos' & Co";
    const echoed = JSON.parse(JSON.parse(jxa(`${library}
function run(argv) {
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    return JSON.stringify(makeBackend(app, argv[0], argv[1]).folder('add', { path: ${JSON.stringify(folder)} }).message);
}`, [execFileSync('/usr/bin/which', ['python3'], { encoding: 'utf8' }).trim(), fake])));
    assert.deepEqual(echoed, ['folders', 'add', '--json', `--path=${folder}`]);
});

// ------------------------------------------------------------------ Presets (Modell und Widgets)

test('Übersicht: Presets pro Repository zeigen, was gilt, und was nach einem Umzug zu tun ist', () => {
    const rows = JSON.parse(widgets(`return JSON.stringify(dashboardModel(${JSON.stringify(
        Object.assign(ssh(), { folders: FOLDERS, presets: PRESETS }))}));`));
    assert.deepEqual(rows.filter((row) => row.type === 'section').map((row) => row.text),
        ['Workspaces', 'Repository-Suche', 'Presets pro Repository', 'SSH', 'Projekte & Module']);
    const start = rows.findIndex((row) => row.text === 'Presets pro Repository');
    const after = rows.slice(start + 1, rows.findIndex((row) => row.text === 'SSH'));
    assert.equal(after[0].text, 'Ohne Preset: Standard-Terminals (Frontend, Claude)');
    const items = after.filter((row) => row.type === 'item');
    assert.deepEqual(items.map((row) => [row.title, row.detail, row.level]), [
        ['alpha', 'Dev, Agent · 1 Browser-Tab', 'ok'],
        ['moved', '⚠︎ Repository nicht mehr gefunden · neuer Ort: /neu/moved · Shell · 0 Browser-Tabs', 'warn'],
        ['lost', '⚠︎ Repository nicht mehr gefunden · keine Terminals · 2 Browser-Tabs', 'warn']]);
    assert.deepEqual(items.map((row) => row.buttons.map((b) => b.label)),
        [['Bearbeiten…', 'Zurücksetzen'], ['Übernehmen', 'Entfernen'], ['Entfernen']]);   // Übernehmen nur mit Vorschlag
    assert.deepEqual(items[0].buttons[0].action, { action: 'editPreset', path: '/g/alpha' });
    assert.deepEqual(items[1].buttons[0].action,
        { action: 'movePreset', path: '/alt/moved', to: '/neu/moved', label: 'moved', toLabel: '/neu/moved' });
    assert.deepEqual(items[2].buttons[0].action, { action: 'resetPreset', path: '/alt/lost', label: 'lost' });
    assert.deepEqual(after.find((row) => row.type === 'footer').buttons.map((b) => b.label), ['Preset anlegen…']);
});

test('Übersicht: Presets ohne Repositories bieten kein Anlegen an, ohne Modul gibt es den Bereich nicht', () => {
    const model = (presets) => JSON.parse(widgets(`return JSON.stringify(dashboardModel(Object.assign({}, STATE,
        { presets: ${JSON.stringify(presets)} })));`));
    const none = model(Object.assign({}, PRESETS, { repos: [], items: [], orphans: [], errors: ['Presets: kaputt'] }));
    const start = none.findIndex((row) => row.text === 'Presets pro Repository');
    const own = none.slice(start + 1, none.findIndex((row, index) => index > start && row.type === 'section'));
    assert.ok(!own.some((row) => row.type === 'footer'));                           // kein Repository: nichts anzulegen
    assert.ok(own.some((row) => row.type === 'note' && row.level === 'warn' && row.text === '⚠︎ Presets: kaputt'));
    const sections = (presets) => model(presets).filter((row) => row.type === 'section').map((row) => row.text);
    assert.ok(!sections({ available: false, repos: [], items: [], orphans: [], defaults: { local: [], remote: [] }, errors: [] })
        .includes('Presets pro Repository'));
    assert.equal(model(Object.assign({}, PRESETS, { defaults: { local: [], remote: [] } }))
        .find((row) => row.text && row.text.startsWith('Ohne Preset')).text, 'Ohne Preset: Standard-Terminals');
});

test('Übersicht: die Preset-Knöpfe lösen ihre Aktion aus', () => {
    const out = JSON.parse(widgets(`
        const built = buildDashboard(dashboardModel(${JSON.stringify(withPresets())}));
        const wanted = ['editPreset', 'resetPreset', 'movePreset', 'newPreset'];
        const clicked = built.buttons.filter((b) => wanted.includes(b.action.action)).map((button) => {
            dashboardAction = null;
            button.view.performClick(null);
            return { title: button.title, action: dashboardAction, expected: button.action };
        });
        return JSON.stringify({ clicked });`));
    assert.deepEqual(out.clicked.map((c) => c.title), ['Bearbeiten…', 'Zurücksetzen', 'Übernehmen', 'Entfernen', 'Entfernen', 'Preset anlegen…']);
    for (const click of out.clicked) assert.deepEqual(click.action, click.expected, click.title);
});

test('Preset-Editor: echte Formularzeilen, vorbelegt, mit freien Zeilen und nur dort einem Zurücksetzen-Knopf', () => {
    const out = JSON.parse(widgets(`
        const repo = { name: 'alpha' };
        const draft = { terminals: ${JSON.stringify(PRESETS.items[0].terminals)}, urls: ['http://a.test', 'http://b.test'] };
        const built = buildPresetEditor(repo, draft, true, '');
        const rows = (b) => b.rows.map((row) => [ObjC.unwrap(row.popup.titleOfSelectedItem), ObjC.unwrap(row.name.stringValue),
            ObjC.unwrap(row.prompt.stringValue), ObjC.unwrap(row.cwd.stringValue)]);
        const eight = buildPresetEditor(repo, { terminals: Array.from({ length: 8 }, (_, i) => ({ name: 'T' + i, type: 'Shell', prompt: '', cwd: '' })), urls: [] }, false, '');
        const many = buildPresetEditor(repo, { terminals: Array.from({ length: 12 }, (_, i) => ({ name: 'T' + i, type: 'Shell', prompt: '', cwd: '' })), urls: [] }, false, '');
        return JSON.stringify({ title: ObjC.unwrap(built.alert.messageText), rows: rows(built), buttons: titles(built.alert),
            fresh: titles(buildPresetEditor(repo, draft, false, 'Hinweis').alert),
            note: ObjC.unwrap(buildPresetEditor(repo, draft, false, 'Hinweis').alert.informativeText),
            urls: ObjC.unwrap(built.urls.stringValue), counts: [built.rows.length, eight.rows.length, many.rows.length],
            popupItems: Array.from({ length: built.rows[0].popup.numberOfItems }, (_, i) => ObjC.unwrap(built.rows[0].popup.itemTitleAtIndex(i))) });`));
    assert.equal(out.title, 'Preset · alpha');
    assert.deepEqual(out.rows.slice(0, 3), [['Eigener Befehl', 'Dev', 'npm run dev', 'frontend'], ['Claude Code', 'Agent', '', ''], ['–', '', '', '']]);
    assert.deepEqual(out.counts, [6, 8, 12]);                                       // mindestens 6, so viele wie nötig, höchstens 12
    assert.deepEqual(out.buttons, ['Speichern', 'Abbrechen', 'Standard wiederherstellen']);
    assert.deepEqual(out.fresh, ['Speichern', 'Abbrechen']);
    assert.equal(out.note, 'Hinweis');
    assert.equal(out.urls, 'http://a.test, http://b.test');
    assert.deepEqual(out.popupItems, ['–', 'Shell', 'Claude Code', 'Codex', 'Codex 2', 'Antigravity', 'Eigener Befehl']);
});

test('Preset-Editor: Auslesen überspringt freie Zeilen und trennt die Tabs sauber', () => {
    const out = JSON.parse(widgets(`
        const built = buildPresetEditor({ name: 'alpha' }, { terminals: [], urls: [] }, false, '');
        const fill = (row, type, name, prompt, cwd) => {
            row.popup.selectItemWithTitle($(type)); row.name.stringValue = $(name);
            row.prompt.stringValue = $(prompt); row.cwd.stringValue = $(cwd);
        };
        fill(built.rows[1], 'Codex 2', '  Mein Codex ', 'Räum "auf" it\\'s', ' src ');
        fill(built.rows[4], 'Eigener Befehl', '', 'npm test', '');
        built.urls.stringValue = $(' http://a.test ,, http://b.test , ');
        const empty = buildPresetEditor({ name: 'x' }, { terminals: [], urls: [] }, false, '');
        return JSON.stringify({ collected: collectPreset(built), empty: collectPreset(empty) });`));
    assert.deepEqual(out.collected.terminals, [
        { type: 'Codex 2', name: 'Mein Codex', prompt: 'Räum "auf" it\'s', cwd: 'src' },
        { type: 'Eigener Befehl', name: '', prompt: 'npm test', cwd: '' }]);          // leerer Name: das Modul setzt den Typ ein
    assert.deepEqual(out.collected.urls, ['http://a.test', 'http://b.test']);
    assert.deepEqual(out.empty, { terminals: [], urls: [] });
});

test('Preset-Editor und -Auswahl: Speichern, Abbrechen, Zurücksetzen, Repository-Wahl', () => {
    const out = JSON.parse(widgets(`
        const app = { chooseFromList: (items) => { app.items = items; return choice; } };
        const ui = nativeUi(app);
        const draft = { terminals: [{ name: 'Dev', type: 'Shell', prompt: '', cwd: '' }], urls: [] };
        const repo = { name: 'alpha' };
        response = FIRST; const saved = ui.editPreset(repo, draft, true, '');
        response = FIRST + 1; const cancelled = ui.editPreset(repo, draft, true, '');
        response = FIRST + 2; const reset = ui.editPreset(repo, draft, true, '');
        response = FIRST + 2; const noThird = ui.editPreset(repo, draft, false, '');
        const repos = [{ name: 'a', custom: true }, { name: 'b', custom: false }];
        choice = ['b']; const picked = ui.pickRepo(repos);
        choice = ['a   ✓ hat ein Preset']; const marked = ui.pickRepo(repos);
        choice = false; const none = ui.pickRepo(repos);
        response = FIRST; const yesReset = ui.confirmResetPreset('alpha');
        response = FIRST + 1; const noMove = ui.confirmMovePreset('alt', '/neu/pfad');
        return JSON.stringify({ saved, cancelled, reset, noThird, picked, marked, none, yesReset, noMove, items: app.items, seen });`, `
        let response;
        let choice;
        const seen = [];
        function scriptedPresent(alert) { seen.push([ObjC.unwrap(alert.messageText), ObjC.unwrap(alert.informativeText)]); return response; }`));
    assert.deepEqual(out.saved, { terminals: [{ type: 'Shell', name: 'Dev', prompt: '', cwd: '' }], urls: [] });
    assert.equal(out.cancelled, null);
    assert.deepEqual(out.reset, { reset: true });
    assert.deepEqual(out.noThird.terminals.length, 1);                              // ohne Preset gibt es keinen dritten Knopf
    assert.deepEqual(out.picked, { name: 'b', custom: false });
    assert.deepEqual(out.marked, { name: 'a', custom: true });
    assert.equal(out.none, null);
    assert.deepEqual(out.items, ['a   ✓ hat ein Preset', 'b']);
    assert.equal(out.yesReset, true);
    assert.equal(out.noMove, false);
    const confirms = out.seen.slice(-2);
    assert.equal(confirms[0][0], 'Preset von „alpha“ zurücksetzen?');
    assert.match(confirms[1][1], /unter\n\/neu\/pfad\nübertragen/);
});

test('Preset-Aufrufe an vibecode.py: das Preset geht als JSON und sicher gequotet', () => {
    const out = JSON.parse(jxa(`${library}
const seen = [];
const app = { doShellScript: (command) => { seen.push(command); return '{"message": "ok"}'; } };
function run() {
    const backend = makeBackend(app, '/usr/bin/python3', '/c/vibecode.py');
    backend.preset('save', { path: "/g/My Repo", data: { terminals: [{ name: 'A', type: 'Shell', prompt: "it's", cwd: '' }], urls: [] } });
    backend.preset('reset', { path: '/g/a' });
    backend.preset('move', { path: '/alt/a', to: '/neu/a' });
    return JSON.stringify(seen);
}`));
    const base = "'/usr/bin/python3' '/c/vibecode.py' 'presets'";
    assert.deepEqual(out, [
        `${base} 'save' '--json' '--path=/g/My Repo' '--data={"terminals":[{"name":"A","type":"Shell","prompt":"it'\\''s","cwd":""}],"urls":[]}'`,
        `${base} 'reset' '--json' '--path=/g/a'`,
        `${base} 'move' '--json' '--path=/alt/a' '--to=/neu/a'`,
    ]);
});

test('echter Roundtrip: ein Preset mit Umlaut, Anführungszeichen und $() erreicht vibecode.py unverändert', (t) => {
    const dir = fs.mkdtempSync('/private/tmp/vibecode-test-');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const fake = path.join(dir, 'fake core', 'vibecode.py');
    fs.mkdirSync(path.dirname(fake));
    fs.writeFileSync(fake, `import json, sys
data = [a for a in sys.argv if a.startswith('--data=')][0][len('--data='):]
print(json.dumps({'message': json.dumps(json.loads(data), ensure_ascii=False)}, ensure_ascii=False))
`);
    const preset = { terminals: [{ name: 'Ä', type: 'Claude Code', prompt: 'Räum "auf" it\'s $(rm -rf ~) `x` \\', cwd: 'a b' }], urls: ['http://x.test/?a=1&b=2'] };
    const echoed = JSON.parse(JSON.parse(jxa(`${library}
function run(argv) {
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    return JSON.stringify(makeBackend(app, argv[0], argv[1]).preset('save', { path: '/g/a', data: ${JSON.stringify(preset)} }).message);
}`, [execFileSync('/usr/bin/which', ['python3'], { encoding: 'utf8' }).trim(), fake])));
    assert.deepEqual(echoed, preset);
});
