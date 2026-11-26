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
    canLaunch: true,
    entries: [{ id: 'local', title: 'Local Dev', status: null }],
    settings: { wake: { enabled: false, text: 'Wachhalten AUS · Apps: Codex', level: 'off' } },
}, overrides);

const SSH = {
    available: true, guided: true, share: true, errors: [],
    hosts: [{ host: 'spark', root: '~/projects', repos: 12 }],
    mac: { user: 'user', host: 'remote-mac.local', port: 22 },
};
const SPARK = { kind: 'host', name: 'spark', title: 'spark', detail: 'SSH-Host' };
const REMOTE_MAC = { kind: 'mac', name: 'remote-mac.local', title: 'user@remote-mac.local', detail: 'Mac · direkter Zugang' };
const SSH_JSON = JSON.stringify(SSH);
const ssh = (overrides = {}) => STATE({ ssh: Object.assign({}, SSH, overrides) });
const result = (code, out, err = '') => ({ code, out, err });
// Antwort des Remote-Moduls auf „share“: der Zustand als JSON.
const SHARE = (extra = {}) => Object.assign({ remoteLogin: true, awake: false, line: 'workspace remote ssh join t@h.local SHA256:abc',
    fingerprint: true, copied: true, settingsOpened: false }, extra);
const shareResult = (extra) => result(0, JSON.stringify(SHARE(extra)));
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
    edit: (state, draft, existing, message, local) => { calls.push(['edit', draft, existing && existing.name, message, local]); return next('edit'); },
    confirmDelete: (name) => { calls.push(['confirmDelete', name]); return next('confirmDelete'); },
    info: (text) => calls.push(['info', text]),
    error: (text) => calls.push(['error', text]),
    askConnection: (canGuide, prefill, note) => { calls.push(['askConnection', canGuide, prefill, note]); return next('askConnection'); },
    clipboardJoinLine: () => script.clipboardJoinLine || '',
    notify: (text) => calls.push(['notify', text]),
    askLine: (title, prompt, prefill) => { calls.push(['askLine', title, prefill]); return next('askLine'); },
    share: (share, notice, canInvite) => { calls.push(['share', share, notice, canInvite]); return next('share'); },
    pickTailscaleDevice: (devices) => { calls.push(['pickTailscaleDevice', devices.map((d) => d.name)]); return next('pickTailscaleDevice'); },
    confirmInvite: (invite) => { calls.push(['confirmInvite', invite.device, invite.user]); return next('confirmInvite'); },
    copy: (text) => calls.push(['copy', text]),
    infoWithCopy: (text, copyText) => calls.push(['infoWithCopy', text, copyText]),
    clipboardAllowLine: () => script.clipboardAllowLine || '',
    confirmAllow: (name, fingerprint) => { calls.push(['confirmAllow', name, fingerprint]); return next('confirmAllow'); },
    confirmRevoke: (name, fingerprint) => { calls.push(['confirmRevoke', name, fingerprint]); return next('confirmRevoke'); },
    pickFolders: () => { calls.push(['pickFolders']); return next('pickFolders'); },
    askRemoteFolder: (note, host, known) => { calls.push(['askRemoteFolder', note, host, known]); return next('askRemoteFolder'); },
    confirmRemoveFolder: (label) => { calls.push(['confirmRemoveFolder', label]); return next('confirmRemoveFolder'); },
    editPreset: (repo, draft, custom, note, combos) => { calls.push(['editPreset', repo.name, draft, custom, note]); if (combos && combos.length) calls.push(['presetCombos', combos]); return next('editPreset'); },
    pickRepo: (repos) => { calls.push(['pickRepo', repos.map((repo) => repo.name)]); return next('pickRepo'); },
    pickLocalDev: (choices, kind) => { calls.push(kind === undefined ? ['pickLocalDev', choices] : ['pickLocalDev', choices, kind]); return next('pickLocalDev'); },
    confirmResetPreset: (label, effect) => { calls.push(['confirmResetPreset', label, effect]); return next('confirmResetPreset'); },
    confirmMovePreset: (label, target) => { calls.push(['confirmMovePreset', label, target]); return next('confirmMovePreset'); },
    confirmTailscale: (kind) => { calls.push(['confirmTailscale', kind]); return next('confirmTailscale'); },
    confirmModelPull: (name) => { calls.push(['confirmModelPull', name]); return next('confirmModelPull'); },
    confirmModelRemove: (name) => { calls.push(['confirmModelRemove', name]); return next('confirmModelRemove'); },
    askModelName: () => { calls.push(['askModelName']); return next('askModelName'); },
    showAgents: (model) => { calls.push(['showAgents', model.text, model.remoteLabel]); return next('showAgents'); },
    askTailscaleDevice: (devices, user) => { calls.push(['askTailscaleDevice', devices.map((d) => d.name), user]); return next('askTailscaleDevice'); },
};
const backend = {
    state: () => { calls.push(['state']); return script.state; },
    save: (workspace) => { calls.push(['save', workspace]); const failure = (script.saveErrors || []).shift(); if (failure) throw new Error(failure); },
    remove: (name) => calls.push(['remove', name]),
    localSettings: () => {
        calls.push(['localSettings']);
        if (script.localSettingsError) throw new Error(script.localSettingsError);
        return script.localSettings;
    },
    setLocalDefault: (value) => { calls.push(['setLocalDefault', value]); if (script.setDefaultError) throw new Error(script.setDefaultError); },
    localDevOptions: () => {
        calls.push(['localDevOptions']);
        if (script.localOptionsError) throw new Error(script.localOptionsError);
        return script.localOptions || { available: false, options: [], error: null };
    },
    quickWorkspace: (name, enabled) => { calls.push(['quickWorkspace', name, enabled]); if (script.quickWorkspaceError) throw new Error(script.quickWorkspaceError); },
    start: (name) => { calls.push(['start', name]); if (script.startError) throw new Error(script.startError); },
    open: (id) => { calls.push(['open', id]); if (script.openError) throw new Error(script.openError); },
    syncShortcuts: () => { calls.push(['sync']); return '2 Shortcuts erneuert.'; },
    setting: (name, enabled) => { calls.push(['setting', name, enabled]); if (script.settingError) throw new Error(script.settingError); },
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
    agents: (scope) => { calls.push(['agents', scope]); return next('agentsResults'); },
    tailscale: (action) => { calls.push(['tailscale', action]); const answer = next('tailscaleResults'); if (answer && answer.throw) throw new Error(answer.throw); return answer; },
    combo: (action, value) => { calls.push(['combo', action, value]); const answer = next('comboResults'); if (answer && answer.throw) throw new Error(answer.throw); return answer; },
    model: (action, name) => { calls.push(['model', action, name]); const answer = next('modelResults'); if (answer && answer.throw) throw new Error(answer.throw); return answer; },
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

test('Workspace anlegen: Namenskonflikt zeigt die Meldung und behält alle Eingaben', () => {
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
    assert.match(calls.find((c) => c[0] === 'error')[1], /Reiter „Projekte“.*Suchordner/);
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
    const calls = flowRun({ state: ssh(), dashboard: [sshShare, back], sshResults: [shareResult({ awake: true })],
        share: ['done'] });
    assert.equal(kinds(calls).filter((k) => k === 'state').length, kinds(calls).filter((k) => k === 'dashboard').length);
});

const JOIN = 'workspace remote ssh join user@remote-mac.local SHA256:abc';

test('SSH: Neue Verbindung ist ein einziger Dialog, die geführte Einrichtung ein Knopf darin', () => {
    const calls = flowRun({ state: ssh(), dashboard: [sshNew], askConnection: [{ guided: true }] });
    assert.deepEqual(calls.find((c) => c[0] === 'askConnection'), ['askConnection', true, '', '']);   // keine Vorauswahl davor
    assert.deepEqual(calls.find((c) => c[0] === 'sshOpen'), ['sshOpen', 'guided', null]);
    assert.equal(kinds(calls).filter((k) => k === 'dashboard').length, 1);                          // das Terminal übernimmt: Fenster zu
});

test('SSH: ohne Remote-Modul geht es direkt zur geführten Einrichtung, ohne Modul gibt es eine Meldung', () => {
    const only = flowRun({ state: ssh({ share: false }), dashboard: [sshNew] });
    assert.ok(!kinds(only).includes('askConnection'));                                              // nichts zu fragen
    assert.deepEqual(only.find((c) => c[0] === 'sshOpen'), ['sshOpen', 'guided', null]);
    const none = flowRun({ state: ssh({ share: false, guided: false, hosts: [SPARK] }), dashboard: [sshNew, back] });
    assert.match(none.find((c) => c[0] === 'error')[1], /fehlt ein Modul/);
    assert.ok(!kinds(none).includes('sshOpen') && !kinds(none).includes('askConnection'));
    const noGuide = flowRun({ state: ssh({ guided: false }), dashboard: [sshNew, back], askConnection: [null] });
    assert.equal(noGuide.find((c) => c[0] === 'askConnection')[1], false);                          // ohne Setup kein Knopf dafür
});

test('SSH: eine join-Zeile in der Zwischenablage ist schon eingetragen, sonst bleibt das Feld leer', () => {
    const withClip = flowRun({ state: ssh(), dashboard: [sshNew, back], clipboardJoinLine: JOIN, askConnection: [null] });
    assert.equal(withClip.find((c) => c[0] === 'askConnection')[2], JOIN);
    const without = flowRun({ state: ssh(), dashboard: [sshNew, back], askConnection: [null] });
    assert.equal(without.find((c) => c[0] === 'askConnection')[2], '');
});

test('SSH: Verbinden per Zeile – sofort ein Hinweis, dann das Ergebnis; bereits freigegeben', () => {
    const calls = flowRun({
        state: ssh(), dashboard: [sshNew, back], askConnection: [{ line: JOIN }],
        sshResults: [result(0, '✔ Verbunden mit user@remote-mac.local. Befehle: workspace remote ssh run -- <befehl>')],
    });
    const order = calls.map((c) => c[0]).filter((k) => ['askConnection', 'notify', 'ssh', 'info'].includes(k));
    assert.deepEqual(order, ['askConnection', 'notify', 'ssh', 'info']);                            // der Hinweis kommt VOR dem langen Prüfen
    assert.match(calls.find((c) => c[0] === 'notify')[1], /^Verbinde mit user@remote-mac\.local .*30 Sekunden/);
    assert.deepEqual(calls.find((c) => c[0] === 'ssh' && c[1] === 'join'), ['ssh', 'join', JOIN]);
    assert.equal(calls.find((c) => c[0] === 'info')[1],
        'Verbunden mit user@remote-mac.local ✓\n\nIm Bereich Remote kannst du jetzt auf „Verbinden“ klicken.');
    assert.ok(!calls.find((c) => c[0] === 'info')[1].includes('workspace remote'));                 // CLI-Hinweis gehört nicht ins Fenster
});

test('SSH: eine leere Zeile fragt noch einmal nach und startet nichts', () => {
    const calls = flowRun({
        state: ssh(), dashboard: [sshNew, back], askConnection: [{ line: '' }, { line: '   ' }, { line: JOIN }],
        sshResults: [result(0, '✔ Verbunden mit x. Befehle: y')],
    });
    const asked = calls.filter((c) => c[0] === 'askConnection');
    assert.deepEqual(asked.map((c) => c[3]), ['', 'Bitte die Zeile einfügen.', 'Bitte die Zeile einfügen.']);
    assert.equal(calls.filter((c) => c[0] === 'ssh' && c[1] === 'join').length, 1);
});

test('SSH: noch nicht freigegeben zeigt nur die allow-Zeile und sagt, was am anderen Mac zu tun ist', () => {
    const cli = [
        'Noch nicht freigegeben. Auf dem Remote-Mac ausführen (in der Zwischenablage):',
        "  workspace remote ssh allow 'ssh-ed25519 AAAAkey user@client'",
        'Fingerprint dieses Schlüssels: SHA256:xyz',
        'Danach hier: workspace remote ssh join',
    ].join('\n');
    const calls = flowRun({
        state: ssh(), dashboard: [sshNew, back], askConnection: [{ line: 'workspace remote ssh join user@remote-mac.local' }],
        sshResults: [result(2, cli)],
    });
    const [, text, copyText] = calls.find((c) => c[0] === 'infoWithCopy');
    assert.equal(copyText, "workspace remote ssh allow 'ssh-ed25519 AAAAkey user@client'");                // der Kopieren-Knopf kopiert genau diese Zeile
    assert.ok(!kinds(calls).includes('info'));
    assert.match(text, /^Noch nicht freigegeben: Der andere Mac muss dich noch freigeben\./);
    assert.ok(text.includes("workspace remote ssh allow 'ssh-ed25519 AAAAkey user@client'"));
    assert.match(text, /1\. Dort: .*Diesen Mac freigeben… → Schlüssel eintragen/);
    assert.match(text, /2\. Danach hier im Bereich Remote auf „Verbinden“ klicken\.$/);
    assert.ok(!text.includes('Danach hier: workspace remote ssh join'));
});

test('SSH: Fehler bei der Verbindung und Abbruch ändern nichts, ein Fehler nennt den Grund', () => {
    const failed = flowRun({
        state: ssh(), dashboard: [sshNew, back], askConnection: [{ line: 'x' }],
        sshResults: [result(1, '', 'user@remote-mac.local:22 nicht erreichbar (timed out)')],
    });
    assert.deepEqual(failed.find((c) => c[0] === 'error'), ['error', 'user@remote-mac.local:22 nicht erreichbar (timed out)']);
    assert.equal(failed.filter((c) => c[0] === 'notify').length, 1);                                // gemeldet wurde: es läuft

    const cancelled = flowRun({ state: ssh(), dashboard: [sshNew, sshNew, back], askConnection: [null, null] });
    assert.ok(!kinds(cancelled).includes('error') && !kinds(cancelled).includes('notify'));
    assert.equal(cancelled.filter((c) => c[0] === 'ssh' && typeof c[1] === 'string').length, 0);   // kein Backend-Aufruf
});

test('SSH: Diesen Mac freigeben – Status, Wach halten, dann Schlüssel mit Bestätigung eintragen', () => {
    const asleep = SHARE({ awake: false });
    const awake = SHARE({ awake: true });
    const key = JSON.stringify({ name: 'user@client', fingerprint: 'SHA256:xyz', known: false });
    const calls = flowRun({
        state: ssh(), dashboard: [sshShare, back],
        sshResults: [result(0, JSON.stringify(asleep)), result(0, JSON.stringify(awake)), result(0, key), result(0, 'Freigegeben.')],
        share: ['wake', 'allow'], askLine: ["workspace remote ssh allow 'ssh-ed25519 AAAA user@client'"],
        confirmAllow: [true],
    });
    const backend = calls.filter((c) => c[0] === 'ssh' && typeof c[1] === 'string' && c.length === 3);
    assert.deepEqual(backend.map((c) => c[1]), ['share', 'share-wake', 'allow-check', 'allow']);
    assert.deepEqual(calls.filter((c) => c[0] === 'share').map((c) => c[1]), [asleep, awake]);      // die Maske bekommt den Zustand, keinen Text
    assert.deepEqual(calls.find((c) => c[0] === 'confirmAllow'), ['confirmAllow', 'user@client', 'SHA256:xyz']);
    assert.match(calls.find((c) => c[0] === 'info')[1], /^Freigegeben: user@client\./);
});

test('SSH: Entfernte Anmeldung aus: „Erneut prüfen“ fragt nach, ohne die Systemeinstellungen wieder zu öffnen', () => {
    const off = SHARE({ remoteLogin: false, line: '', fingerprint: false, copied: false, settingsOpened: true });
    const calls = flowRun({
        state: ssh(), dashboard: [sshShare, back],
        sshResults: [result(0, JSON.stringify(off)), result(0, JSON.stringify(off)), shareResult({ awake: true })],
        share: ['recheck', 'recheck', 'done'],
    });
    const backend = calls.filter((c) => c[0] === 'ssh' && c.length === 3);
    assert.deepEqual(backend.map((c) => c[1]), ['share', 'share-recheck', 'share-recheck']);   // nur das erste Mal öffnet es die Einstellungen
    assert.equal(calls.filter((c) => c[0] === 'share').length, 3);
    assert.equal(calls.filter((c) => c[0] === 'share').at(-1)[1].remoteLogin, true);            // nach dem Einschalten geht es weiter
});

test('SSH: „Zeile kopieren“ kopiert die Zeile, sagt es und zeigt die Maske wieder, ohne das Modul noch einmal zu fragen', () => {
    const calls = flowRun({
        state: ssh(), dashboard: [sshShare, back], sshResults: [shareResult({ awake: true })],
        share: ['copy', 'copy', 'done'],
    });
    assert.deepEqual(calls.filter((c) => c[0] === 'copy'), [['copy', SHARE().line], ['copy', SHARE().line]]);
    assert.deepEqual(calls.filter((c) => c[0] === 'share').map((c) => c[2]), ['', 'Zeile kopiert ✓', 'Zeile kopiert ✓']);   // die Rückmeldung gilt nur einmal
    assert.equal(calls.filter((c) => c[0] === 'ssh' && c.length === 3).length, 1);                                         // nur das erste share
});

test('SSH: „Schlüssel eintragen…“ füllt eine allow-Zeile aus der Zwischenablage vor und gibt trotzdem erst nach Bestätigung frei', () => {
    const line = "workspace remote ssh allow 'ssh-ed25519 AAAAkey user@client'";
    const key = JSON.stringify({ name: 'user@client', fingerprint: 'SHA256:xyz', known: false });
    const calls = flowRun({
        state: ssh(), dashboard: [sshShare, back], sshResults: [shareResult(), result(0, key)],
        share: ['allow'], clipboardAllowLine: line, askLine: [line], confirmAllow: [false],
    });
    assert.deepEqual(calls.find((c) => c[0] === 'askLine'), ['askLine', 'Schlüssel eintragen', line]);
    assert.ok(calls.some((c) => c[0] === 'confirmAllow'));                                          // die Bestätigung bleibt Pflicht
    assert.ok(!calls.some((c) => c[0] === 'ssh' && c[1] === 'allow'));                              // und ohne Ja wird nichts geschrieben
    const without = flowRun({ state: ssh(), dashboard: [sshShare, back], sshResults: [shareResult()], share: ['allow'], askLine: [null] });
    assert.equal(without.find((c) => c[0] === 'askLine')[2], '');
});

test('SSH: nur genau eine allow-Zeile mit einem Schlüssel wird aus der Zwischenablage übernommen', () => {
    const out = JSON.parse(widgets(`
        const good = "workspace remote ssh allow 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIabc user@client'";
        const cases = [good, '  ' + good + '\\n', "workspace remote ssh allow 'ssh-ed25519 AAAA'", "workspace remote ssh allow 'ecdsa-sha2-nistp256 AAAA+/= x'",
            'workspace remote ssh allow ssh-ed25519 AAAA x', "workspace remote ssh allow 'rm -rf ~'", "workspace remote ssh allow 'ssh-ed25519 AAAA x' ; rm -rf ~",
            good + '\\n' + good, "workspace remote ssh join a@b", '', null, 5, "workspace remote ssh allow 'ssh-ed25519 AAAA " + "x".repeat(300) + "'"];
        const pick = (app) => nativeUi(app).clipboardAllowLine();
        return JSON.stringify({ parsed: cases.map(allowLineFrom), ok: pick({ theClipboard: () => good }),
            nonText: pick({ theClipboard: () => { throw new Error('kein Text'); } }) });`));
    assert.deepEqual(out.parsed.map((line) => line !== ''), [true, true, true, true, false, false, false, false, false, false, false, false, false]);
    assert.ok(out.parsed[1].startsWith("workspace remote ssh allow 'ssh-ed25519") && !out.parsed[1].includes('\n'));
    assert.equal(out.nonText, '');
    assert.match(out.ok, /^workspace remote ssh allow '/);
});

test('SSH: eine unlesbare Antwort des Moduls wird gesagt, statt eine leere Maske zu zeigen', () => {
    for (const out of ['', 'Entfernte Anmeldung  AN', '[]x']) {
        const calls = flowRun({ state: ssh(), dashboard: [sshShare, back], sshResults: [result(0, out)], share: [] });
        assert.deepEqual(calls.find((c) => c[0] === 'error'), ['error', 'Die Antwort des Remote-Moduls war nicht lesbar.']);
        assert.ok(!kinds(calls).includes('share'));
    }
});

test('SSH: ein abgelehnter oder schon bekannter Schlüssel wird nicht geschrieben', () => {
    const line = "workspace remote ssh allow 'ssh-ed25519 AAAA n'";
    const declined = flowRun({
        state: ssh(), dashboard: [sshShare, back],
        sshResults: [shareResult(), result(0, JSON.stringify({ name: 'n', fingerprint: 'SHA256:f', known: false }))],
        share: ['allow'], askLine: [line], confirmAllow: [false],
    });
    assert.ok(!declined.some((c) => c[0] === 'ssh' && c[1] === 'allow'));

    const known = flowRun({
        state: ssh(), dashboard: [sshShare, back],
        sshResults: [shareResult(), result(0, JSON.stringify({ name: 'n', fingerprint: 'SHA256:f', known: true }))],
        share: ['allow'], askLine: [line],
    });
    assert.ok(!known.some((c) => c[0] === 'confirmAllow' || (c[0] === 'ssh' && c[1] === 'allow')));
    assert.match(known.find((c) => c[0] === 'info')[1], /schon freigegeben/);

    const invalid = flowRun({
        state: ssh(), dashboard: [sshShare, back],
        sshResults: [shareResult(), result(1, '', 'Erwartet wird genau eine Zeile')],
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

test('Suchordner: der Host des verbundenen Macs ist vorbelegt (auch ein Tailscale-Name), außer bei einem anderen Port', () => {
    const asked = (mac) => flowRun({ state: Object.assign(withFolders(), { ssh: Object.assign({}, SSH, { mac }) }), dashboard: [{ action: 'addRemoteFolder' }, back], askRemoteFolder: [null] })
        .filter((c) => c[0] === 'askRemoteFolder');
    assert.deepEqual(asked({ user: 'user', host: 'remote-mac.example-tailnet.ts.net', port: 22 }),
        [['askRemoteFolder', '', 'user@remote-mac.example-tailnet.ts.net', ['user@remote-mac.example-tailnet.ts.net', 'spark']]]);
    assert.deepEqual(asked({ user: '', host: '100.64.0.5', port: 22 }), [['askRemoteFolder', '', '100.64.0.5', ['100.64.0.5', 'spark']]]);
    assert.deepEqual(asked({ user: 'user', host: '100.64.0.5', port: 2222 }), [['askRemoteFolder', '', null, ['spark']]]);   // ein Port passt nicht in den Host-Text
    assert.deepEqual(asked(null), [['askRemoteFolder', '', null, ['spark']]]);
});

test('Suchordner: das Dropdown nennt erst die verbundenen Geräte, dann online erreichbare Macs aus dem Tailnet, ohne Doppelte', () => {
    const devices = [DEVICE('studio', { ip: '100.64.0.9' }), DEVICE('nas', { dns: '', ip: '100.64.0.6' }),
        DEVICE('alt', { online: false, ip: '100.64.0.7' }), DEVICE('phone', { os: 'iOS', ip: '100.64.0.8' }),
        DEVICE('studio-zwei', { dns: 'Studio.example-tailnet.ts.net.', ip: '100.64.0.10' })];
    const known = (extra) => flowRun({
        state: Object.assign(withFolders(), extra), dashboard: [{ action: 'addRemoteFolder' }, back], askRemoteFolder: [null] })
        .find((c) => c[0] === 'askRemoteFolder')[3];
    const mac = { user: 'user', host: 'remote-mac.local', port: 22 };
    assert.deepEqual(known({ ssh: Object.assign({}, SSH, { mac }), tailscale: TS({ devices, localUser: 'user' }) }), [
        'user@remote-mac.local', 'spark',                                              // schon verbunden
        'user@studio.example-tailnet.ts.net', 'user@100.64.0.6',                       // online im Tailnet (ohne Namen: die Adresse)
        // „alt“ ist offline und „phone“ ein Telefon; „studio-zwei“ ist derselbe Name wie „studio“ (Großschreibung, Punkt am Ende)
    ]);
    // Ohne laufendes Tailscale nur die verbundenen; ohne bekannten Benutzer ohne „benutzer@“; ein anderer Port fehlt.
    assert.deepEqual(known({ ssh: Object.assign({}, SSH, { mac }), tailscale: TS({ state: 'stopped', devices, localUser: 'user' }) }), ['user@remote-mac.local', 'spark']);
    assert.deepEqual(known({ ssh: Object.assign({}, SSH, { mac: Object.assign({}, mac, { port: 2222 }) }), tailscale: TS({ devices: [DEVICE('studio')] }) }),
        ['spark', 'studio.example-tailnet.ts.net']);
    assert.deepEqual(known({ ssh: Object.assign({}, SSH, { mac: null, hosts: [] }), tailscale: { available: false } }), []);
});

// ------------------------------------------------------------------ Tailscale

const TS = (extra = {}) => Object.assign({ available: true, variant: 'cli', state: 'running', name: 'remote-mac.example-tailnet.ts.net',
    ip: '100.64.0.5', tailnet: 'example-tailnet.ts.net', auto: false, autoError: '', ours: false, devices: [] }, extra);

test('Übersicht: der Tailscale-Bereich zeigt je Zustand Punkt, Text und genau die passenden Knöpfe', () => {
    const rows = (tailscale) => JSON.parse(widgets(`return JSON.stringify(dashboardRows(Object.assign({}, STATE, { tailscale: ${JSON.stringify(tailscale)} })));`));
    const item = (tailscale) => rows(tailscale).find((row) => row.type === 'item' && row.title === 'Verbindung');
    const cases = [
        ['missing', 'off', 'nicht installiert', ['Einrichten…']],
        ['daemon-down', 'warn', 'Dienst antwortet nicht', ['Einrichten…']],
        ['denied', 'warn', 'Zugriff verweigert', ['Einrichten…']],
        ['needs-login', 'warn', 'nicht angemeldet', ['Anmelden…']],
        ['needs-approval', 'warn', 'wartet auf Freigabe im Tailnet', []],
        ['starting', 'warn', 'verbindet …', []],
        ['stopped', 'off', 'getrennt', ['Verbinden', 'Abmelden…']],
        ['running', 'ok', 'verbunden', ['Trennen', 'Geräte…', 'Abmelden…']],
        ['etwas-neues', 'warn', 'Status unbekannt', []],
    ];
    cases.forEach(([state, level, text, buttons]) => {
        const row = item(TS({ state }));
        assert.equal(row.level, level, state);
        assert.ok(row.detail.startsWith(text), `${state}: ${row.detail}`);
        assert.deepEqual(row.buttons.map((b) => b.label), buttons, state);
        // „Aktualisieren“ gibt es in jedem Zustand, als Fußzeile des Bereichs: nach dem Einrichten im Terminal oder der Anmeldung im
        // Browser liest die Übersicht den Stand sonst nicht neu (so blieb „nicht installiert“ stehen, obwohl alles fertig war).
        const footers = rows(TS({ state })).filter((r) => r.type === 'footer' && r.buttons.some((b) => b.label === 'Aktualisieren'));
        assert.equal(footers.length, 1, state);
        assert.deepEqual(footers[0].buttons.at(-1).action, { action: 'tailscaleRefresh' });                  // „Aktualisieren“ steht immer zuletzt
    });
    const running = item(TS({ ours: true }));
    assert.equal(running.detail, 'verbunden · Kommandozeile · von VibeCode gestartet');
    assert.match(item(TS({ state: 'stopped', variant: 'app' })).detail, /getrennt · App$/);
    assert.ok(!/100\.64/.test(item(TS({ state: 'stopped' })).detail));               // Name und Adresse nur, solange verbunden
});

test('Übersicht: der Schalter „Mit VibeCode starten und beenden“ ist ein Kästchen und sagt, was er tut', () => {
    const rows = (tailscale) => JSON.parse(widgets(`return JSON.stringify(dashboardRows(Object.assign({}, STATE, { tailscale: ${JSON.stringify(tailscale)} })));`));
    const sw = (tailscale) => rows(tailscale).find((row) => row.title === 'Mit VibeCode starten und beenden');
    const off = sw(TS());
    assert.deepEqual(off.buttons.map((b) => [b.label, b.checkbox, b.checked]), [['Aktiv', true, false]]);
    assert.deepEqual(off.buttons[0].action, { action: 'tailscaleAuto', enabled: true });
    assert.equal(off.level, 'none');                                                  // eine Einstellung ist kein Zustand: kein Punkt
    const on = sw(TS({ auto: true }));
    assert.equal(on.level, 'none');
    assert.deepEqual(on.buttons[0].action, { action: 'tailscaleAuto', enabled: false });
    assert.match(on.detail, /Startet mit jedem Workspace, endet nach dem letzten VibeCode-Editor-Fenster/);
    assert.ok(sw(TS({ state: 'missing' })));                                          // auch vor der Einrichtung einstellbar
    assert.ok(rows(TS({ autoError: 'tailscale.json ist ungültig.' })).some((row) => row.type === 'note' && /⚠︎ tailscale\.json ist ungültig/.test(row.text)));
});

const remoteTab = (extra) => JSON.parse(widgets(`return JSON.stringify(tabRows(Object.assign({}, STATE, ${JSON.stringify(extra)}), "remote"));`));

test('Remote ordnet nach Richtung: erst Tailscale, dann Verbindungen von diesem Mac, dann Zugriff auf diesen Mac', () => {
    const rows = remoteTab({ ssh: SSH, tailscale: TS() });
    const sections = rows.filter((row) => row.type === 'section').map((row) => row.text);
    assert.deepEqual(sections, ['Tailscale', 'Verbindungen von diesem Mac', 'Zugriff auf diesen Mac']);
    // Jeder Bereich endet mit den Knöpfen, die zu ihm gehören; die Einrichtung steht bei den Zielen, nicht in einem eigenen Bereich.
    const footerLabels = rows.filter((row) => row.type === 'footer').map((row) => row.buttons.map((b) => b.label));
    assert.deepEqual(footerLabels, [['Aktualisieren'], ['Neue Verbindung…', 'Geführte Einrichtung…'], ['Diesen Mac freigeben…', 'Einladungen abholen']]);
    const guide = rows.flatMap((row) => row.buttons || []).find((button) => button.label === 'Geführte Einrichtung…');
    const calls = flowRun({ state: ssh(), dashboard: [guide.action] });
    assert.deepEqual(calls.filter((call) => call[0] === 'sshOpen'), [['sshOpen', 'guided', null]]);
    // Ohne Ziele steht dort ein Satz statt einer leeren Fläche, und die Knöpfe bleiben.
    const empty = remoteTab({ ssh: Object.assign({}, SSH, { hosts: [], mac: null }), tailscale: TS() });
    assert.ok(empty.some((row) => row.type === 'note' && /Noch keine Verbindung/.test(row.text)));
    assert.deepEqual(empty.filter((row) => row.type === 'footer').map((row) => row.buttons.length), [1, 2, 2]);
});

test('Remote: ein Punkt steht nur für einen Zustand, der jetzt stimmt', () => {
    const rows = remoteTab({ ssh: Object.assign({}, SSH, { grants: [{ name: 'user@client.local', fingerprint: 'SHA256:abc' }] }),
        tailscale: TS({ auto: true }) });
    const level = (title) => rows.find((row) => row.type === 'item' && row.title === title).level;
    assert.equal(level('Verbindung'), 'ok');                                      // Tailscale läuft
    assert.equal(level('Mit VibeCode starten und beenden'), 'none');               // eine Einstellung: das Kästchen zeigt es
    assert.equal(level('user@client.local'), 'none');                              // eine Freigabe ist kein Zustand und sagt nichts über „online“
});

test('Remote: Ziele zeigen online/offline aus dem Tailnet, ohne einen SSH-Host zu kontaktieren, und erreichbare stehen oben', () => {
    const devices = [DEVICE('spark', { ip: '100.64.0.6' }),
        DEVICE('remote-mac', { online: false, ip: '100.64.0.7' }),
        DEVICE('station', { ip: '100.64.0.8' })];
    const ssh = Object.assign({}, SSH, {
        hosts: [{ host: 'build-server', root: '~', repos: 1 }, { host: 'spark', root: '~', repos: 1 }, { host: '100.64.0.8', root: '~', repos: 1 }],
        mac: { user: 'user', host: 'remote-mac.local', port: 22 } });
    const isTarget = (row) => row.buttons && row.buttons[0].action.action === 'connect';
    const targets = (tailscale) => remoteTab({ ssh, tailscale }).filter(isTarget);
    assert.deepEqual(targets(TS({ devices })).map((row) => [row.title, row.level, row.detail]), [
        ['spark', 'ok', 'SSH-Host · online im Tailnet'],                              // Name im Tailnet
        ['100.64.0.8', 'ok', 'SSH-Host · online im Tailnet'],                         // Adresse im Tailnet
        ['build-server', 'none', 'SSH-Host'],                                         // nicht im Tailnet: keine Aussage
        ['user@remote-mac.local', 'off', 'Mac · direkter Zugang · offline im Tailnet'],   // <name>.local gehört zum Gerät, das aber aus ist
    ]);
    // Dieselbe Zeile wie vorher: die Aktion bekommt unverändert das Ziel (kein Punkt oder Text darin).
    assert.deepEqual(targets(TS({ devices })).find((row) => row.title === 'spark').buttons[0].action, { action: 'connect', item: SPARK });
    // MagicDNS-Name, Großschreibung und ein Punkt am Ende zählen als derselbe Host.
    const dns = remoteTab({ ssh: Object.assign({}, SSH, { hosts: [], mac: { user: 'user', host: 'Remote-Mac.example-tailnet.ts.net.', port: 22 } }),
        tailscale: TS({ devices }) }).find(isTarget);
    assert.equal(dns.level, 'off');
    // Ohne laufendes Tailscale (oder ohne Geräteliste) gibt es nichts zu sagen: weder Punkt noch Text.
    for (const tailscale of [TS({ state: 'stopped', devices }), TS({ devices: [] }), { available: false }]) {
        assert.deepEqual(targets(tailscale).map((row) => [row.level, row.detail.includes('Tailnet')]).filter(([level, text]) => level !== 'none' || text), []);
    }
});

test('Wachhalten & Apps steht nur im Reiter Workspaces', () => {
    const wake = { enabled: true, text: 'An', level: 'ok', withApps: false };
    const state = STATE({ ssh: SSH, tailscale: TS(), settings: { wake } });
    const pages = JSON.parse(widgets(`return JSON.stringify(dashboardModel(${JSON.stringify(state)}));`));
    const tabsWithWakeSection = pages.filter((page) => page.rows.some((row) => row.type === 'section' && row.text === 'Wachhalten & Apps'));
    const tabsWithWakeControls = pages.filter((page) => page.rows.some((row) => (row.buttons || [])
        .some((button) => ['keep-awake', 'keep-awake-apps'].includes(button.action.name))));
    assert.deepEqual(tabsWithWakeSection.map((page) => page.id), ['workspaces']);
    assert.deepEqual(tabsWithWakeControls.map((page) => page.id), ['workspaces']);
});

test('Übersicht: ohne Remote-Modul gibt es keinen Tailscale-Bereich, ein Lesefehler zeigt nur eine Warnung', () => {
    const rows = (tailscale) => JSON.parse(widgets(`return JSON.stringify(dashboardRows(Object.assign({}, STATE, ${tailscale === undefined ? '{}' : `{ tailscale: ${JSON.stringify(tailscale)} }`})));`));
    assert.ok(!rows({ available: false }).some((row) => row.text === 'Tailscale'));
    assert.ok(!rows(undefined).some((row) => row.text === 'Tailscale'));
    const broken = rows({ available: true, error: 'Tailscale: Ungültige Antwort' });
    assert.ok(broken.some((row) => row.type === 'section' && row.text === 'Tailscale'));
    assert.deepEqual(broken.filter((row) => row.type === 'note' && /Ungültige Antwort/.test(row.text)).map((row) => row.level), ['warn']);
    assert.ok(!broken.some((row) => row.title === 'Verbindung'));
    assert.ok(broken.some((row) => row.type === 'footer' && row.buttons[0].label === 'Aktualisieren'));         // auch ein Lesefehler lässt sich neu laden
});

test('Tailscale: Einrichten bestätigt zuerst, öffnet dann nur das Terminal und bricht ohne Ja ab', () => {
    const state = STATE({ tailscale: TS({ state: 'missing', variant: 'missing' }) });
    const calls = flowRun({ state, dashboard: [{ action: 'tailscaleSetup' }, { action: 'tailscaleSetup' }, back], confirmTailscale: [false, true],
        tailscaleResults: ['Terminal geöffnet. Dort wird Tailscale eingerichtet.'] });
    assert.deepEqual(calls.filter((c) => c[0] === 'confirmTailscale'), [['confirmTailscale', 'setup'], ['confirmTailscale', 'setup']]);
    assert.deepEqual(calls.filter((c) => c[0] === 'tailscale'), [['tailscale', 'setup']]);               // nur beim Ja
    assert.deepEqual(calls.filter((c) => c[0] === 'info').map((c) => c[1]), ['Terminal geöffnet. Dort wird Tailscale eingerichtet.']);
});

test('Tailscale: Verbinden, Trennen und der Schalter rufen genau ihre feste Aktion auf', () => {
    const calls = flowRun({ state: STATE({ tailscale: TS() }), tailscaleResults: ['ok', 'ok', 'ok', 'ok'],
        dashboard: [{ action: 'tailscaleUp' }, { action: 'tailscaleDown' }, { action: 'tailscaleAuto', enabled: true },
            { action: 'tailscaleAuto', enabled: false }, { action: 'tailscaleRefresh' }, back] });
    assert.deepEqual(calls.filter((c) => c[0] === 'tailscale').map((c) => c[1]), ['up', 'down', 'auto-on', 'auto-off']);
    assert.equal(kinds(calls).filter((k) => k === 'dashboard').length, 6);                               // danach liest die Übersicht neu
});

test('Tailscale: Anmelden sagt vorher Bescheid, nennt den geöffneten Link und kennt „schon angemeldet“', () => {
    const url = 'https://login.example.invalid/a/abc123';
    const calls = flowRun({ state: STATE({ tailscale: TS({ state: 'needs-login' }) }), dashboard: [{ action: 'tailscaleLogin' }, { action: 'tailscaleLogin' }, back],
        tailscaleResults: [JSON.stringify({ url }), JSON.stringify({ url: '' })] });
    const order = kinds(calls);
    assert.deepEqual(order.slice(order.indexOf('notify'), order.indexOf('notify') + 3), ['notify', 'tailscale', 'info']);   // erst der Hinweis, dann die Aktion
    assert.match(calls.find((c) => c[0] === 'notify')[1], /Anmelde-Link/);
    const infos = calls.filter((c) => c[0] === 'info').map((c) => c[1]);
    assert.match(infos[0], /im Browser geöffnet/);
    assert.match(infos[0], /Aktualisieren/);
    assert.ok(infos[0].endsWith(url));
    assert.match(infos[1], /schon bei Tailscale angemeldet/);
});

test('Tailscale: Fehler der Aktionen erscheinen lesbar und das Fenster bleibt', () => {
    const calls = flowRun({ state: STATE({ tailscale: TS({ state: 'stopped' }) }), dashboard: [{ action: 'tailscaleUp' }, { action: 'tailscaleLogin' }, back],
        tailscaleResults: [{ throw: 'execution error: VibeCode: Tailscale ist nicht angemeldet. (1)' }, 'kein json'] });
    const errors = calls.filter((c) => c[0] === 'error').map((c) => c[1]);
    assert.equal(errors[0], 'Tailscale ist nicht angemeldet. (1)');
    assert.equal(errors[1], 'Die Antwort von Tailscale war nicht lesbar.');
    assert.equal(kinds(calls).filter((k) => k === 'dashboard').length, 3);
});

test('Tailscale: Abmelden fragt zuerst, ändert ohne Ja nichts und Geräte zeigt die Liste lesbar', () => {
    const devices = [{ name: 'laptop', dns: 'laptop.example-tailnet.ts.net', ip: '100.64.0.9', os: 'macOS', online: true, lastSeen: '' },
        { name: 'phone', dns: 'phone.example-tailnet.ts.net', ip: '100.64.0.8', os: 'iOS', online: false, lastSeen: '2026-11-20T10:00:00Z' }];
    const calls = flowRun({ state: STATE({ tailscale: TS({ devices }) }), confirmTailscale: [false, true], tailscaleResults: ['abgemeldet'],
        dashboard: [{ action: 'tailscaleLogout' }, { action: 'tailscaleLogout' }, { action: 'tailscaleDevices' }, back] });
    assert.deepEqual(calls.filter((c) => c[0] === 'confirmTailscale'), [['confirmTailscale', 'logout'], ['confirmTailscale', 'logout']]);
    assert.deepEqual(calls.filter((c) => c[0] === 'tailscale'), [['tailscale', 'logout']]);              // nur nach dem Ja
    const text = calls.filter((c) => c[0] === 'info').map((c) => c[1])[0];
    assert.equal(text, ['Dieser Mac: remote-mac.example-tailnet.ts.net · 100.64.0.5', '', 'Weitere Geräte in example-tailnet.ts.net (2):',
        '● laptop · 100.64.0.9 · macOS', '○ phone · 100.64.0.8 · iOS · zuletzt 2026-11-20'].join('\n'));
    const empty = flowRun({ state: STATE({ tailscale: TS({ state: 'running', devices: [] }) }), dashboard: [{ action: 'tailscaleDevices' }, back] });
    assert.match(empty.find((c) => c[0] === 'info')[1], /Keine weiteren Geräte im Tailnet gefunden/);
});

// ------------------------------------------------------------------ Ollama-Modelle

const MODELS = (extra = {}) => Object.assign({ available: true, provider: 'ollama', providerName: 'Ollama (lokal)', cli: true,
    models: [{ name: 'qwen2.5-coder:7b', size: 4683087332, modified: '2026-11-01T10:00:00Z' },
        { name: 'tiny:latest', size: 640000000, modified: '' }],
    missing: [{ name: 'deepseek-coder:6.7b', why: 'eingestellt' }, { name: 'gemma3:4b', why: 'Vorschlag', note: 'Allgemein, klein' }] }, extra);
const localDevTab = (models) => JSON.parse(widgets(`return JSON.stringify(tabRows(Object.assign({}, STATE,
    { models: ${JSON.stringify(models)} }), "localDev"));`));

test('Local Dev zeigt installierte und noch nicht geladene Ollama-Modelle mit Größe, ohne Punkte', () => {
    const rows = localDevTab(MODELS());
    assert.deepEqual(rows.filter((row) => row.type === 'section').map((row) => row.text),
        ['Anbieter, Modell und CLI', 'Ollama-Modelle', 'Noch nicht geladen']);
    const items = rows.filter((row) => row.type === 'item' && row.buttons[0] && /Entfernen|Laden/.test(row.buttons[0].label));
    assert.deepEqual(items.map((row) => [row.title, row.detail, row.level, row.buttons[0].label]), [
        ['qwen2.5-coder:7b', '4,7 GB · geladen 2026-11-01', 'none', 'Entfernen…'],
        ['tiny:latest', '640 MB', 'none', 'Entfernen…'],
        ['deepseek-coder:6.7b', 'In Local Dev eingestellt, aber nicht geladen', 'none', 'Laden…'],
        ['gemma3:4b', 'Vorschlag · Allgemein, klein', 'none', 'Laden…'],
    ]);
    assert.deepEqual(items[0].buttons[0].action, { action: 'modelRemove', name: 'qwen2.5-coder:7b' });
    assert.deepEqual(items[3].buttons[0].action, { action: 'modelPull', name: 'gemma3:4b' });
    const footer = rows.find((row) => row.type === 'footer');
    assert.deepEqual(footer.buttons.map((b) => b.label), ['Modell laden…', 'Aktualisieren']);
});

test('Local Dev: ohne Ollama, ohne Modelle oder bei einem Lesefehler steht ein Satz da und es gibt nichts Unmögliches zu klicken', () => {
    const labels = (rows) => rows.flatMap((row) => (row.buttons || []).map((b) => b.label));
    const none = localDevTab(MODELS({ models: [], missing: [] }));
    assert.ok(none.some((row) => row.type === 'note' && row.text === 'Noch kein Ollama-Modell geladen.'));
    assert.ok(!none.some((row) => row.text === 'Noch nicht geladen'));
    const gone = localDevTab(MODELS({ cli: false }));
    assert.ok(gone.some((row) => row.type === 'note' && /Ollama wurde nicht gefunden/.test(row.text) && row.level === 'warn'));
    assert.deepEqual(labels(gone).filter((label) => /laden|Laden|Entfernen/.test(label)), []);                  // ohne Ollama weder Laden noch Entfernen
    assert.ok(labels(gone).includes('Aktualisieren'));                                                         // aber neu lesen geht immer
    const broken = localDevTab({ available: true, error: 'Ollama-Modelle: kaputt', models: [], missing: [] });
    assert.ok(broken.some((row) => row.type === 'note' && row.text === '⚠︎ Ollama-Modelle: kaputt' && row.level === 'warn'));
    assert.deepEqual(localDevTab({ available: false }).filter((row) => row.type === 'section').map((row) => row.text), ['Anbieter, Modell und CLI']);
    assert.deepEqual(localDevTab(undefined).filter((row) => row.type === 'section').map((row) => row.text), ['Anbieter, Modell und CLI']);
});

test('Ollama-Modelle: Laden und Entfernen fragen zuerst und tun ohne Ja nichts', () => {
    const calls = flowRun({ state: STATE({ models: MODELS() }),
        dashboard: [{ action: 'modelPull', name: 'gemma3:4b' }, { action: 'modelPull', name: 'gemma3:4b' },
            { action: 'modelRemove', name: 'tiny:latest' }, { action: 'modelRemove', name: 'tiny:latest' }, { action: 'refresh' }, back],
        confirmModelPull: [false, true], confirmModelRemove: [false, true],
        modelResults: ['Terminal geöffnet. Dort wird „gemma3:4b“ geladen.', '„tiny:latest“ wurde entfernt.'] });
    assert.deepEqual(calls.filter((c) => c[0] === 'model'), [['model', 'pull', 'gemma3:4b'], ['model', 'remove', 'tiny:latest']]);   // nur nach dem Ja
    assert.deepEqual(calls.filter((c) => c[0] === 'info').map((c) => c[1]),
        ['Terminal geöffnet. Dort wird „gemma3:4b“ geladen.', '„tiny:latest“ wurde entfernt.']);
    assert.equal(kinds(calls).filter((k) => k === 'dashboard').length, 6);                                      // danach liest die Übersicht neu
});

test('Ollama-Modelle: „Modell laden…“ fragt nach einem Namen; Abbruch tut nichts; Fehler erscheinen lesbar', () => {
    const calls = flowRun({ state: STATE({ models: MODELS() }),
        dashboard: [{ action: 'modelPullAsk' }, { action: 'modelPullAsk' }, { action: 'modelRemove', name: 'tiny:latest' }, back],
        askModelName: [null, 'llama3.1:8b'], confirmModelRemove: [true],
        modelResults: ['Terminal geöffnet.', { throw: 'execution error: VibeCode: Ollama konnte „tiny:latest“ nicht entfernen: connection refused (1)' }] });
    assert.deepEqual(calls.filter((c) => c[0] === 'model'), [['model', 'pull', 'llama3.1:8b'], ['model', 'remove', 'tiny:latest']]);
    assert.equal(calls.find((c) => c[0] === 'error')[1], 'Ollama konnte „tiny:latest“ nicht entfernen: connection refused (1)');
});

test('Modellname-Dialog: ein leerer Name fragt noch einmal, Abbrechen liefert null', () => {
    const out = JSON.parse(widgets(`
        steps.push({ response: FIRST, text: '  ' }, { response: FIRST, text: ' qwen2.5-coder:7b ' });
        const named = nativeUi({}).askModelName();
        steps.push({ response: FIRST + 1, text: 'egal' });
        const cancelled = nativeUi({}).askModelName();
        return JSON.stringify({ named, cancelled, notes });`, `
        const steps = [];
        const notes = [];
        function scriptedPresent(alert, built) {
            notes.push(ObjC.unwrap(alert.informativeText));
            const step = steps.shift();
            if (step.text !== undefined) built.field.stringValue = $(step.text);
            return step.response;
        }`));
    assert.equal(out.named, 'qwen2.5-coder:7b');
    assert.equal(out.cancelled, null);
    assert.match(out.notes[0], /Name wie bei „ollama pull“/);
    assert.equal(out.notes[1], 'Bitte einen Modellnamen eingeben, zum Beispiel qwen2.5-coder:7b.');
});

test('Ollama-Modelle: das Backend ruft genau „models pull|remove NAME“ auf', () => {
    const out = JSON.parse(jxa(`${library}
function run() {
    const commands = [];
    const backend = makeBackend({ doShellScript: (command) => { commands.push(command); return ''; } }, '/usr/bin/python3', '/c/vibecode.py');
    backend.model('pull', 'qwen2.5-coder:7b');
    backend.model('remove', "x'; rm -rf ~; '");
    return JSON.stringify(commands);
}`));
    assert.deepEqual(out, ["'/usr/bin/python3' '/c/vibecode.py' 'models' 'pull' 'qwen2.5-coder:7b'",
        "'/usr/bin/python3' '/c/vibecode.py' 'models' 'remove' 'x'\\''; rm -rf ~; '\\'''"]);
});

// ------------------------------------------------------------------ Kombinationen aus Modell und CLI

const COMBO = (model, framework = 'opencode', provider = 'ollama') => ({ provider, model, framework });
const localDevWith = (extra) => JSON.parse(widgets(`return JSON.stringify(tabRows(Object.assign({}, STATE, ${JSON.stringify(extra)}), "localDev"));`));

test('Local Dev zeigt gespeicherte Kombinationen; ein noch nicht geladenes Ollama-Modell wird vorher gesagt', () => {
    const rows = localDevWith({ models: MODELS(), combos: { items: [COMBO('qwen2.5-coder:7b'), COMBO('gemma3:4b', 'codex'), COMBO('x/y', 'claude', 'mlx')], error: null } });
    assert.ok(rows.some((row) => row.type === 'section' && row.text === 'Kombinationen aus Modell und CLI'));
    const items = rows.filter((row) => row.buttons && row.buttons[0] && row.buttons[0].action.action === 'comboRemove');
    assert.deepEqual(items.map((row) => [row.title, row.detail, row.level]), [
        ['qwen2.5-coder:7b → OpenCode', 'Ollama', 'none'],
        ['gemma3:4b → Codex', 'Ollama · Modell noch nicht geladen (wird beim ersten Start geladen)', 'warn'],    // nicht installiert
        ['x/y → Claude Code', 'MLX', 'none'],                                                                       // nur Ollama-Modelle kennt das Fenster
    ]);
    assert.deepEqual(items[0].buttons[0].action, { action: 'comboRemove', combo: COMBO('qwen2.5-coder:7b') });
    const footers = rows.filter((row) => row.type === 'footer').flatMap((row) => row.buttons.map((b) => b.label));
    assert.ok(footers.includes('Kombination anlegen…'));
    // Ohne Modellliste (kein Ollama-Modul) gibt es keine Warnung, und eine leere Liste sagt, wozu sie dient.
    assert.ok(localDevWith({ combos: { items: [COMBO('gemma3:4b')], error: null } }).every((row) => row.level !== 'warn'));
    const empty = localDevWith({ combos: { items: [], error: null } });
    assert.ok(empty.some((row) => row.type === 'note' && /Noch keine Kombination.*Preset-Editor/.test(row.text)));
    const broken = localDevWith({ combos: { items: [], error: 'Kombinationen: kaputt' } });
    assert.ok(broken.some((row) => row.type === 'note' && row.level === 'warn' && row.text === '⚠︎ Kombinationen: kaputt'));
    assert.ok(!broken.some((row) => row.buttons && row.buttons.some((b) => b.label === 'Kombination anlegen…')));     // bei kaputter Datei nichts überschreiben
    assert.ok(!localDevWith({}).some((row) => row.text === 'Kombinationen aus Modell und CLI'));                       // alter Stand ohne Schlüssel
});

test('Kombination anlegen: wählt aus den passenden Kombinationen ohne die schon gespeicherten; Entfernen ruft direkt auf', () => {
    const options = [
        { provider: 'ollama', providerName: 'Ollama (lokal)', model: 'qwen2.5-coder:7b', local: true, framework: 'opencode', frameworkName: 'OpenCode', active: false, providerReady: true, frameworkReady: true },
        { provider: 'ollama', providerName: 'Ollama (lokal)', model: 'gemma3:4b', local: true, framework: 'codex', frameworkName: 'Codex', active: false, providerReady: true, frameworkReady: true },
        { provider: 'mlx', providerName: 'MLX', model: "org/mo del", local: true, framework: 'opencode', frameworkName: 'OpenCode', active: false, providerReady: true, frameworkReady: true },
    ];
    const calls = flowRun({ state: STATE({ combos: { items: [COMBO('qwen2.5-coder:7b')], error: null } }),
        dashboard: [{ action: 'comboAdd' }, { action: 'comboAdd' }, { action: 'comboRemove', combo: COMBO('qwen2.5-coder:7b') }, back],
        localSettings: { available: true, options, current: null, error: null },
        pickLocalDev: [COMBO('gemma3:4b', 'codex'), null], comboResults: [[], []] });
    const picked = calls.filter((c) => c[0] === 'pickLocalDev');
    assert.equal(picked.length, 2);
    assert.deepEqual(picked[0][1].map((choice) => choice.value), [COMBO('gemma3:4b', 'codex')]);        // gespeicherte und unzulässige (Leerzeichen) fehlen
    assert.equal(picked[0][2], 'combo');
    assert.deepEqual(calls.filter((c) => c[0] === 'combo'), [['combo', 'add', COMBO('gemma3:4b', 'codex')],
        ['combo', 'remove', COMBO('qwen2.5-coder:7b')]]);                                                 // Abbrechen (null) speichert nichts
});

test('Kombination anlegen: sagt, wenn nichts mehr zu wählen ist oder Local Dev nichts kennt, und zeigt Lesefehler', () => {
    const one = { provider: 'ollama', providerName: 'Ollama', model: 'a:1b', local: true, framework: 'codex', frameworkName: 'Codex', active: false, providerReady: true, frameworkReady: true };
    const run = (localSettings, items) => flowRun({ state: STATE({ combos: { items, error: null } }), dashboard: [{ action: 'comboAdd' }, back], localSettings });
    const all = run({ available: true, options: [one], current: null, error: null }, [COMBO('a:1b', 'codex')]);
    assert.equal(all.find((c) => c[0] === 'info')[1], 'Alle passenden Kombinationen sind schon gespeichert.');
    const none = run({ available: true, options: [], current: null, error: null }, []);
    assert.match(none.find((c) => c[0] === 'info')[1], /Local Dev kennt keine passende Kombination/);
    const failed = run({ available: true, options: [], current: null, error: 'Local Dev: Konfiguration ungültig' }, []);
    assert.equal(failed.find((c) => c[0] === 'error')[1], 'Local Dev: Konfiguration ungültig');
    for (const calls of [all, none, failed]) assert.ok(!kinds(calls).includes('pickLocalDev') && !kinds(calls).includes('combo'));
});

test('Preset-Editor: gespeicherte Kombinationen stehen als „Local Dev · …“ in der Auswahl und werden als Typ „Local Dev“ gespeichert', () => {
    const out = JSON.parse(widgets(`
        const combos = [${JSON.stringify(COMBO('qwen2.5-coder:7b'))}, ${JSON.stringify(COMBO('gemma3:4b', 'codex'))}];
        const built = buildPresetEditor({ name: 'alpha' }, { terminals: [], urls: [] }, false, '', combos);
        const titles = [];
        for (let i = 0; i < built.rows[0].popup.numberOfItems; i += 1) titles.push(ObjC.unwrap(built.rows[0].popup.itemTitleAtIndex(i)));
        built.rows[0].popup.selectItemWithTitle($(titles[7]));
        built.rows[0].name.stringValue = $('Modell');
        built.rows[0].prompt.stringValue = $('wird ignoriert');
        built.rows[1].popup.selectItemWithTitle($('Shell'));
        const plain = buildPresetEditor({ name: 'alpha' }, { terminals: [], urls: [] }, false, '');
        return JSON.stringify({ titles, collected: collectPreset(built), plainCount: Number(plain.rows[0].popup.numberOfItems),
            hint: ObjC.unwrap(built.alert.informativeText) });`));
    assert.deepEqual(out.titles, ['–', 'Shell', 'Claude Code', 'Codex', 'Codex 2', 'Antigravity', 'Eigener Befehl', 'Local Dev · qwen2.5-coder:7b → OpenCode · Ollama',
        'Local Dev · gemma3:4b → Codex · Ollama']);
    assert.deepEqual(out.collected.terminals, [{ type: 'Local Dev', name: 'Modell', prompt: 'ollama qwen2.5-coder:7b opencode', cwd: '' },
        { type: 'Shell', name: '', prompt: '', cwd: '' }]);                     // der Prompt kommt aus der Kombination, nicht aus dem Feld
    assert.equal(out.plainCount, 7);                                              // ohne Kombinationen ist die Auswahl wie vorher
    assert.match(out.hint, /„Local Dev · …“ startet den lokalen Modellserver/);
});

test('Preset-Editor: ein Local-Dev-Terminal, dessen Kombination nicht gespeichert ist, bleibt sichtbar und wird nie still verworfen', () => {
    const out = JSON.parse(widgets(`
        const draft = { terminals: [{ name: 'Alt', type: 'Local Dev', prompt: 'ollama gone:1b opencode', cwd: '' },
            { name: 'Neu', type: 'Local Dev', prompt: 'ollama qwen2.5-coder:7b opencode', cwd: 'src' }], urls: [] };
        const built = buildPresetEditor({ name: 'alpha' }, draft, true, '', [${JSON.stringify(COMBO('qwen2.5-coder:7b'))}]);
        const shown = built.rows.slice(0, 2).map((row) => [ObjC.unwrap(row.popup.titleOfSelectedItem), ObjC.unwrap(row.prompt.stringValue)]);
        const withoutAny = buildPresetEditor({ name: 'alpha' }, draft, true, '', []);
        return JSON.stringify({ shown, collected: collectPreset(built), alone: collectPreset(withoutAny).terminals.map((t) => t.prompt) });`));
    assert.deepEqual(out.shown, [['Local Dev · gone:1b → OpenCode · Ollama (nicht gespeichert)', ''],
        ['Local Dev · qwen2.5-coder:7b → OpenCode · Ollama', '']]);
    assert.deepEqual(out.collected.terminals.map((t) => [t.type, t.name, t.prompt, t.cwd]), [
        ['Local Dev', 'Alt', 'ollama gone:1b opencode', ''], ['Local Dev', 'Neu', 'ollama qwen2.5-coder:7b opencode', 'src']]);
    assert.deepEqual(out.alone, ['ollama gone:1b opencode', 'ollama qwen2.5-coder:7b opencode']);              // auch ganz ohne gespeicherte Kombinationen
});

test('Preset-Editor: Local-Dev-Kombinationen kommen aus dem Stand, für SSH-Repositories gibt es keine', () => {
    const combos = { items: [COMBO('qwen2.5-coder:7b')], error: null };
    const local = flowRun({ state: STATE({ combos, presets: PRESETS }), dashboard: [{ action: 'editGeneralPreset' }, back], editPreset: [null] });
    assert.deepEqual(local.find((c) => c[0] === 'presetCombos'), ['presetCombos', [COMBO('qwen2.5-coder:7b')]]);
    const remote = flowRun({ state: STATE({ combos, presets: PRESETS }), dashboard: [{ action: 'editPreset', path: 'vscode-remote://ssh-remote+spark/h/r' }, back],
        editPreset: [null] });
    assert.ok(!kinds(remote).includes('presetCombos'));
    assert.equal(kinds(remote).includes('editPreset'), true);
});

test('Kombinationen: das Backend ruft genau „combos add|remove“ mit festen Optionen auf', () => {
    const out = JSON.parse(jxa(`${library}
function run() {
    const commands = [];
    const backend = makeBackend({ doShellScript: (command) => { commands.push(command); return '[]'; } }, '/usr/bin/python3', '/c/vibecode.py');
    backend.combo('add', { provider: 'ollama', model: '-oX', framework: 'opencode' });
    backend.combo('remove', { provider: 'ollama', model: "m'; rm -rf ~", framework: 'codex' });
    return JSON.stringify(commands);
}`));
    assert.deepEqual(out, ["'/usr/bin/python3' '/c/vibecode.py' 'combos' 'add' '--provider=ollama' '--model=-oX' '--framework=opencode'",
        "'/usr/bin/python3' '/c/vibecode.py' 'combos' 'remove' '--provider=ollama' '--model=m'\\''; rm -rf ~' '--framework=codex'"]);
});

// ------------------------------------------------------------------ Agenten

const SESSION = (state, extra = {}) => Object.assign({ project: 'alpha', agent: 'claude', state, age: 5, branch: 'main' }, extra);
const AG = (sessions, extra = {}) => Object.assign({ available: true, error: null, sessions }, extra);

test('Übersicht: der Agenten-Bereich steht gleich unter den Workspaces und fasst zusammen, was gerade passiert', () => {
    const rows = (agents) => JSON.parse(widgets(`return JSON.stringify(dashboardRows(Object.assign({}, STATE, { agents: ${JSON.stringify(agents)} })));`));
    const sections = (agents) => rows(agents).filter((row) => row.type === 'section').map((row) => row.text);
    assert.deepEqual(sections(AG([])).slice(0, 2), ['Workspaces', 'Agenten']);
    const item = (agents) => rows(agents).find((row) => row.type === 'item' && row.title === 'Claude Code und Codex');
    const many = item(AG([SESSION('working'), SESSION('working', { agent: 'codex' }), SESSION('ready'), SESSION('tool_wait'), SESSION('stalled'), SESSION('unknown')]));
    assert.equal(many.detail, '2 arbeiten · 1 mit laufendem Befehl oder Freigabe · 1 wartet auf dich · 1 unklar · Schätzung');   // „unbekannt“ zählt nicht
    assert.equal(many.level, 'ok');
    assert.deepEqual(many.buttons.map((b) => [b.label, b.action.action]), [['Agenten…', 'agents']]);
    assert.equal(item(AG([SESSION('working')])).detail, '1 arbeitet · Schätzung');
    assert.equal(item(AG([SESSION('ready'), SESSION('ready')])).detail, '2 warten auf dich · Schätzung');
    assert.equal(item(AG([SESSION('tool_wait')])).level, 'warn');
    assert.equal(item(AG([SESSION('ready')])).level, 'off');
    assert.equal(item(AG([])).detail, 'Keine Sitzung in den letzten 3 Stunden · Schätzung');
    assert.ok(!sections({ available: false, sessions: [] }).includes('Agenten'));                      // ohne Scanner kein Bereich
    const broken = rows(AG([], { error: 'Agenten: Exit 2' }));
    assert.ok(broken.some((row) => row.type === 'section' && row.text === 'Agenten'));
    assert.deepEqual(broken.filter((row) => row.type === 'note' && /Exit 2/.test(row.text)).map((row) => row.level), ['warn']);
    assert.ok(!broken.some((row) => row.title === 'Claude Code und Codex'));
});

test('Agenten-Dialog: Zeilen mit Zustand, Projekt, Agent, Branch und Alter; mehr als zwölf werden gekürzt', () => {
    const text = (model) => JSON.parse(widgets(`return JSON.stringify(agentsText(${JSON.stringify(model)}));`));
    const local = [SESSION('working', { age: 4 }), SESSION('ready', { project: 'beta', agent: 'codex', branch: '', age: 600 }),
        SESSION('tool_wait', { project: 'gamma', age: 3600 }), SESSION('stalled', { project: 'delta', age: 10800 })];
    assert.equal(text({ local, mac: '' }), ['Dieser Mac (4)', '● arbeitet · alpha · Claude · main · vor 4 s', '○ fertig, wartet auf dich · beta · Codex · vor 10 min',
        '◐ Befehl läuft oder wartet auf Freigabe · gamma · Claude · main · vor 60 min', '◌ unklar, seit längerem still · delta · Claude · main · vor 3 h', '',
        'Eine Schätzung aus den Verlaufsdateien von Claude Code und Codex, kein Live-Monitor. „Aktualisieren“ liest neu.'].join('\n'));
    const fifteen = Array.from({ length: 15 }, (_, n) => SESSION('ready', { project: `p${n}`, age: n }));
    const lines = text({ local: fifteen, mac: '' }).split('\n');
    assert.equal(lines[0], 'Dieser Mac (15)');
    assert.equal(lines.filter((line) => line.startsWith('○')).length, 12);
    assert.ok(lines.includes('… und 3 weitere'));
    assert.match(text({ local: [], mac: '' }), /Keine Sitzung in den letzten 3 Stunden\./);
    const withRemote = text({ local: [], mac: 'studio', remote: { sessions: [SESSION('working', { project: 'srv [SSH: studio]' })], error: null } });
    assert.match(withRemote, /\nstudio \(1\)\n● arbeitet · srv \[SSH: studio\] · Claude/);
    assert.match(text({ local: [], mac: 'studio', remote: { sessions: [], error: 'Auf dem anderen Mac fehlt python3.' } }), /\nstudio\n⚠︎ Auf dem anderen Mac fehlt python3\./);
    assert.match(text({ local: [], localError: 'Agenten: kaputt', mac: '' }), /^Dieser Mac\n⚠︎ Agenten: kaputt/);
});

test('Agenten: die Liste kommt aus der Übersicht, den anderen Mac fragt nur der Klick, Aktualisieren liest neu', () => {
    const state = Object.assign(STATE({ agents: AG([SESSION('working')]) }), { ssh: Object.assign({}, SSH, { mac: { user: 'user', host: 'studio', port: 22 } }) });
    const calls = flowRun({ state, dashboard: [{ action: 'agents' }, back], showAgents: ['remote', 'refresh', 'close'],
        agentsResults: [AG([SESSION('ready', { project: 'srv [SSH: studio]' })], { mapped: true }), AG([SESSION('ready')]),
            AG([SESSION('working', { project: 'srv [SSH: studio]' })], { mapped: true })] });
    const dialogs = calls.filter((c) => c[0] === 'showAgents');
    assert.equal(dialogs.length, 3);
    assert.equal(dialogs[0][2], 'Auf studio prüfen');
    assert.ok(!dialogs[0][1].includes('studio ('));                                                  // beim Öffnen: nur dieser Mac, kein SSH
    assert.deepEqual(calls.filter((c) => c[0] === 'agents'), [['agents', 'remote'], ['agents', 'local'], ['agents', 'remote']]);
    assert.match(dialogs[1][1], /\nstudio \(1\)\n○ fertig/);                                       // nach dem Klick steht der andere Mac da
    assert.match(dialogs[2][1], /○ fertig, wartet auf dich · alpha/);                                 // Aktualisieren: neue lokale Liste …
    assert.equal(calls.filter((c) => c[0] === 'notify').length, 2);                                   // … und, weil schon geprüft, auch der andere Mac
    assert.ok(calls.indexOf(calls.find((c) => c[0] === 'showAgents')) < calls.indexOf(calls.find((c) => c[0] === 'agents')));
});

test('Agenten: ohne verbundenen Mac gibt es keinen Knopf für den anderen Mac und nie einen SSH-Aufruf', () => {
    const calls = flowRun({ state: STATE({ agents: AG([]) }), dashboard: [{ action: 'agents' }, back], showAgents: ['remote', 'close'] });
    assert.equal(calls.find((c) => c[0] === 'showAgents')[2], '');
    assert.ok(!kinds(calls).includes('agents') && !kinds(calls).includes('notify'));                  // ein verirrtes „remote“ schließt nur
    assert.equal(kinds(calls).filter((k) => k === 'showAgents').length, 1);
});

test('Agenten-Dialog: die echten Knöpfe und ihre Antworten', () => {
    const out = JSON.parse(widgets(`
        const results = {};
        const run = (name, model, response) => {
            present = (alert) => { results[name + 'Buttons'] = titles(alert); results[name + 'Text'] = ObjC.unwrap(alert.informativeText); return response; };
            results[name] = nativeUi({}).showAgents(model);
        };
        run('first', { text: 'Dieser Mac (0)', remoteLabel: 'Auf studio prüfen' }, FIRST);
        run('second', { text: 'x', remoteLabel: 'Auf studio prüfen' }, FIRST + 1);
        run('third', { text: 'x', remoteLabel: 'Auf studio prüfen' }, FIRST + 2);
        run('noRemote', { text: 'x', remoteLabel: '' }, FIRST + 1);
        return JSON.stringify(results);`));
    assert.deepEqual(out.firstButtons, ['Aktualisieren', 'Auf studio prüfen', 'Schließen']);
    assert.deepEqual([out.first, out.second, out.third], ['refresh', 'remote', 'close']);
    assert.deepEqual(out.noRemoteButtons, ['Aktualisieren', 'Schließen']);
    assert.equal(out.noRemote, 'close');                                                             // der zweite Knopf ist dann „Schließen“
    assert.equal(out.firstText, 'Dieser Mac (0)');
});

// ------------------------------------------------------------------ Einladung per Taildrop

const INBOX = (extra = {}) => result(0, JSON.stringify(Object.assign({ invites: [], answers: [], foreign: 0, invalid: 0, rejected: 0, unknown: 0, variant: 'cli' }, extra)));
const INVITE = (extra = {}) => Object.assign({ nonce: 'a'.repeat(32), device: 'studio', user: 'studio_user', host: 'studio.example-tailnet.ts.net' }, extra);
const ANSWER = (extra = {}) => Object.assign({ nonce: 'b'.repeat(32), device: 'book' }, extra);

test('Freigabe-Maske: „Gerät aus Tailscale freigeben…“ nur, wenn dieser Mac bereit ist und ein eigenes Gerät online ist', () => {
    const run = (share, tailscale) => {
        const calls = flowRun({ state: Object.assign(ssh(), { tailscale }), dashboard: [sshShare, back], sshResults: [shareResult(share)], share: ['done'] });
        return calls.find((c) => c[0] === 'share')[3];
    };
    const devices = [DEVICE('book')];
    assert.equal(run({}, TS({ devices })), true);
    assert.equal(run({ remoteLogin: false }, TS({ devices })), false);                       // noch nicht bereit
    assert.equal(run({}, TS({ devices: [] })), false);                                         // kein anderes Gerät
    assert.equal(run({}, TS({ devices: [DEVICE('book', { online: false })] })), false);        // niemand online
    assert.equal(run({}, TS({ devices: [DEVICE('phone', { os: 'iOS' })] })), false);           // ein Telefon hat kein SSH
    assert.equal(run({}, TS({ state: 'stopped', devices })), false);
    assert.equal(run({}, undefined), false);                                                   // ältere Antwort ohne Tailscale
    const built = JSON.parse(widgets(`
        const on = buildShare(${JSON.stringify(SHARE({ awake: true }))}, '', true);
        const off = buildShare(${JSON.stringify(SHARE({ awake: true }))}, '', false);
        return JSON.stringify({ on: titles(on.alert), off: titles(off.alert), onActions: on.actions });`));
    assert.deepEqual(built.on, ['Gerät aus Tailscale freigeben…', 'Schlüssel eintragen…', 'Zeile kopieren', 'Fertig']);
    assert.ok(!built.off.includes('Gerät aus Tailscale freigeben…'));
});

test('Einladen: das Gerät wählen, Einladung senden, sagen wie es weitergeht; Fehler und Abbruch bleiben harmlos', () => {
    const state = Object.assign(ssh(), { tailscale: TS({ devices: [DEVICE('book'), DEVICE('phone', { os: 'iOS', ip: '100.64.0.8' })] }) });
    const okay = flowRun({ state, dashboard: [sshShare, back], sshResults: [shareResult({ awake: true }), result(0, 'Einladung an book geschickt. Dort in VibeCode …')],
        share: ['invite'], pickTailscaleDevice: [DEVICE('book')] });
    assert.deepEqual(okay.find((c) => c[0] === 'pickTailscaleDevice'), ['pickTailscaleDevice', ['book']]);       // das Telefon wird nicht angeboten
    assert.deepEqual(okay.filter((c) => c[0] === 'ssh').map((c) => c.slice(1)), [['share', null], ['invite', '100.64.0.9']]);
    assert.match(okay.find((c) => c[0] === 'notify')[1], /Lade book ein/);
    assert.match(okay.find((c) => c[0] === 'info')[1], /^Einladung an book geschickt\..*\n\nDie Einladung gilt eine Stunde\.$/s);
    const failed = flowRun({ state, dashboard: [sshShare, back], sshResults: [shareResult({ awake: true }), result(1, '', 'Remote: book ist offline: aufwecken und Tailscale verbinden, dann noch einmal.')],
        share: ['invite'], pickTailscaleDevice: [DEVICE('book')] });
    assert.match(failed.find((c) => c[0] === 'error')[1], /book ist offline/);
    const cancelled = flowRun({ state, dashboard: [sshShare, back], sshResults: [shareResult({ awake: true })], share: ['invite'], pickTailscaleDevice: [null] });
    assert.ok(!kinds(cancelled).includes('notify') && cancelled.filter((c) => c[0] === 'ssh').length === 1);
});

test('Einladungen abholen: annehmen, auf später lassen und den Schlüssel einer Antwort erst nach dem Fingerprint eintragen', () => {
    const state = STATE({ tailscale: TS({ devices: [DEVICE('studio')] }) });
    const key = JSON.stringify({ name: 'book', fingerprint: 'SHA256:xyz', known: false, comment: 'user@book' });
    const calls = flowRun({ state, dashboard: [{ action: 'tailscaleInbox' }, back],
        sshResults: [INBOX({ invites: [INVITE(), INVITE({ nonce: 'c'.repeat(32), device: 'zweites' })], answers: [ANSWER()] }),
            result(0, '✔ Einladung von studio angenommen.'), result(0, key), result(0, 'Freigegeben: book (SHA256:xyz). Dort jetzt „Verbinden“.')],
        confirmInvite: [true, false], confirmAllow: [true] });
    assert.deepEqual(calls.filter((c) => c[0] === 'confirmInvite'), [['confirmInvite', 'studio', 'studio_user'], ['confirmInvite', 'zweites', 'studio_user']]);
    assert.deepEqual(calls.filter((c) => c[0] === 'ssh').map((c) => c.slice(1)),
        [['inbox', null], ['accept', 'a'.repeat(32)], ['grant-check', 'b'.repeat(32)], ['grant', 'b'.repeat(32)]]);   // „Später“ ruft nichts auf
    assert.deepEqual(calls.find((c) => c[0] === 'confirmAllow'), ['confirmAllow', 'book', 'SHA256:xyz']);
    const infos = calls.filter((c) => c[0] === 'info').map((c) => c[1]);
    assert.match(infos[0], /Einladung von studio angenommen/);
    assert.match(infos[1], /Freigegeben: book.*Bereich Remote auf Verbinden klicken/s);
    assert.match(calls.find((c) => c[0] === 'notify')[1], /Hole Einladungen/);
});

test('Einladungen abholen: ein abgelehnter Fingerprint schreibt nichts, ein schon bekannter Schlüssel verbraucht die Einladung nur', () => {
    const state = STATE({ tailscale: TS() });
    const declined = flowRun({ state, dashboard: [{ action: 'tailscaleInbox' }, back],
        sshResults: [INBOX({ answers: [ANSWER()] }), result(0, JSON.stringify({ name: 'book', fingerprint: 'SHA256:xyz', known: false }))], confirmAllow: [false] });
    assert.deepEqual(declined.filter((c) => c[0] === 'ssh').map((c) => c[1]), ['inbox', 'grant-check']);          // kein „grant“
    const known = flowRun({ state, dashboard: [{ action: 'tailscaleInbox' }, back],
        sshResults: [INBOX({ answers: [ANSWER()] }), result(0, JSON.stringify({ name: 'book', fingerprint: 'SHA256:xyz', known: true })), result(0, 'Freigegeben')] });
    assert.deepEqual(known.filter((c) => c[0] === 'ssh').map((c) => c[1]), ['inbox', 'grant-check', 'grant']);
    assert.ok(!kinds(known).includes('confirmAllow'));
    assert.match(known.find((c) => c[0] === 'info')[1], /„book“ war schon freigegeben/);
});

test('Remote: eine eingehende Freigabe ist auch ohne eigenes SSH-Ziel sichtbar und nur bestätigt widerrufbar', () => {
    const grant = { name: 'user@book', fingerprint: 'SHA256:' + 'A'.repeat(43) };
    const state = ssh({ hosts: [], mac: null, grants: [grant] });
    const row = JSON.parse(widgets(`return JSON.stringify(tabRows(${JSON.stringify(state)}, "remote")
        .find((row) => row.title === "user@book"));`));
    assert.equal(row.detail, 'SSH-Schlüssel freigegeben');
    const [{ label, action }] = row.buttons;
    assert.equal(label, 'Widerrufen…');
    const script = { state, dashboard: [action, back] };
    const cancelled = flowRun({ ...script, confirmRevoke: [false] });
    assert.ok(!kinds(cancelled).includes('ssh'));
    const confirmed = flowRun({ ...script, confirmRevoke: [true], sshResults: [result(0, 'SSH-Freigabe widerrufen.')] });
    assert.deepEqual(confirmed.filter((c) => c[0] === 'confirmRevoke' || c[0] === 'ssh'), [
        ['confirmRevoke', grant.name, grant.fingerprint], ['ssh', 'revoke', grant.fingerprint],
    ]);
    assert.equal(confirmed.filter((c) => c[0] === 'state').length, 2);
});

test('Einladungen abholen: Fehler, nichts da, fehlender Schlüssel und Hinweise auf zur Seite gelegte Dateien', () => {
    const state = STATE({ tailscale: TS() });
    const failed = flowRun({ state, dashboard: [{ action: 'tailscaleInbox' }, back], sshResults: [result(1, '', 'Remote: Taildrop ist auf diesem Mac nicht verfügbar: x')] });
    assert.match(failed.find((c) => c[0] === 'error')[1], /Taildrop ist auf diesem Mac nicht verfügbar/);
    const unreadable = flowRun({ state, dashboard: [{ action: 'tailscaleInbox' }, back], sshResults: [result(0, 'kein json')] });
    assert.equal(unreadable.find((c) => c[0] === 'error')[1], 'Die Antwort des Remote-Moduls war nicht lesbar.');
    const nothing = flowRun({ state, dashboard: [{ action: 'tailscaleInbox' }, back], sshResults: [INBOX({ foreign: 2, invalid: 1, rejected: 2, unknown: 1 })] });
    const text = nothing.find((c) => c[0] === 'info')[1];
    assert.match(text, /^Keine Einladungen oder Antworten gefunden\./);
    assert.match(text, /2 weitere Taildrop-Dateien lagen im Posteingang: unverändert nach ~\/Downloads verschoben\./);
    assert.match(text, /1 Datei mit unserem Namen waren ungültig oder abgelaufen und liegen in ~\/Downloads\./);
    assert.match(text, /2 Einladungen von einem Gerät, das nicht zu deinem Tailscale-Konto gehört, wurden verworfen\./);          // nicht „liegen in Downloads“
    assert.doesNotMatch(text, /Tailscale-App/);                                                                                       // der Hinweis nur bei der App
    const app = flowRun({ state, dashboard: [{ action: 'tailscaleInbox' }, back], sshResults: [INBOX({ variant: 'app' })] });
    assert.match(app.find((c) => c[0] === 'info')[1], /Bei der Tailscale-App muss Taildrop in den Systemeinstellungen eingeschaltet sein.*„Gerät per SSH verbinden…“ funktioniert immer\./s);
    const garbled = flowRun({ state, dashboard: [{ action: 'tailscaleInbox' }, back], sshResults: [INBOX({ answers: [ANSWER()] }), result(0, 'kein json')] });
    assert.equal(garbled.find((c) => c[0] === 'error')[1], 'Die Antwort des Remote-Moduls war nicht lesbar.');                          // kein roher SyntaxError
    assert.match(text, /1 Antwort ohne Einladung wurde verworfen\./);
    const noKey = flowRun({ state, dashboard: [{ action: 'tailscaleInbox' }, back], sshResults: [INBOX({ invites: [INVITE()] }), result(4, 'Dieser Mac hat noch keinen SSH-Schlüssel.')],
        confirmInvite: [true], confirmTailscale: [true] });
    assert.deepEqual(noKey.filter((c) => c[0] === 'confirmTailscale'), [['confirmTailscale', 'keygen']]);
    assert.deepEqual(noKey.filter((c) => c[0] === 'sshOpen'), [['sshOpen', 'keygen', null]]);                 // Schlüssel im Terminal erzeugen
    const accepted = flowRun({ state, dashboard: [{ action: 'tailscaleInbox' }, back], sshResults: [INBOX({ invites: [INVITE()] }), result(1, '', 'Remote: stimmt NICHT')],
        confirmInvite: [true] });
    assert.match(accepted.find((c) => c[0] === 'error')[1], /stimmt NICHT/);
});

test('Einladungs-Dialoge: Auswahl, Annehmen/Später und der Hinweis zum Schlüssel sind die echten Widgets', () => {
    const out = JSON.parse(widgets(`
        const results = {};
        const run = (name, call, response) => {
            present = (alert, built) => { results[name + 'Buttons'] = titles(alert); results[name + 'Title'] = ObjC.unwrap(alert.messageText);
                results[name + 'Text'] = ObjC.unwrap(alert.informativeText); if (built && built.popup) built.popup.selectItemAtIndex(1); return response; };
            results[name] = call(nativeUi({}));
        };
        const devices = ${JSON.stringify([DEVICE('book'), DEVICE('server', { os: 'linux', ip: '100.64.0.6' })])};
        run('pick', (ui) => ui.pickTailscaleDevice(devices), FIRST);
        run('pickCancel', (ui) => ui.pickTailscaleDevice(devices), FIRST + 1);
        run('yes', (ui) => ui.confirmInvite(${JSON.stringify(INVITE())}), FIRST);
        run('later', (ui) => ui.confirmInvite(${JSON.stringify(INVITE())}), FIRST + 1);
        run('keygen', (ui) => ui.confirmTailscale('keygen'), FIRST);
        return JSON.stringify(results);`));
    assert.equal(out.pick.name, 'server');                                                         // die Auswahl im Popup zählt
    assert.equal(out.pickCancel, null);
    assert.deepEqual(out.pickButtons, ['Einladen', 'Abbrechen']);
    assert.match(out.pickText, /Taildrop.*Kein Passwort, keine Zeilen zum Kopieren/s);
    assert.deepEqual([out.yes, out.later], [true, false]);
    assert.deepEqual(out.yesButtons, ['Annehmen', 'Später']);
    assert.equal(out.yesTitle, 'Einladung von studio annehmen?');
    assert.match(out.yesText, /als studio_user per SSH.*Fingerprint bestätigst/s);
    assert.match(out.keygenText, /noch keinen SSH-Schlüssel.*Passphrase wählst du selbst/s);
});

const DEVICE = (name, extra = {}) => Object.assign({ name, dns: `${name}.example-tailnet.ts.net`, ip: '100.64.0.9', os: 'macOS', online: true, lastSeen: '' }, extra);

test('Tailscale: „Gerät per SSH verbinden…“ gibt es nur, solange Tailscale läuft und es andere Geräte gibt', () => {
    const footer = (tailscale) => JSON.parse(widgets(`return JSON.stringify(tabRows(Object.assign({}, STATE,
        { tailscale: ${JSON.stringify(tailscale)} }), "remote"));`))
        .filter((row) => row.type === 'footer').flatMap((row) => row.buttons.map((button) => button.label));
    assert.deepEqual(footer(TS({ devices: [DEVICE('studio')] })), ['Aktualisieren', 'Gerät per SSH verbinden…', 'Einladungen abholen']);
    assert.deepEqual(footer(TS({ devices: [] })), ['Aktualisieren', 'Einladungen abholen']);                // allein im Tailnet: nur Antworten könnten warten
    assert.deepEqual(footer(TS({ state: 'stopped', devices: [DEVICE('studio')] })), ['Aktualisieren']);     // getrennt: nichts anzubieten
    assert.deepEqual(footer(TS({ state: 'needs-login', devices: [DEVICE('studio')] })), ['Aktualisieren']);
});

test('Tailscale: ein Gerät per SSH verbinden fragt nur nach online erreichbaren Rechnern und meldet das Ergebnis', () => {
    const devices = [DEVICE('studio'), DEVICE('phone', { os: 'iOS', ip: '100.64.0.8' }), DEVICE('alt', { online: false, ip: '100.64.0.7' }),
        DEVICE('server', { os: 'linux', ip: '100.64.0.6' })];
    const state = STATE({ tailscale: TS({ devices, localUser: 'user' }) });
    const calls = flowRun({ state, dashboard: [{ action: 'tailscaleConnectDevice' }, back],
        askTailscaleDevice: [{ name: 'studio', ip: '100.64.0.9', os: 'macOS', user: 'user' }],
        sshResults: [{ code: 0, out: '✔ Verbunden mit user@studio.example-tailnet.ts.net. Befehle: workspace remote ssh run -- <befehl>', err: '' }] });
    assert.deepEqual(calls.find((c) => c[0] === 'askTailscaleDevice'), ['askTailscaleDevice', ['studio', 'server'], 'user']);   // Telefon und Offline-Gerät fehlen
    assert.deepEqual(calls.find((c) => c[0] === 'ssh'), ['ssh', 'tailnet', 'user@100.64.0.9']);
    assert.match(calls.find((c) => c[0] === 'notify')[1], /Verbinde mit studio/);
    const info = calls.find((c) => c[0] === 'info')[1];
    assert.match(info, /^Verbunden mit user@studio\.example-tailnet\.ts\.net ✓/);
    assert.match(info, /Remote-Ordner hinzufügen…/);
    assert.ok(!kinds(calls).includes('sshOpen'));
});

test('Tailscale: fehlt der Schlüssel, öffnet sich nach der Bestätigung das Terminal mit ssh-copy-id, sonst nichts', () => {
    const state = STATE({ tailscale: TS({ devices: [DEVICE('studio')], localUser: 'user' }) });
    const pick = { name: 'studio', ip: '100.64.0.9', os: 'macOS', user: 'user' };
    const calls = flowRun({ state, dashboard: [{ action: 'tailscaleConnectDevice' }, { action: 'tailscaleConnectDevice' }, back],
        askTailscaleDevice: [pick, pick], confirmTailscale: [true, false],
        sshResults: [{ code: 2, out: 'Noch kein Schlüssel', err: '' }, { code: 2, out: 'Noch kein Schlüssel', err: '' }] });
    assert.deepEqual(calls.filter((c) => c[0] === 'confirmTailscale'), [['confirmTailscale', 'pair'], ['confirmTailscale', 'pair']]);
    assert.deepEqual(calls.filter((c) => c[0] === 'sshOpen'), [['sshOpen', 'pair', null]]);              // nur beim Ja
    assert.ok(!kinds(calls).includes('error'));
});

test('Tailscale: Fehler, Abbruch und „niemand online“ beim Gerät-Verbinden bleiben harmlos', () => {
    const state = STATE({ tailscale: TS({ devices: [DEVICE('studio')], localUser: 'user' }) });
    const failed = flowRun({ state, dashboard: [{ action: 'tailscaleConnectDevice' }, back],
        askTailscaleDevice: [{ name: 'studio', ip: '100.64.0.9', os: 'macOS', user: 'user' }],
        sshResults: [{ code: 1, out: '', err: 'Remote: Dieses Gerät gehört nicht zu deinem Tailscale-Konto.' }] });
    assert.equal(failed.find((c) => c[0] === 'error')[1], 'Remote: Dieses Gerät gehört nicht zu deinem Tailscale-Konto.');
    const cancelled = flowRun({ state, dashboard: [{ action: 'tailscaleConnectDevice' }, back], askTailscaleDevice: [null] });
    assert.ok(!kinds(cancelled).includes('ssh') && !kinds(cancelled).includes('notify'));
    const offline = flowRun({ state: STATE({ tailscale: TS({ devices: [DEVICE('studio', { online: false })] }) }),
        dashboard: [{ action: 'tailscaleConnectDevice' }, back] });
    assert.match(offline.find((c) => c[0] === 'info')[1], /kein anderes Gerät deines Tailnets online/);
    assert.ok(!kinds(offline).includes('askTailscaleDevice'));
});

test('Gerät-Dialog: Auswahl und Benutzername, ein ungültiger Name wird nicht angenommen und die Eingabe bleibt', () => {
    const out = JSON.parse(widgets(`
        const devices = ${JSON.stringify([DEVICE('studio'), DEVICE('server', { os: 'linux', ip: '100.64.0.6' })])};
        steps.push({ response: FIRST, user: '-oProxyCommand=x' },                      // ungültig
            { response: FIRST, user: ' user ', pick: 1 });                            // gültig, zweites Gerät
        const done = nativeUi({}).askTailscaleDevice(devices, 'standard');
        steps.push({ response: FIRST + 1 });
        const cancelled = nativeUi({}).askTailscaleDevice(devices, 'standard');
        return JSON.stringify({ done, cancelled, notes, shown, items });`, `
        const steps = [], notes = [], shown = [], items = [];
        function scriptedPresent(alert, built) {
            notes.push(ObjC.unwrap(alert.informativeText));
            shown.push(ObjC.unwrap(built.user.stringValue));
            if (!items.length) for (let i = 0; i < Number(built.popup.numberOfItems); i += 1) items.push(ObjC.unwrap(built.popup.itemTitleAtIndex(i)));
            const step = steps.shift();
            if (step.user !== undefined) built.user.stringValue = $(step.user);
            if (step.pick !== undefined) built.popup.selectItemAtIndex(step.pick);
            return step.response;
        }`));
    assert.deepEqual(out.done, { user: 'user', name: 'server', dns: 'server.example-tailnet.ts.net', ip: '100.64.0.6', os: 'linux', online: true, lastSeen: '' });
    assert.equal(out.cancelled, null);
    assert.deepEqual(out.items, ['studio · 100.64.0.9 · macOS', 'server · 100.64.0.6 · linux']);
    assert.equal(out.shown[0], 'standard');                                                // der lokale Benutzername ist vorbelegt
    assert.equal(out.shown[1], '-oProxyCommand=x');                                        // die falsche Eingabe blieb stehen
    assert.match(out.notes[1], /Benutzernamen auf dem anderen Mac/);
});

test('Tailscale: der echte Bestätigungsdialog nennt Passwort, Terminal und die Folgen des Abmeldens', () => {
    const out = JSON.parse(widgets(`
        const texts = {};
        ['setup', 'logout', 'pair'].forEach((kind) => {
            let built;
            const ui = nativeUi({});
            ui.confirmTailscale(kind);
        });
        return JSON.stringify(texts);`.replace('ui.confirmTailscale(kind);', `
            const original = present;
            present = (alert) => { texts[kind] = [ObjC.unwrap(alert.messageText), ObjC.unwrap(alert.informativeText),
                alert.buttons.count > 1 ? ObjC.unwrap(alert.buttons.objectAtIndex(0).title) : ''].join('|'); return $.NSAlertFirstButtonReturn; };
            ui.confirmTailscale(kind);
            present = original;`)));
    assert.match(out.setup, /^Tailscale einrichten\?\|.*Admin-Passwort.*VibeCode sieht es nie.*\|Terminal öffnen$/);
    assert.match(out.logout, /^Von Tailscale abmelden\?\|.*Remote-Sitzungen.*brechen ab\.\|Abmelden$/);
    assert.match(out.pair, /^Schlüssel auf dem anderen Mac einrichten\?\|.*Passwort des Benutzers.*VibeCode nie sieht.*Gerät per SSH verbinden….*\|Terminal öffnen$/);
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

const GENERAL = { terminals: [TERM('Shell'), TERM('Agent', 'Claude Code', 'Hallo')], urls: ['http://localhost:3000'] };

test('Allgemeiner Standard: Festlegen startet mit den eingebauten Terminals und speichert ohne Pfad', () => {
    const calls = flowRun({
        state: withPresets(), dashboard: [{ action: 'editGeneralPreset' }, back],
        editPreset: [{ terminals: [TERM('Neu')], urls: ['http://localhost:1'] }], presetResults: [ok('Allgemeiner Standard gespeichert')],
    });
    const edit = calls.find((c) => c[0] === 'editPreset');
    assert.equal(edit[1], 'Allgemeiner Standard');
    assert.deepEqual(edit[2].terminals.map((t) => t.name), ['Frontend', 'Claude']);       // eingebaut, solange nichts festgelegt ist
    assert.equal(edit[3], false);                                                         // noch kein eigener Standard: kein Zurücksetzen-Knopf
    assert.deepEqual(calls.find((c) => c[0] === 'preset'),
        ['preset', 'save-general', { data: { terminals: [TERM('Neu')], urls: ['http://localhost:1'] } }]);
});

test('Allgemeiner Standard: Bearbeiten beginnt mit dem gespeicherten Standard, Zurücksetzen fragt nach und sagt, was dann gilt', () => {
    const calls = flowRun({
        state: withPresets({ general: GENERAL }), dashboard: [{ action: 'editGeneralPreset' }, back],
        editPreset: [{ reset: true }, { reset: true }], confirmResetPreset: [false, true], presetResults: [ok('zurückgesetzt')],
    });
    const edits = calls.filter((c) => c[0] === 'editPreset');
    assert.deepEqual(edits[0][2], { terminals: GENERAL.terminals, urls: GENERAL.urls });
    assert.equal(edits[0][3], true);                                                      // eigener Standard: Zurücksetzen möglich
    assert.equal(edits.length, 2);                                                        // bei "Nein" geht der Editor weiter
    assert.deepEqual(calls.filter((c) => c[0] === 'confirmResetPreset').map((c) => [c[1], c[2]]),
        Array(2).fill(['Allgemeiner Standard', 'Danach gelten wieder die eingebauten Standard-Terminals ohne Browser-Tabs.']));
    assert.deepEqual(calls.filter((c) => c[0] === 'preset'), [['preset', 'reset-general', null]]);
});

test('Allgemeiner Standard: die Übersicht setzt ihn zurück, nur nach Rückfrage', () => {
    const row = { action: 'resetGeneralPreset' };
    const calls = flowRun({
        state: withPresets({ general: GENERAL }), dashboard: [row, row, back], confirmResetPreset: [true, false], presetResults: [ok('x')],
    });
    assert.deepEqual(calls.filter((c) => c[0] === 'preset'), [['preset', 'reset-general', null]]);
    assert.equal(calls.filter((c) => c[0] === 'confirmResetPreset').length, 2);
});

test('Allgemeiner Standard: ein neues Repository-Preset beginnt mit ihm, auch remote, und die Rückfrage nennt ihn', () => {
    for (const repo of [PRESETS.repos[1], PRESETS.repos[2]]) {
        const calls = flowRun({
            state: withPresets({ general: GENERAL }), dashboard: [{ action: 'newPreset' }, { action: 'resetPreset', path: '/alt/lost', label: 'lost' }, back],
            pickRepo: [repo], editPreset: [null], confirmResetPreset: [false],
        });
        assert.deepEqual(calls.find((c) => c[0] === 'editPreset')[2], { terminals: GENERAL.terminals, urls: GENERAL.urls });
        assert.equal(calls.find((c) => c[0] === 'confirmResetPreset')[2],
            'Danach gilt wieder der allgemeine Standard. Das Repository selbst bleibt unberührt.');
    }
    // Ohne allgemeinen Standard bleibt es bei den eingebauten Terminals.
    const plain = flowRun({ state: withPresets(), dashboard: [{ action: 'resetPreset', path: '/alt/lost', label: 'lost' }, back], confirmResetPreset: [false] });
    assert.equal(plain.find((c) => c[0] === 'confirmResetPreset')[2],
        'Danach starten wieder die Standard-Terminals. Das Repository selbst bleibt unberührt.');
});

test('Allgemeiner Standard: ein abgelehnter Standard zeigt den Grund und behält alle Eingaben', () => {
    const wrong = { terminals: [TERM('A', 'Shell', '', '../x')], urls: [] };
    const fixed = { terminals: [TERM('A')], urls: [] };
    const calls = flowRun({
        state: withPresets(), dashboard: [{ action: 'editGeneralPreset' }, back], editPreset: [wrong, fixed],
        presetResults: [{ throw: 'execution error: VibeCode: Terminal 1 („A“): Bitte einen relativen Unterordner ohne „..“ angeben. (1)' }, ok('ok')],
    });
    const edits = calls.filter((c) => c[0] === 'editPreset');
    assert.deepEqual(edits[1][2], wrong);
    assert.match(edits[1][4], /relativen Unterordner/);
    assert.deepEqual(calls.filter((c) => c[0] === 'preset').map((c) => c[1]), ['save-general', 'save-general']);
});

test('Presets: ohne Auswahl in der Repository-Liste passiert nichts', () => {
    const calls = flowRun({ state: withPresets(), dashboard: [{ action: 'newPreset' }, back], pickRepo: [null] });
    assert.deepEqual(calls.find((c) => c[0] === 'pickRepo'), ['pickRepo', ['alpha', 'beta', 'r [SSH: spark]']]);
    assert.ok(!kinds(calls).includes('editPreset'));
});

// ------------------------------------------------------------------ Widgets

test('App-Einstellungen: Schalter bleiben im Fenster, lesen den Zustand neu und zeigen Fehler', () => {
    const changes = [
        { action: 'setting', name: 'keep-awake', enabled: true },
        { action: 'setting', name: 'keep-awake', enabled: false },
    ];
    const calls = flowRun({ state: STATE(), dashboard: [...changes, { action: 'close' }] });
    assert.deepEqual(calls.filter((c) => c[0] === 'setting'), changes.map((c) => ['setting', c.name, c.enabled]));
    assert.equal(calls.filter((c) => c[0] === 'state').length, 3);
    assert.ok(!kinds(calls).includes('open'));
    const failed = flowRun({ state: STATE(), dashboard: [changes[0], { action: 'close' }],
        settingError: 'VibeCode: Wachhalten konnte nicht geändert werden.' });
    assert.deepEqual(failed.find((c) => c[0] === 'error'), ['error', 'Wachhalten konnte nicht geändert werden.']);
});

test('Wachhalten: Workspaces zeigt beide Modi und die App-Auswahl', () => {
    const model = (wake) => JSON.parse(widgets(`return JSON.stringify(dashboardModel(${JSON.stringify(
        Object.assign(ssh(), { settings: { wake } }))}));`));
    const wakeItem = (pages, title) => pages.find((page) => page.id === 'workspaces').rows.find((row) => row.title === title);
    const apps = ['Claude Code (Remote Control)', 'Codex App'];
    const pure = model({ enabled: true, withApps: false, apps, text: 'AN', level: 'ok' });
    const only = wakeItem(pure, 'Nur wachhalten');
    const combined = wakeItem(pure, 'Wachhalten mit Apps');
    assert.deepEqual(only.buttons[0].action, { action: 'setting', name: 'keep-awake', enabled: false });
    assert.deepEqual(combined.buttons[0].action, { action: 'setting', name: 'keep-awake-apps', enabled: true });
    assert.equal(combined.detail, apps.join(' · '));
    assert.equal(combined.buttons[1].label, 'Apps wählen…');
    const withApps = model({ enabled: true, withApps: true, apps, text: 'AN', level: 'ok' });
    assert.equal(wakeItem(withApps, 'Wachhalten mit Apps').buttons[0].label, 'Ausschalten');
    assert.equal(wakeItem(withApps, 'Nur wachhalten').buttons[0].label, 'Einschalten');
    const unknown = { enabled: null, text: 'Status nicht lesbar', level: 'warn' };
    assert.deepEqual(wakeItem(model(unknown), 'Wachhalten mit Apps').buttons.map((b) => b.label), ['Apps wählen…']);
    assert.equal(wakeItem(model(null), 'Nur wachhalten'), undefined);
});

test('App-Einstellungen: Backend setzt gezielt ein oder aus', () => {
    const out = JSON.parse(jxa(`${library}
function run() {
    const commands = [];
    const backend = makeBackend({ doShellScript: (command) => { commands.push(command); return ''; } }, '/usr/bin/python3', '/c/vibecode.py');
    backend.setting('keep-awake', true);
    backend.setting('keep-awake', false);
    return JSON.stringify(commands);
}`));
    assert.deepEqual(out, ["'/usr/bin/python3' '/c/vibecode.py' 'settings' 'keep-awake' 'on'",
        "'/usr/bin/python3' '/c/vibecode.py' 'settings' 'keep-awake' 'off'"]);
});

function widgets(body, prelude = '') {
    return jxa(`${library.replace(PRESENT, 'function present(alert, widgets) { return scriptedPresent(alert, widgets); }')
        .replace(PRESENT_DASHBOARD, 'function presentDashboard(built) { return scriptedDashboard(built); }')}
const titles = (alert) => { const out = []; for (let i = 0; i < alert.buttons.count; i += 1) out.push(ObjC.unwrap(alert.buttons.objectAtIndex(i).title)); return out; };
const STATE = ${JSON.stringify(STATE())};
const dashboardRows = (state) => dashboardModel(state).flatMap((tab) => tab.rows);
const tabRows = (state, id) => dashboardModel(state).find((tab) => tab.id === id).rows;
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

test('Übersicht: vier Reiter mit den passenden Aktionen in jedem Bereich', () => {
    const pages = JSON.parse(widgets(`return JSON.stringify(dashboardModel(${JSON.stringify(MODEL_STATE)}));`));
    assert.deepEqual(pages.map((page) => page.label), ['Workspaces', 'Projekte', 'Remote', 'Local Dev']);
    const workspaceRows = pages[0].rows;
    const workspaceFooter = workspaceRows.findIndex((row) => row.type === 'footer');
    const items = workspaceRows.slice(0, workspaceFooter).filter((row) => row.type === 'item');
    assert.deepEqual(items.map((row) => row.title), ['Demo', 'Alt']);
    assert.equal(items[0].detail, 'Schreibtisch ✓ · A, B');
    assert.equal(items[1].detail, 'kein Shortcut · ⚠︎ nicht gefunden: weg · A, weg');
    assert.deepEqual(items.map((row) => row.level), ['ok', 'warn']);
    assert.deepEqual(items[0].buttons.map((b) => b.label), ['Quick-Öffnen', 'Starten', 'Bearbeiten…']);
    assert.deepEqual(items[0].buttons[0].action, { action: 'quickWorkspace', name: 'Demo', enabled: true });
    assert.deepEqual(items[0].buttons[1].action, { action: 'start', name: 'Demo' });
    assert.equal(items[0].buttons[1].primary, true);
    assert.deepEqual(workspaceRows[workspaceFooter].buttons.map((b) => b.label),
        ['Workspace anlegen…', 'Einmaliger Workspace…', 'Shortcuts erneuern']);
    const sshMac = pages[2].rows.find((row) => row.title === REMOTE_MAC.title);
    assert.deepEqual(sshMac.buttons[0].action, { action: 'connect', item: REMOTE_MAC });
    const localDev = pages[3].rows.find((row) => row.type === 'item');
    assert.equal(localDev.title, 'Local Dev');
    assert.deepEqual(localDev.buttons.map((button) => button.action), [{ action: 'localSetup' }, { action: 'open', id: 'local' }]);
});

test('Übersicht: der leere Zustand hängt vom Reiter ab', () => {
    const pages = JSON.parse(widgets(`return JSON.stringify(dashboardModel({ workspaces: [], projects: [], entries: [],
        ssh: { available: true, guided: true, share: false, hosts: [], mac: null, errors: ['hosts: kaputt'] } }));`));
    const remote = pages[2].rows;
    const notes = remote.filter((row) => row.type === 'note');
    assert.deepEqual(notes.map((row) => row.text), ['Noch keine Verbindung zu einem anderen Mac oder Server eingerichtet.', '⚠︎ hosts: kaputt']);
    assert.equal(notes[1].level, 'warn');
    assert.ok(!remote.some((row) => row.text === 'Zugriff auf diesen Mac'));
    assert.ok(pages[0].rows.some((row) => row.text === 'Noch kein Workspace angelegt.'));
});

test('Übersicht: der SSH-Bereich erscheint nur, wenn ein Modul SSH anbietet', () => {
    const sections = (extra) => JSON.parse(widgets(`return JSON.stringify(dashboardRows(Object.assign({}, STATE, ${extra}))
        .filter((row) => row.type === 'section').map((row) => row.text));`));
    assert.ok(!sections('{}').includes('Verbindungen von diesem Mac'));
    assert.ok(!sections('{ ssh: { available: false, hosts: [], mac: null, errors: [] } }').includes('Verbindungen von diesem Mac'));
    assert.ok(sections(`{ ssh: ${SSH_JSON} }`).includes('Verbindungen von diesem Mac'));
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
    assert.deepEqual(out.titles, ['Quick-Öffnen', 'Starten', 'Bearbeiten…', 'Quick-Öffnen', 'Starten', 'Bearbeiten…', 'Workspace anlegen…',
        'Einmaliger Workspace…', 'Shortcuts erneuern', 'Einschalten', 'Einschalten', 'Apps wählen…', 'Verbinden', 'Verbinden',
        'Neue Verbindung…', 'Geführte Einrichtung…', 'Diesen Mac freigeben…', 'Einstellen…', 'Öffnen', 'Schließen']);
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
    assert.ok(out.small > out.smallTotal + 52 && out.small < out.big);
});

test('Übersicht: native Reiter wechseln im Fenster und bleiben nach einer Aktion ausgewählt', () => {
    const out = JSON.parse(widgets(`
        const ui = nativeUi({});
        const state = ${JSON.stringify(MODEL_STATE)};
        return JSON.stringify({ chosen: ui.dashboard(state), again: ui.dashboard(state), seen });`, `
        const seen = [];
        function scriptedDashboard(built) {
            const selected = () => ObjC.unwrap(built.tabs.selectedTabViewItem.identifier);
            seen.push(selected());
            if (seen.length > 1) return { action: 'close' };
            built.navigation[2].view.performClick(null);
            if (dashboardAction !== null || selected() !== 'remote') throw new Error('Tabwechsel muss im Fenster bleiben');
            const target = built.buttons.find((button) => button.title === 'Verbinden');
            target.view.performClick(null);
            return dashboardAction;
        }`));
    assert.deepEqual(out.chosen, { action: 'connect', item: SPARK });
    assert.deepEqual(out.seen, ['workspaces', 'remote']);
    assert.deepEqual(out.again, { action: 'close' });
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
        const asleep = buildShare(${JSON.stringify(SHARE({ awake: false }))});
        const awake = buildShare(${JSON.stringify(SHARE({ awake: true }))});
        return JSON.stringify({ asleep: titles(asleep.alert), awake: titles(awake.alert),
            actions: [asleep.actions, awake.actions], text: ObjC.unwrap(asleep.alert.informativeText),
            awakeText: ObjC.unwrap(awake.alert.informativeText) });`));
    assert.deepEqual(out.asleep, ['Schlüssel eintragen…', 'Zeile kopieren', 'Wach halten', 'Fertig']);
    assert.deepEqual(out.awake, ['Schlüssel eintragen…', 'Zeile kopieren', 'Fertig']);
    assert.deepEqual(out.actions, [['allow', 'copy', 'wake', 'done'], ['allow', 'copy', 'done']]);
    assert.match(out.text, /Wachhalten: aus\. Der Mac kann einschlafen/);
    assert.match(out.awakeText, /Wachhalten: an ✓/);
});

test('Freigabe-Dialog: bereit zeigt Status, zwei Schritte und die Zeile in einem eigenen markierbaren Feld, ohne Terminal-Befehle', () => {
    const line = 'workspace remote ssh join t@h.local SHA256:abc';
    const out = JSON.parse(widgets(`
        const built = buildShare(${JSON.stringify(SHARE({ line }))});
        const subviews = Array.from({ length: Number(built.alert.accessoryView.subviews.count) },
            (_, i) => built.alert.accessoryView.subviews.objectAtIndex(i));
        return JSON.stringify({ title: ObjC.unwrap(built.alert.messageText), text: ObjC.unwrap(built.alert.informativeText),
            fields: subviews.map((view) => [ObjC.unwrap(view.stringValue), Boolean(view.selectable)]) });`));
    assert.equal(out.title, 'Diesen Mac freigeben');
    assert.match(out.text, /^Bereit: Dieser Mac nimmt SSH-Verbindungen an\. ✓/);
    assert.match(out.text, /1\. Auf dem anderen Mac: VibeCode → SSH → Neue Verbindung… → „Mit der Zeile eines anderen Macs verbinden“/);
    assert.match(out.text, /\(sie liegt in der Zwischenablage\):$/);
    assert.deepEqual(out.fields[0], [line, true]);                                           // die Zeile: eigenes Feld, markierbar
    assert.match(out.fields[1][0], /^2\. Der andere Mac zeigt dann eine Zeile\. Klicke hier auf „Schlüssel eintragen…“/);
    // Befehle fürs Terminal gehören nicht in die Maske.
    for (const text of [out.text, ...out.fields.slice(1).map((f) => f[0])]) assert.doesNotMatch(text, /sudo|systemsetup|--wake|workspace remote/);
});

test('Freigabe-Dialog: die Rückmeldung nach „Zeile kopieren“ steht ganz oben', () => {
    const out = JSON.parse(widgets(`
        const text = (notice) => ObjC.unwrap(buildShare(${JSON.stringify(SHARE())}, notice).alert.informativeText);
        return JSON.stringify({ with: text('Zeile kopiert ✓'), without: text('') });`));
    assert.match(out.with, /^Zeile kopiert ✓\nBereit: Dieser Mac nimmt SSH-Verbindungen an\. ✓/);
    assert.match(out.without, /^Bereit: Dieser Mac nimmt SSH-Verbindungen an\. ✓/);
});

test('Kopieren: der Text landet im Pasteboard, ersetzt den alten, und die echte Zwischenablage wird dabei nicht angefasst', () => {
    const out = JSON.parse(widgets(`
        const board = $.NSPasteboard.pasteboardWithUniqueName;           // ein eigenes Pasteboard: Cmd+V des Nutzers bleibt unberührt
        const first = copyToBoard(board, 'workspace remote ssh join a@b');
        const afterFirst = ObjC.unwrap(board.stringForType($.NSPasteboardTypeString));
        copyToBoard(board, 'zweiter Text mit Umlaut ä und \\'Anführungszeichen\\'');
        return JSON.stringify({ first, afterFirst, second: ObjC.unwrap(board.stringForType($.NSPasteboardTypeString)) });`));
    assert.equal(out.first, true);
    assert.equal(out.afterFirst, 'workspace remote ssh join a@b');
    assert.equal(out.second, "zweiter Text mit Umlaut ä und 'Anführungszeichen'");
});

test('Einfügen: das Programm bekommt ein Bearbeiten-Menü, damit Cmd+V, Cmd+C, Cmd+X und Cmd+A in den Dialogen wirken', () => {
    const out = JSON.parse(widgets(`
        const application = $.NSApplication.sharedApplication;
        const keyEvent = (key) => $.NSEvent.keyEventWithTypeLocationModifierFlagsTimestampWindowNumberContextCharactersCharactersIgnoringModifiersIsARepeatKeyCode(
            $.NSEventTypeKeyDown, $.NSMakePoint(0, 0), $.NSEventModifierFlagCommand, 0, 0, $(), $(key), $(key), false, 0);
        const before = application.mainMenu ? Number(application.mainMenu.numberOfItems) : 0;
        const menu = installEditMenu(application);
        const edit = menu.itemAtIndex(1).submenu;
        const items = Array.from({ length: Number(edit.numberOfItems) }, (_, i) => {
            const item = edit.itemAtIndex(i);
            return [ObjC.unwrap(item.title), ObjC.unwrap(item.action), ObjC.unwrap(item.keyEquivalent)];
        });
        const handled = ['v', 'c', 'x', 'a', 'q'].map((key) => [key, Boolean(application.mainMenu.performKeyEquivalent(keyEvent(key)))]);
        return JSON.stringify({ before, same: application.mainMenu === menu || ObjC.unwrap(application.mainMenu.itemAtIndex(1).submenu.title) === 'Bearbeiten',
            titles: [ObjC.unwrap(menu.itemAtIndex(0).submenu.title), ObjC.unwrap(edit.title)], items, handled });`));
    assert.equal(out.same, true);
    assert.deepEqual(out.items.map((item) => item.slice(0, 3)), [['Ausschneiden', 'cut:', 'x'], ['Kopieren', 'copy:', 'c'],
        ['Einsetzen', 'paste:', 'v'], ['Alles auswählen', 'selectAll:', 'a']]);
    // Das Kürzel wird erkannt. Ohne dieses Menü gab es keinen Treffer, und Einfügen tat gar nichts (Cmd+Q ist bewusst nicht belegt).
    assert.deepEqual(out.handled, [['v', true], ['c', true], ['x', true], ['a', true], ['q', false]]);
});

test('Freigabe-Dialog: Kopieren fehlgeschlagen und unlesbarer Host-Schlüssel werden gesagt', () => {
    const out = JSON.parse(widgets(`
        const text = (share) => ObjC.unwrap(buildShare(share).alert.informativeText);
        return JSON.stringify({ copyFailed: text(${JSON.stringify(SHARE({ copied: false }))}),
            noKey: text(${JSON.stringify(SHARE({ fingerprint: false }))}), fine: text(${JSON.stringify(SHARE())}) });`));
    assert.match(out.copyFailed, /das Kopieren hat nicht geklappt, markiere sie und kopiere sie selbst/);
    assert.doesNotMatch(out.copyFailed, /liegt in der Zwischenablage/);
    assert.match(out.noKey, /⚠︎ Der Host-Schlüssel ist nicht lesbar/);
    assert.doesNotMatch(out.fine, /⚠︎/);
});

test('Freigabe-Dialog: sagt, ob die Zeile auch unterwegs gilt (Tailscale) oder nur im selben Netz', () => {
    const out = JSON.parse(widgets(`
        const text = (share) => ObjC.unwrap(buildShare(share).alert.informativeText);
        return JSON.stringify({ away: text(${JSON.stringify(SHARE({ via: 'tailscale', tailscale: 'running', localLine: 'x' }))}),
            noName: text(${JSON.stringify(SHARE({ via: 'local', tailscale: 'running' }))}),
            off: text(${JSON.stringify(SHARE({ via: 'local', tailscale: 'off' }))}),
            missing: text(${JSON.stringify(SHARE({ via: 'local', tailscale: 'missing' }))}),
            old: text(${JSON.stringify(SHARE())}) });`));
    assert.match(out.away, /Tailscale: verbunden ✓ Die Zeile gilt auch unterwegs/);
    assert.match(out.noName, /verbunden, aber ohne nutzbaren Namen\. Die Zeile gilt nur im selben Netz/);
    assert.match(out.off, /installiert, aber nicht verbunden\. Die Zeile gilt nur im selben Netz/);
    assert.match(out.missing, /nicht installiert\. .*Tailscale auf beiden Macs installieren/);
    assert.doesNotMatch(out.old, /Tailscale/);                                          // ein älteres Modul meldet nichts: dann auch keine Zeile
});

// Die neuen Zeilen (Tailnet-Name, 100.x-Adresse) müssen sich wie die alten aus der Zwischenablage vorbelegen lassen.
test('Neue Verbindung: join-Zeilen mit Tailnet-Namen und 100.x-Adresse werden erkannt, Fremdes nicht', () => {
    const FPR = 'SHA256:' + 'A'.repeat(43);
    const out = JSON.parse(widgets(`return JSON.stringify([
        joinLineFrom('workspace remote ssh join user@remote-mac.example-tailnet.ts.net ${FPR}'),
        joinLineFrom('workspace remote ssh join user@100.64.0.5 ${FPR}'),
        joinLineFrom('workspace remote ssh join user@remote-mac.local'),
        joinLineFrom('rm -rf / ; workspace remote ssh join user@100.64.0.5')]);`));
    assert.equal(out[0], `workspace remote ssh join user@remote-mac.example-tailnet.ts.net ${FPR}`);
    assert.equal(out[1], `workspace remote ssh join user@100.64.0.5 ${FPR}`);
    assert.equal(out[2], 'workspace remote ssh join user@remote-mac.local');
    assert.equal(out[3], '');
});

test('Freigabe-Dialog: Entfernte Anmeldung aus zeigt nur das Eine, was fehlt, und „Erneut prüfen“', () => {
    const off = SHARE({ remoteLogin: false, line: '', fingerprint: false, copied: false, settingsOpened: true });
    const out = JSON.parse(widgets(`
        const built = buildShare(${JSON.stringify(off)});
        const ui = nativeUi({});
        response = FIRST; const recheck = ui.share(${JSON.stringify(off)});
        response = FIRST + 1; const done = ui.share(${JSON.stringify(off)});
        response = FIRST + 7; const unknown = ui.share(${JSON.stringify(off)});
        return JSON.stringify({ buttons: titles(built.alert), actions: built.actions, text: ObjC.unwrap(built.alert.informativeText),
            hasLine: built.line !== null, recheck, done, unknown });`, `
        let response;
        function scriptedPresent() { return response; }`));
    assert.deepEqual(out.buttons, ['Erneut prüfen', 'Fertig']);
    assert.deepEqual([out.recheck, out.done, out.unknown], ['recheck', 'done', 'done']);       // unbekannter Knopf = Fertig, nie eine Aktion
    assert.match(out.text, /^Noch nicht bereit: „Entfernte Anmeldung“ ist ausgeschaltet\./);
    assert.match(out.text, /Allgemein → Teilen → Entfernte Anmeldung/);
    assert.equal(out.hasLine, false);                                                            // keine Zeile, solange sie nichts nützt
    assert.doesNotMatch(out.text, /sudo|systemsetup|--wake|workspace remote/);
});

test('SSH-Eingaben: Abbrechen liefert null, die Bestätigung ist eindeutig', () => {
    const out = JSON.parse(widgets(`
        let behaviour;
        const app = {
            displayDialog: (prompt, options) => {
                app.shown = { prompt, options };
                if (behaviour === 'cancel') { const e = new Error('abgebrochen'); e.errorNumber = -128; throw e; }
                if (behaviour === 'boom') throw new Error('anderer Fehler');
                return { textReturned: 'eingefügte Zeile' };
            },
        };
        const ui = nativeUi(app);
        behaviour = 'ok'; const typed = ui.askLine('Titel', 'Prompt');
        const options = app.shown.options;
        behaviour = 'cancel'; const cancelled = ui.askLine('Titel', 'Prompt');
        behaviour = 'boom'; let other = null; try { ui.askLine('T', 'P'); } catch (error) { other = error.message; }
        response = FIRST; const yes = ui.confirmAllow('user@client', 'SHA256:xyz');
        response = FIRST + 1; const no = ui.confirmAllow('user@client', 'SHA256:xyz');
        return JSON.stringify({ typed, cancelled, other, yes, no,
            defaultButton: options.defaultButton, cancelButton: options.cancelButton, seen });`, `
        let response;
        const seen = [];
        function scriptedPresent(alert) { seen.push(ObjC.unwrap(alert.informativeText)); return response; }`));
    assert.equal(out.typed, 'eingefügte Zeile');
    assert.equal(out.cancelled, null);
    assert.equal(out.other, 'anderer Fehler');
    assert.equal(out.yes, true);
    assert.equal(out.no, false);
    assert.equal(out.cancelButton, 'Abbrechen');
    assert.match(out.seen[0], /Name: user@client\nFingerprint: SHA256:xyz/);
    assert.match(out.seen[0], /deinem eigenen Mac/);
});

test('Neue Verbindung: ein Dialog mit Verbinden, Geführte Einrichtung… und Abbrechen; die Zeile steht schon drin, wenn sie passt', () => {
    const out = JSON.parse(widgets(`
        let behaviour;
        const app = {
            displayDialog: (prompt, options) => {
                app.shown = { prompt, options };
                if (behaviour === 'cancel') { const e = new Error('abgebrochen'); e.errorNumber = -128; throw e; }
                if (behaviour === 'boom') throw new Error('anderer Fehler');
                return behaviour === 'guided' ? { textReturned: '', buttonReturned: 'Geführte Einrichtung…' }
                    : { textReturned: 'workspace remote ssh join a@b', buttonReturned: 'Verbinden' };
            },
        };
        const ui = nativeUi(app);
        behaviour = 'line'; const line = ui.askConnection(true, 'workspace remote ssh join vor@ausgefüllt', 'Hinweis');
        const withGuide = app.shown;
        behaviour = 'guided'; const guided = ui.askConnection(true, '', '');
        behaviour = 'line'; const noGuide = ui.askConnection(false, '', '');
        const withoutGuide = app.shown;
        behaviour = 'cancel'; const cancelled = ui.askConnection(true, '', '');
        behaviour = 'boom'; let other = null; try { ui.askConnection(true, '', ''); } catch (error) { other = error.message; }
        return JSON.stringify({ line, guided, noGuide, cancelled, other, withGuide, withoutGuide });`));
    assert.deepEqual(out.line, { line: 'workspace remote ssh join a@b' });
    assert.deepEqual(out.guided, { guided: true });
    assert.deepEqual(out.noGuide, { line: 'workspace remote ssh join a@b' });
    assert.equal(out.cancelled, null);
    assert.equal(out.other, 'anderer Fehler');
    assert.deepEqual(out.withGuide.options.buttons, ['Abbrechen', 'Geführte Einrichtung…', 'Verbinden']);
    assert.deepEqual(out.withoutGuide.options.buttons, ['Abbrechen', 'Verbinden']);                  // ohne Setup-Modul kein Knopf dafür
    assert.equal(out.withGuide.options.defaultAnswer, 'workspace remote ssh join vor@ausgefüllt');   // vorausgefüllt
    assert.equal(out.withGuide.options.defaultButton, 'Verbinden');
    assert.equal(out.withGuide.options.cancelButton, 'Abbrechen');
    assert.match(out.withGuide.prompt, /^Hinweis\n\nFüge die Zeile ein/);
    assert.match(out.withGuide.prompt, /Zwischenablage ist schon eingetragen/);
    assert.match(out.withGuide.prompt, /Geführte Einrichtung/);
    assert.doesNotMatch(out.withoutGuide.prompt, /Zwischenablage|Geführte/);
});

test('Neue Verbindung: nur eine einzelne join-Zeile wird aus der Zwischenablage übernommen, alles andere nie', () => {
    const out = JSON.parse(widgets(`
        const cases = ['workspace remote ssh join user@Remote-Mac.local SHA256:abc', '  workspace remote ssh join user@Remote-Mac.local SHA256:abc 22\\n',
            'workspace remote ssh join user@Remote-Mac.local', 'workspace remote ssh join', 'workspace remote ssh allow x', 'ls -la',
            'workspace remote ssh join a@b SHA256:abc\\nrm -rf ~', 'workspace remote ssh join a@b; rm -rf ~',
            'workspace remote ssh join ' + 'x'.repeat(400), 'workspace remote ssh join a b c d', '', null, 5, { text: 1 }];
        const pick = (app) => nativeUi(app).clipboardJoinLine();
        return JSON.stringify({ parsed: cases.map(joinLineFrom), ok: pick({ theClipboard: () => cases[0] }),
            nonText: pick({ theClipboard: () => { throw new Error('kein Text'); } }), junk: pick({ theClipboard: () => 'abc' }) });`));
    assert.deepEqual(out.parsed, ['workspace remote ssh join user@Remote-Mac.local SHA256:abc', 'workspace remote ssh join user@Remote-Mac.local SHA256:abc 22',
        'workspace remote ssh join user@Remote-Mac.local', '', '', '', '', '', '', '', '', '', '', '']);
    assert.equal(out.ok, 'workspace remote ssh join user@Remote-Mac.local SHA256:abc');
    assert.equal(out.nonText, '');                                                                  // keine Textinhalte: leer, kein Absturz
    assert.equal(out.junk, '');
});

test('Neue Verbindung: der Hinweis ist best effort, ein Fehler dabei bricht nichts ab', () => {
    const out = JSON.parse(widgets(`
        const shown = [];
        nativeUi({ displayNotification: (text, options) => shown.push([text, options]) }).notify('Verbinde …');
        let survived = true;
        try { nativeUi({ displayNotification: () => { throw new Error('Mitteilungen aus'); } }).notify('Verbinde …'); } catch (e) { survived = false; }
        return JSON.stringify({ shown, survived });`));
    assert.deepEqual(out.shown, [['Verbinde …', { withTitle: 'VibeCode Workspace' }]]);
    assert.equal(out.survived, true);
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

test('Projekte: lokale und entfernte Suchordner zeigen jeweils Repository-Zahl und Warnung', () => {
    const rows = JSON.parse(widgets(`return JSON.stringify(dashboardRows(${JSON.stringify(
        Object.assign(ssh(), { folders: FOLDERS }))}));`));
    assert.deepEqual(rows.filter((row) => row.type === 'section').map((row) => row.text),
        ['Workspaces', 'Wachhalten & Apps', 'Lokale Suchordner', 'Remote-Suchordner', 'Verbindungen von diesem Mac',
            'Zugriff auf diesen Mac', 'Anbieter, Modell und CLI']);
    const start = rows.findIndex((row) => row.text === 'Lokale Suchordner');
    const items = rows.slice(start).filter((row) => row.type === 'item').slice(0, 6);
    assert.deepEqual(items.map((row) => [row.title, row.detail, row.level]), [
        ['/Users/example/Github', '14 Repositories', 'ok'],
        ['/Volumes/Alt', '⚠︎ Ordner nicht gefunden', 'warn'],
        ['/Users/example/leer', '⚠︎ keine Repositories gefunden', 'warn'],
        ['/Users/example/riesig', '1 Repository · ⚠︎ Ordner sehr groß, Suche abgebrochen', 'warn'],
        ['spark:~/projects', '12 Repositories (zuletzt gefunden)', 'ok'],
        ['studio:/srv', '⚠︎ noch keine Repositories gefunden', 'warn']]);
    assert.ok(items.every((row) => row.middle));                                // Pfade werden in der Mitte gekürzt
    assert.deepEqual(items.map((row) => row.buttons.map((b) => b.label)), [
        ['Quick-Öffnen', 'Entfernen'], ['Entfernen'],                           // fehlender Ordner: nichts zu öffnen
        ['Quick-Öffnen', 'Entfernen'], ['Quick-Öffnen', 'Entfernen'], ['Entfernen'], ['Entfernen']]);   // remote: kein Quick-Öffnen
    assert.deepEqual(items[0].buttons[1].action,
        { action: 'removeFolder', kind: 'local', path: '/Users/example/Github', label: '/Users/example/Github' });
    assert.deepEqual(items[4].buttons[0].action,
        { action: 'removeFolder', kind: 'remote', host: 'spark', label: 'spark:~/projects' });
    const footers = rows.slice(start).filter((row) => row.type === 'footer').slice(0, 2);
    assert.deepEqual(footers.map((row) => row.buttons.map((button) => button.label)),
        [['Ordner hinzufügen…'], ['Remote-Ordner hinzufügen…']]);
});

test('Übersicht: ohne Suchordner steht ein kurzer Hinweis da, und fehlende Module blenden ihren Knopf aus', () => {
    const model = (folders) => JSON.parse(widgets(`return JSON.stringify(dashboardRows(Object.assign({}, STATE,
        { folders: ${JSON.stringify(folders)} })));`));
    const empty = model({ canAddLocal: true, canAddRemote: false, local: [], remote: [], errors: [] });
    const note = empty.find((row) => row.text && row.text.startsWith('Noch kein lokaler Suchordner'));
    assert.equal(note.text, 'Noch kein lokaler Suchordner eingerichtet.');
    assert.ok(note.text.length < 80);                                            // passt in eine Zeile
    const footers = empty.filter((row) => row.type === 'footer').map((row) => row.buttons.map((b) => b.label));
    assert.deepEqual(footers[1], ['Ordner hinzufügen…']);                       // ohne Hosts-Modul kein Remote-Knopf
    const failing = model(Object.assign({}, FOLDERS, { errors: ['Suchordner: Ungültige search-folders.json'] }));
    assert.ok(failing.some((row) => row.type === 'note' && row.level === 'warn' && row.text.includes('search-folders.json')));
    const sections = (folders) => model(folders).filter((row) => row.type === 'section').map((row) => row.text);
    assert.ok(!sections({ canAddLocal: false, canAddRemote: false, local: [], remote: [], errors: [] }).includes('Lokale Suchordner'));
    assert.deepEqual(JSON.parse(widgets(`return JSON.stringify(dashboardRows(STATE).filter((row) => row.type === 'section')
        .map((row) => row.text));`)), ['Workspaces', 'Wachhalten & Apps', 'Anbieter, Modell und CLI']);
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
    assert.deepEqual(out.clicked.map((c) => c.action.action).filter((action) => action !== 'removeFolder'), ['addFolder', 'addRemoteFolder']);
});

const QUICK = (extra = {}) => withFolders({ local: [Object.assign({ path: '/Users/example/Github', exists: true, repos: 3, truncated: false,
    quickOpen: true, shortcut: 'Github öffnen' }, extra), FOLDERS.local[1]] });

test('Übersicht: Quick-Öffnen ist ein Kästchen neben Entfernen und nennt den Shortcut auf dem Schreibtisch', () => {
    const model = (state) => JSON.parse(widgets(`return JSON.stringify(dashboardRows(${JSON.stringify(state)}));`));
    const folderRow = (state, title = '/Users/example/Github') => model(state).find((row) => row.type === 'item' && row.title === title);
    const off = folderRow(withFolders());
    assert.deepEqual(off.buttons.map((b) => [b.label, Boolean(b.checkbox), b.checked]),
        [['Quick-Öffnen', true, false], ['Entfernen', false, undefined]]);
    assert.deepEqual(off.buttons[0].action, { action: 'quickOpen', path: '/Users/example/Github', enabled: true });     // anklicken = einschalten
    assert.equal(off.detail, '14 Repositories');
    const on = folderRow(QUICK());
    assert.deepEqual(on.buttons.map((b) => [b.label, Boolean(b.checkbox), b.checked]),
        [['Quick-Öffnen', true, true], ['Entfernen', false, undefined]]);
    assert.deepEqual(on.buttons[0].action, { action: 'quickOpen', path: '/Users/example/Github', enabled: false });     // anklicken = ausschalten
    assert.equal(on.detail, '3 Repositories · Schreibtisch: „Github öffnen“');
    // Ein fehlender Ordner hat nichts zu öffnen: kein Kästchen. Eine Warnung wird nicht von dem Namen überdeckt.
    assert.deepEqual(folderRow(QUICK(), '/Volumes/Alt').buttons.map((b) => b.label), ['Entfernen']);
    assert.equal(folderRow(QUICK({ repos: 0 })).detail, '⚠︎ keine Repositories gefunden');
    const noName = folderRow(QUICK({ shortcut: null }));
    assert.equal(noName.detail, '3 Repositories');                              // Name nicht bestimmbar: nur das Kästchen
});

test('Übersicht: das Quick-Öffnen-Kästchen ist ein echter Schalter und löst seine Aktion aus', () => {
    const out = JSON.parse(widgets(`
        const result = ${JSON.stringify([withFolders(), QUICK()])}.map((state) => {
            const page = buildDashboard(dashboardModel(state));
            const box = page.buttons.find((b) => b.action.action === 'quickOpen');           // das Kästchen des Ordners, nicht des Workspaces
            const before = Number(box.view.state);
            dashboardAction = null;
            box.view.performClick(null);
            return { before, after: Number(box.view.state), action: dashboardAction, expected: box.action };
        });
        return JSON.stringify({ result, on: Number($.NSControlStateValueOn), off: Number($.NSControlStateValueOff) });`));
    assert.deepEqual(out.result.map((r) => [r.before, r.after]), [[out.off, out.on], [out.on, out.off]]);   // zeigt den gespeicherten Zustand
    for (const r of out.result) assert.deepEqual(r.action, r.expected);
});

test('Quick-Öffnen: das Kästchen schaltet pro Ordner an und aus, ohne das Fenster zu schließen', () => {
    const calls = flowRun({
        state: withFolders(),
        dashboard: [{ action: 'quickOpen', path: '/Users/example/Github', enabled: true }, { action: 'quickOpen', path: '/Users/example/Github', enabled: false }, back],
        folderResults: [ok('an'), ok('aus')],
    });
    assert.deepEqual(calls.filter((c) => c[0] === 'folder').map((c) => [c[1], c[2]]),
        [['quick-open', { path: '/Users/example/Github', mode: 'on' }], ['quick-open', { path: '/Users/example/Github', mode: 'off' }]]);
    assert.equal(calls.filter((c) => c[0] === 'dashboard').length, 3);                  // Übersicht wird danach neu gezeigt
});

test('Quick-Öffnen: scheitert der Shortcut (z. B. fremde Datei), zeigt das Fenster den Grund und bleibt offen', () => {
    const calls = flowRun({
        state: withFolders(), dashboard: [{ action: 'quickOpen', path: '/Users/example/Github', enabled: true }, back],
        folderResults: [{ throw: 'execution error: VibeCode: Auf dem Schreibtisch liegt schon „Github öffnen“, das nicht von VibeCode stammt' }],
    });
    assert.match(calls.find((c) => c[0] === 'error')[1], /^Auf dem Schreibtisch liegt schon „Github öffnen“/);
    assert.equal(calls.filter((c) => c[0] === 'dashboard').length, 2);
});

const QUICK_WS = (quickOpen) => STATE({ workspaces: [
    { name: 'Demo', projects: ['A', 'B'], shortcut: false, quickOpen, missing: [] },
    { name: 'Solo', projects: ['B'], shortcut: true, quickOpen: false, missing: [] }] });

test('Übersicht: Quick-Öffnen bei Workspaces ist ein Kästchen vor Starten und zeigt „Quick ✓“, wenn es an ist', () => {
    const rows = (state) => JSON.parse(widgets(`return JSON.stringify(dashboardRows(${JSON.stringify(state)}));`));
    const item = (state, title) => rows(state).find((row) => row.type === 'item' && row.title === title);
    const on = item(QUICK_WS(true), 'Demo');
    assert.deepEqual(on.buttons.map((b) => [b.label, Boolean(b.checkbox), b.checked]),
        [['Quick-Öffnen', true, true], ['Starten', false, undefined], ['Bearbeiten…', false, undefined]]);
    assert.deepEqual(on.buttons[0].action, { action: 'quickWorkspace', name: 'Demo', enabled: false });      // an: anklicken schaltet aus
    assert.equal(on.detail, 'kein Shortcut · Quick ✓ · A, B');
    const off = item(QUICK_WS(false), 'Demo');
    assert.deepEqual(off.buttons[0].action, { action: 'quickWorkspace', name: 'Demo', enabled: true });
    assert.equal(off.detail, 'kein Shortcut · A, B');
    assert.equal(item(QUICK_WS(true), 'Solo').detail, 'Schreibtisch ✓ · B');                                    // jeder Workspace für sich
    // „Shortcuts erneuern“ gibt es auch, wenn nur ein Quick-Shortcut existiert (kein normaler).
    const footer = (state) => rows(state).filter((row) => row.type === 'footer')[0].buttons.map((b) => b.label);
    assert.ok(footer(STATE({ workspaces: [QUICK_WS(true).workspaces[0]] })).includes('Shortcuts erneuern'));
    assert.ok(!footer(STATE({ workspaces: [QUICK_WS(false).workspaces[0]] })).includes('Shortcuts erneuern'));
    // … und wenn es nur das Quick-Öffnen eines Suchordners gibt (kein Workspace mit Shortcut): auch dieser Shortcut wird neu angelegt.
    const folders = (quickOpen) => ({ canAddLocal: true, canAddRemote: false, errors: [], remote: [],
        local: [{ path: '/Users/example/Github', exists: true, repos: 3, truncated: false, quickOpen, shortcut: quickOpen ? 'Github öffnen (Mac A)' : null }] });
    assert.ok(footer(STATE({ workspaces: [], folders: folders(true) })).includes('Shortcuts erneuern'));
    assert.ok(!footer(STATE({ workspaces: [], folders: folders(false) })).includes('Shortcuts erneuern'));
});

test('Übersicht: das Quick-Öffnen-Kästchen eines Workspaces ist ein echter Schalter und löst seine Aktion aus', () => {
    const out = JSON.parse(widgets(`
        const result = ${JSON.stringify([QUICK_WS(false), QUICK_WS(true)])}.map((state) => {
            const box = buildDashboard(dashboardModel(state)).buttons.find((b) => b.action.action === 'quickWorkspace');
            const before = Number(box.view.state);
            dashboardAction = null;
            box.view.performClick(null);
            return { before, after: Number(box.view.state), action: dashboardAction, expected: box.action };
        });
        return JSON.stringify({ result, on: Number($.NSControlStateValueOn), off: Number($.NSControlStateValueOff) });`));
    assert.deepEqual(out.result.map((r) => [r.before, r.after]), [[out.off, out.on], [out.on, out.off]]);
    for (const r of out.result) assert.deepEqual(r.action, r.expected);
});

test('Quick-Öffnen bei Workspaces: das Kästchen schaltet pro Workspace an und aus, ohne das Fenster zu schließen', () => {
    const calls = flowRun({
        state: QUICK_WS(false),
        dashboard: [{ action: 'quickWorkspace', name: 'Demo', enabled: true }, { action: 'quickWorkspace', name: 'Demo', enabled: false }, back],
    });
    assert.deepEqual(calls.filter((c) => c[0] === 'quickWorkspace'), [['quickWorkspace', 'Demo', true], ['quickWorkspace', 'Demo', false]]);
    assert.equal(calls.filter((c) => c[0] === 'dashboard').length, 3);
});

test('Quick-Öffnen bei Workspaces: scheitert der Shortcut, zeigt das Fenster den Grund und bleibt offen', () => {
    const calls = flowRun({
        state: QUICK_WS(false), dashboard: [{ action: 'quickWorkspace', name: 'Demo', enabled: true }, back],
        quickWorkspaceError: 'execution error: VibeCode: Auf dem Schreibtisch liegt schon „Demo öffnen“, das nicht von VibeCode stammt',
    });
    assert.match(calls.find((c) => c[0] === 'error')[1], /^Auf dem Schreibtisch liegt schon „Demo öffnen“/);
    assert.equal(calls.filter((c) => c[0] === 'dashboard').length, 2);
});

test('Quick-Öffnen-Aufruf eines Workspaces: Name als eigenes Argument, auch mit führendem Minus und Apostroph', () => {
    const out = JSON.parse(jxa(`${library}
const seen = [];
const app = { doShellScript: (command) => { seen.push(command); return 'ok'; } };
function run() {
    const backend = makeBackend(app, '/usr/bin/python3', '/c/vibecode.py');
    backend.quickWorkspace("-x it's", true);
    backend.quickWorkspace('Demo', false);
    return JSON.stringify(seen);
}`));
    assert.deepEqual(out, ["'/usr/bin/python3' '/c/vibecode.py' 'workspace-quick' '--name=-x it'\\''s' 'on'",
        "'/usr/bin/python3' '/c/vibecode.py' 'workspace-quick' '--name=Demo' 'off'"]);
});

// ------------------------------------------------------------------ Local Dev im Workspace-Dialog

const OPTION = (provider, model, framework, extra = {}) => Object.assign({ provider, providerName: provider === 'mlx' ? 'MLX (lokal)' : 'Ollama (lokal)',
    model, local: true, framework, frameworkName: framework === 'codex' ? 'Codex CLI' : 'OpenCode', active: false }, extra);
const LOCAL_OPTIONS = { available: true, error: null, options: [OPTION('mlx', 'XH/Spark', 'opencode'),
    OPTION('ollama', 'qwen:7b', 'codex'), OPTION('ollama', 'qwen:7b', 'opencode'), OPTION('ollama', 'big:70b', 'opencode', { local: false })] };
const SAVED = { provider: 'ollama', model: 'qwen:7b', framework: 'opencode' };

test('Local Dev im Dialog: neuer Workspace startet auf „Kein Local Dev“ und speichert nur mit, was gewählt ist', () => {
    const calls = flowRun({
        state: STATE(), dashboard: [{ action: 'new' }, back], localOptions: LOCAL_OPTIONS,
        edit: [{ name: 'Neu', projects: ['A'], shortcut: false, localDev: { provider: 'mlx', model: 'XH/Spark', framework: 'opencode' } }],
    });
    const edit = calls.find((c) => c[0] === 'edit');
    assert.equal(edit[1].localDev, null);                                                   // aus, solange nichts gewählt ist
    assert.deepEqual(edit[4].choices.map((c) => [c.label, c.selected]), [
        ['Kein Local Dev', true],
        ['MLX (lokal) · XH/Spark → OpenCode', false],
        ['Ollama (lokal) · qwen:7b → Codex CLI', false],
        ['Ollama (lokal) · qwen:7b → OpenCode', false],
        ['Ollama (lokal) · big:70b (nicht lokal) → OpenCode', false]]);
    assert.deepEqual(calls.find((c) => c[0] === 'save')[1].localDev, { provider: 'mlx', model: 'XH/Spark', framework: 'opencode' });
});

test('Local Dev im Dialog: ein gespeicherter Wert ist vorgewählt, „Kein Local Dev“ entfernt ihn', () => {
    const state = STATE({ workspaces: [{ name: 'Demo', projects: ['A'], shortcut: false, missing: [], localDev: SAVED }] });
    const calls = flowRun({
        state, dashboard: [{ action: 'edit', name: 'Demo' }, { action: 'edit', name: 'Demo' }, back], localOptions: LOCAL_OPTIONS,
        edit: [{ name: 'Demo', projects: ['A'], shortcut: false, localDev: null }, null],
    });
    const edits = calls.filter((c) => c[0] === 'edit');
    assert.deepEqual(edits[0][1].localDev, SAVED);
    assert.deepEqual(edits[0][4].choices.filter((c) => c.selected).map((c) => c.label), ['Ollama (lokal) · qwen:7b → OpenCode']);
    assert.equal(calls.find((c) => c[0] === 'save')[1].localDev, null);                       // ausdrücklich entfernen
});

test('Local Dev im Dialog: ein nicht mehr startbarer Wert bleibt sichtbar und wird nicht stillschweigend gelöscht', () => {
    const gone = { provider: 'mlx', model: 'alt', framework: 'claude' };
    const state = STATE({ workspaces: [{ name: 'Demo', projects: ['A'], shortcut: false, missing: [], localDev: gone }] });
    for (const localOptions of [LOCAL_OPTIONS, { available: true, error: null, options: [] }]) {     // auch wenn gar nichts startbar ist
        const calls = flowRun({ state, dashboard: [{ action: 'edit', name: 'Demo' }, back], localOptions, edit: [null] });
        const choices = calls.find((c) => c[0] === 'edit')[4].choices;
        assert.deepEqual(choices.filter((c) => c.selected).map((c) => c.label), ['mlx · alt → claude (nicht verfügbar)']);
        assert.deepEqual(choices.at(-1).value, gone);
    }
});

test('Local Dev im Dialog: ohne Modul, ohne etwas Startbares oder bei einem Fehler gibt es keine Auswahl und nichts ändert sich', () => {
    const nothing = [{ available: false, options: [], error: null }, { available: true, options: [], error: null }];
    for (const localOptions of nothing) {
        const calls = flowRun({ state: STATE(), dashboard: [{ action: 'new' }, back], localOptions,
            edit: [{ name: 'Neu', projects: ['A'], shortcut: false }] });
        const edit = calls.find((c) => c[0] === 'edit');
        assert.equal(edit[4], null);
        assert.ok(!('localDev' in edit[1]));
        assert.ok(!('localDev' in calls.find((c) => c[0] === 'save')[1]));                    // Speichern lässt Local Dev unverändert
    }
    const failing = flowRun({ state: STATE(), dashboard: [{ action: 'new' }, back],
        localOptions: { available: true, options: [], error: 'Local Dev: Konfiguration ungültig' }, edit: [null] });
    assert.equal(failing.find((c) => c[0] === 'edit')[3], 'Local Dev: Konfiguration ungültig');   // der Grund steht im Dialog
    const broken = flowRun({ state: STATE(), dashboard: [{ action: 'new' }, back], localOptionsError: 'execution error: VibeCode: kaputt', edit: [null] });
    assert.equal(broken.find((c) => c[0] === 'edit')[4], null);
    assert.match(broken.find((c) => c[0] === 'edit')[3], /kaputt/);
});

test('Local Dev im Dialog: eine abgelehnte Eingabe behält auch die Local-Dev-Auswahl', () => {
    const wanted = { name: 'Neu', projects: ['A'], shortcut: false, localDev: SAVED };
    const calls = flowRun({
        state: STATE(), dashboard: [{ action: 'new' }, back], localOptions: LOCAL_OPTIONS, edit: [wanted, wanted],
        saveErrors: ['execution error: VibeCode: Es gibt schon einen Workspace „Neu“.'],
    });
    const edits = calls.filter((c) => c[0] === 'edit');
    assert.deepEqual(edits[1][1].localDev, SAVED);
    assert.equal(calls.filter((c) => c[0] === 'save').length, 2);
});

test('Local Dev im Dialog: echtes Auswahlmenü, vorgewählt, Auslesen liefert Wert oder null, ohne Menü gar nichts', () => {
    const out = JSON.parse(widgets(`
        const choices = localDevChoices(${JSON.stringify(LOCAL_OPTIONS.options)}, ${JSON.stringify(SAVED)});
        const draft = { name: 'Neu', projects: ['A'], shortcut: false, localDev: ${JSON.stringify(SAVED)} };
        const withMenu = buildEdit(STATE, draft, null, '', { choices });
        const titlesOf = (popup) => Array.from({ length: Number(popup.numberOfItems) }, (_, i) => ObjC.unwrap(popup.itemTitleAtIndex(i)));
        const before = collectEdit(withMenu);
        withMenu.local.popup.selectItemAtIndex(0);
        const off = collectEdit(withMenu);
        withMenu.local.popup.selectItemAtIndex(1);
        const first = collectEdit(withMenu);
        const plain = buildEdit(STATE, { name: 'Neu', projects: ['A'], shortcut: false }, null, '');
        const heightWith = Number(withMenu.alert.accessoryView.frame.size.height);
        const heightWithout = Number(plain.alert.accessoryView.frame.size.height);
        // Zwei gleich benannte Kombinationen: NSPopUpButton würde den ersten Titel sonst ersetzen.
        const twice = localDevChoices([${JSON.stringify(OPTION('mlx', 'm', 'opencode'))}, ${JSON.stringify(OPTION('mlx', 'm', 'opencode'))}], null);
        return JSON.stringify({ titles: titlesOf(withMenu.local.popup), selected: Number(buildEdit(STATE, draft, null, '', { choices }).local.popup.indexOfSelectedItem),
            before: before.localDev, off: off.localDev, first: first.localDev, plain: collectEdit(plain), heightWith, heightWithout,
            twice: twice.map((c) => c.label) });`));
    assert.deepEqual(out.titles, ['Kein Local Dev', 'MLX (lokal) · XH/Spark → OpenCode', 'Ollama (lokal) · qwen:7b → Codex CLI',
        'Ollama (lokal) · qwen:7b → OpenCode', 'Ollama (lokal) · big:70b (nicht lokal) → OpenCode']);
    assert.equal(out.selected, 3);                                                          // der gespeicherte Eintrag
    assert.deepEqual(out.before, SAVED);
    assert.equal(out.off, null);
    assert.deepEqual(out.first, { provider: 'mlx', model: 'XH/Spark', framework: 'opencode' });
    assert.ok(!('localDev' in out.plain));                                                  // ohne Menü: ungesetzt = unverändert
    assert.equal(out.heightWith - out.heightWithout, 62);
    assert.deepEqual(out.twice, ['Kein Local Dev', 'MLX (lokal) · m → OpenCode', 'MLX (lokal) · m → OpenCode (2)']);
});

test('Local Dev im Dialog: Speichern und Optionen gehen als eigene, gequotete Argumente an vibecode.py', () => {
    const out = JSON.parse(jxa(`${library}
const seen = [];
const app = { doShellScript: (command) => { seen.push(command); return '{"available": true, "options": [], "error": null}'; } };
function run() {
    const backend = makeBackend(app, '/usr/bin/python3', '/c/vibecode.py');
    backend.save({ name: 'W', projects: ['A'], shortcut: false, renameFrom: null });                                         // nichts angegeben
    backend.save({ name: 'W', projects: ['A'], shortcut: false, renameFrom: null, localDev: null });                          // entfernen
    backend.save({ name: 'W', projects: ['A'], shortcut: false, renameFrom: null,
        localDev: { provider: 'ollama', model: "-x it's", framework: 'opencode' } });                                         // setzen
    const options = backend.localDevOptions();
    return JSON.stringify({ seen, options });
}`));
    const base = "'/usr/bin/python3' '/c/vibecode.py' 'save' '--name=W' '--project=A' '--no-shortcut'";
    assert.deepEqual(out.seen, [base, `${base} '--no-local-dev'`,
        `${base} '--local-dev-provider=ollama' '--local-dev-model=-x it'\\''s' '--local-dev-framework=opencode'`,
        "'/usr/bin/python3' '/c/vibecode.py' 'local-options'"]);
    assert.deepEqual(out.options, { available: true, options: [], error: null });
});

// ------------------------------------------------------------------ Local Dev einstellen (Zeile unten)

const ALL = { available: true, error: null, current: { provider: 'mlx', model: 'XH/Spark', framework: 'opencode' }, options: [
    OPTION('mlx', 'XH/Spark', 'opencode', { active: true, providerReady: false, frameworkReady: true }),
    OPTION('ollama', 'qwen:7b', 'codex', { providerReady: true, frameworkReady: false }),
    OPTION('ollama', 'big:70b', 'opencode', { local: false, providerReady: true, frameworkReady: true })] };

test('Übersicht: nur die Local-Dev-Zeile bekommt „Einstellen…“, vor „Öffnen“', () => {
    const rows = JSON.parse(widgets(`return JSON.stringify(dashboardRows(${JSON.stringify(STATE({
        entries: [{ id: 'local', title: 'Local Dev', status: { text: 'MLX · Spark → opencode', level: 'ok' } }, { id: 'remote', title: 'Remote', status: null }] }))}));`));
    const local = rows.find((row) => row.type === 'item' && row.title === 'Local Dev');
    assert.deepEqual(local.buttons.map((b) => b.label), ['Einstellen…', 'Öffnen']);
    assert.deepEqual(local.buttons[0].action, { action: 'localSetup' });
    assert.deepEqual(local.buttons[1].action, { action: 'open', id: 'local' });
    assert.deepEqual(rows.find((row) => row.type === 'item' && row.title === 'Remote').buttons.map((b) => b.label), ['Öffnen']);
});

test('Local Dev einstellen: zeigt alle Kombinationen mit Hinweisen, die gespeicherte ist vorgewählt, Speichern sendet den Wert', () => {
    const calls = flowRun({
        state: STATE(), dashboard: [{ action: 'localSetup' }, back], localSettings: ALL,
        pickLocalDev: [{ provider: 'ollama', model: 'big:70b', framework: 'opencode' }],
    });
    const choices = calls.find((c) => c[0] === 'pickLocalDev')[1];
    assert.deepEqual(choices.map((c) => [c.label, c.selected]), [
        ['MLX (lokal) · XH/Spark → OpenCode · Anbieter fehlt', true],           // MLX lässt sich auch ohne Installation einstellen
        ['Ollama (lokal) · qwen:7b → Codex CLI · CLI fehlt', false],
        ['Ollama (lokal) · big:70b (nicht lokal) → OpenCode', false]]);
    assert.ok(!choices.some((c) => c.value === null));                                       // hier gibt es kein „Kein Local Dev“
    assert.deepEqual(calls.filter((c) => c[0] === 'setLocalDefault'), [['setLocalDefault', { provider: 'ollama', model: 'big:70b', framework: 'opencode' }]]);
    assert.equal(calls.filter((c) => c[0] === 'dashboard').length, 2);                       // die Übersicht baut sich neu auf: neuer Status
});

test('Local Dev einstellen: Abbrechen speichert nichts, Fehler und leere Listen werden gesagt, ein Schreibfehler hält das Fenster offen', () => {
    const cancelled = flowRun({ state: STATE(), dashboard: [{ action: 'localSetup' }, back], localSettings: ALL, pickLocalDev: [null] });
    assert.ok(!kinds(cancelled).includes('setLocalDefault'));
    const failing = flowRun({ state: STATE(), dashboard: [{ action: 'localSetup' }, back],
        localSettings: { available: true, options: [], current: null, error: 'Local Dev: Konfiguration ungültig' } });
    assert.deepEqual(failing.find((c) => c[0] === 'error'), ['error', 'Local Dev: Konfiguration ungültig']);
    assert.ok(!kinds(failing).includes('pickLocalDev'));
    const empty = flowRun({ state: STATE(), dashboard: [{ action: 'localSetup' }, back],
        localSettings: { available: true, options: [], current: null, error: null } });
    assert.match(empty.find((c) => c[0] === 'info')[1], /keine passende Kombination/);
    const rejected = flowRun({ state: STATE(), dashboard: [{ action: 'localSetup' }, back], localSettings: ALL,
        pickLocalDev: [{ provider: 'mlx', model: 'm', framework: 'opencode' }],
        setDefaultError: 'execution error: VibeCode: Codex CLI und MLX sind nicht direkt kompatibel.' });
    assert.deepEqual(rejected.find((c) => c[0] === 'error'), ['error', 'Codex CLI und MLX sind nicht direkt kompatibel.']);
    assert.equal(rejected.filter((c) => c[0] === 'dashboard').length, 2);
    const unreadable = flowRun({ state: STATE(), dashboard: [{ action: 'localSetup' }, back], localSettingsError: 'execution error: VibeCode: kaputt' });
    assert.match(unreadable.find((c) => c[0] === 'error')[1], /kaputt/);
});

test('Local Dev einstellen: echtes Auswahlmenü, vorgewählt, Speichern liefert den Wert, Abbrechen null', () => {
    const out = JSON.parse(widgets(`
        const choices = localDevChoices(${JSON.stringify(ALL.options)}, ${JSON.stringify(ALL.current)}, false);
        const built = buildLocalDevSetting(choices);
        const titles = Array.from({ length: Number(built.popup.numberOfItems) }, (_, i) => ObjC.unwrap(built.popup.itemTitleAtIndex(i)));
        const ui = nativeUi({});
        pick = 1; response = FIRST; const saved = ui.pickLocalDev(choices);
        pick = -1; response = FIRST + 1; const cancelled = ui.pickLocalDev(choices);
        // Ohne lesbare Vorauswahl steht der erste Eintrag da.
        const none = buildLocalDevSetting(localDevChoices(${JSON.stringify(ALL.options)}, null, false));
        return JSON.stringify({ titles, selected: Number(built.popup.indexOfSelectedItem), buttons: titles2(built.alert), saved, cancelled,
            title: ObjC.unwrap(built.alert.messageText), text: ObjC.unwrap(built.alert.informativeText), noneSelected: Number(none.popup.indexOfSelectedItem) });`, `
        let response;
        let pick = -1;
        const titles2 = (alert) => titles(alert);
        function scriptedPresent(alert, built) { if (pick >= 0) built.popup.selectItemAtIndex(pick); return response; }`));
    assert.equal(out.titles.length, 3);
    assert.equal(out.selected, 0);                                                           // MLX · Spark → OpenCode: der gespeicherte Eintrag
    assert.deepEqual(out.buttons, ['Speichern', 'Abbrechen']);
    assert.equal(out.title, 'Local Dev einstellen');
    assert.match(out.text, /MLX oder Ollama.*OpenCode, Codex, Claude/s);
    assert.deepEqual(out.saved, { provider: 'ollama', model: 'qwen:7b', framework: 'codex' });
    assert.equal(out.cancelled, null);
    assert.equal(out.noneSelected, 0);
});

test('Local Dev einstellen: Aufrufe an vibecode.py mit eigenen, gequoteten Argumenten', () => {
    const out = JSON.parse(jxa(`${library}
const seen = [];
const app = { doShellScript: (command) => { seen.push(command); return '{"available": true, "options": [], "current": null, "error": null}'; } };
function run() {
    const backend = makeBackend(app, '/usr/bin/python3', '/c/vibecode.py');
    backend.localSettings();
    backend.setLocalDefault({ provider: 'ollama', model: "-x it's", framework: 'opencode' });
    return JSON.stringify(seen);
}`));
    assert.deepEqual(out, ["'/usr/bin/python3' '/c/vibecode.py' 'local-settings'",
        "'/usr/bin/python3' '/c/vibecode.py' 'local-default' '--provider=ollama' '--model=-x it'\\''s' '--framework=opencode'"]);
});

test('Übersicht: ein Workspace mit Local Dev zeigt „Local Dev ✓“ in der Zeile', () => {
    const rows = JSON.parse(widgets(`return JSON.stringify(dashboardRows(${JSON.stringify(STATE({ workspaces: [
        { name: 'Demo', projects: ['A', 'B'], shortcut: true, quickOpen: true, localDev: SAVED, missing: [] },
        { name: 'Solo', projects: ['B'], shortcut: false, missing: [] }] }))}));`));
    const details = rows.filter((row) => row.type === 'item').slice(0, 2).map((row) => row.detail);
    assert.deepEqual(details, ['Schreibtisch ✓ · Quick ✓ · Local Dev ✓ · A, B', 'kein Shortcut · B']);
});

test('Remote-Ordner-Dialog: das Host-Feld ist eine Combo-Box mit den verbundenen Geräten und bleibt frei beschreibbar', () => {
    const out = JSON.parse(widgets(`
        steps.push({ response: FIRST, host: 'frei-getippt' }, { response: FIRST });
        const typed = nativeUi({}).askRemoteFolder('', 'user@mac-a.local', ['user@mac-a.local', 'spark']);
        const plain = nativeUi({}).askRemoteFolder('', undefined, []);
        return JSON.stringify({ typed, plain, seen });`, `
        const steps = [];
        const seen = [];
        function scriptedPresent(alert, built) {
            const host = built.host;
            seen.push({ combo: Boolean(host.isKindOfClass($.NSComboBox)), editable: Boolean(host.editable), value: ObjC.unwrap(host.stringValue),
                items: Array.from({ length: Number(host.numberOfItems) }, (_, i) => ObjC.unwrap(host.itemObjectValueAtIndex(i))),
                label: ObjC.unwrap(built.alert.accessoryView.subviews.objectAtIndex(0).stringValue) });
            const step = steps.shift() || { response: FIRST, host: 'x' };
            if (step.host !== undefined) host.stringValue = $(step.host);
            return step.response;
        }`));
    assert.deepEqual(out.typed, { host: 'frei-getippt', root: '' });                     // auch ein Host, der nicht in der Liste steht
    assert.deepEqual(out.seen[0].items, ['user@mac-a.local', 'spark']);
    assert.equal(out.seen[0].value, 'user@mac-a.local');                                 // der Vorschlag steht im Feld
    assert.ok(out.seen[0].combo && out.seen[0].editable);
    assert.match(out.seen[0].label, /Liste öffnen oder .* eintippen/);
    assert.deepEqual(out.seen[1].items, []);                                             // ohne bekannte Geräte: das Feld wie vorher
    assert.match(out.seen[1].label, /Alias aus ~\/\.ssh\/config/);
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
    const rows = JSON.parse(widgets(`return JSON.stringify(dashboardRows(${JSON.stringify(
        Object.assign(ssh(), { folders: FOLDERS, presets: PRESETS }))}));`));
    assert.deepEqual(rows.filter((row) => row.type === 'section').map((row) => row.text),
        ['Workspaces', 'Wachhalten & Apps', 'Lokale Suchordner', 'Remote-Suchordner', 'Presets pro Repository',
            'Verbindungen von diesem Mac', 'Zugriff auf diesen Mac', 'Anbieter, Modell und CLI']);
    const start = rows.findIndex((row) => row.text === 'Presets pro Repository');
    const after = rows.slice(start + 1, rows.findIndex((row, index) => index > start && row.type === 'section'));
    assert.equal(after[0].title, 'Allgemeiner Standard');
    const items = after.filter((row) => row.type === 'item');
    assert.deepEqual(items.map((row) => [row.title, row.detail, row.level]), [
        ['Allgemeiner Standard', 'Eingebaut: Frontend, Claude', 'off'],
        ['alpha', 'Dev, Agent · 1 Browser-Tab', 'ok'],
        ['moved', '⚠︎ Repository nicht mehr gefunden · neuer Ort: /neu/moved · Shell · 0 Browser-Tabs', 'warn'],
        ['lost', '⚠︎ Repository nicht mehr gefunden · keine Terminals · 2 Browser-Tabs', 'warn']]);
    assert.deepEqual(items.map((row) => row.buttons.map((b) => b.label)),
        [['Festlegen…'], ['Bearbeiten…', 'Zurücksetzen'], ['Übernehmen', 'Entfernen'], ['Entfernen']]);   // Übernehmen nur mit Vorschlag
    assert.deepEqual(items[0].buttons[0].action, { action: 'editGeneralPreset' });
    assert.deepEqual(items[1].buttons[0].action, { action: 'editPreset', path: '/g/alpha' });
    assert.deepEqual(items[2].buttons[0].action,
        { action: 'movePreset', path: '/alt/moved', to: '/neu/moved', label: 'moved', toLabel: '/neu/moved' });
    assert.deepEqual(items[3].buttons[0].action, { action: 'resetPreset', path: '/alt/lost', label: 'lost' });
    assert.deepEqual(after.find((row) => row.type === 'footer').buttons.map((b) => b.label), ['Preset anlegen…']);
});

test('Übersicht: Presets ohne Repositories bieten kein Anlegen an, ohne Modul gibt es den Bereich nicht', () => {
    const model = (presets) => JSON.parse(widgets(`return JSON.stringify(dashboardRows(Object.assign({}, STATE,
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
        .find((row) => row.title === 'Allgemeiner Standard').detail, 'Eingebaut: Standard-Terminals');
    // Der allgemeine Standard braucht kein Repository: er lässt sich auch ohne eines festlegen.
    assert.ok(own.some((row) => row.type === 'item' && row.title === 'Allgemeiner Standard'));
});

test('Übersicht: ein festgelegter allgemeiner Standard ersetzt die eingebaute Zeile und lässt sich bearbeiten und zurücksetzen', () => {
    const general = { terminals: [TERM('Shell'), TERM('Agent', 'Claude Code')], urls: ['http://localhost:3000', 'http://localhost:6006'] };
    const rows = JSON.parse(widgets(`return JSON.stringify(dashboardRows(${JSON.stringify(
        Object.assign(ssh(), { presets: Object.assign({}, PRESETS, { general }) }))}));`));
    const start = rows.findIndex((row) => row.text === 'Presets pro Repository');
    const item = rows.slice(start + 1).find((row) => row.type === 'item');
    assert.deepEqual([item.title, item.detail, item.level],
        ['Allgemeiner Standard', 'Shell, Agent · 2 Browser-Tabs', 'ok']);
    assert.deepEqual(item.buttons.map((b) => [b.label, b.action]),
        [['Bearbeiten…', { action: 'editGeneralPreset' }], ['Zurücksetzen', { action: 'resetGeneralPreset' }]]);
    assert.ok(!rows.some((row) => row.text && row.text.startsWith('Eingebaut')));
});

test('Übersicht: die Preset-Knöpfe lösen ihre Aktion aus', () => {
    const out = JSON.parse(widgets(`
        const built = buildDashboard(dashboardModel(${JSON.stringify(withPresets())}));
        const wanted = ['editGeneralPreset', 'editPreset', 'resetPreset', 'movePreset', 'newPreset'];
        const clicked = built.buttons.filter((b) => wanted.includes(b.action.action)).map((button) => {
            dashboardAction = null;
            button.view.performClick(null);
            return { title: button.title, action: dashboardAction, expected: button.action };
        });
        return JSON.stringify({ clicked });`));
    assert.deepEqual(out.clicked.map((c) => c.title), ['Festlegen…', 'Bearbeiten…', 'Zurücksetzen', 'Übernehmen', 'Entfernen', 'Entfernen', 'Preset anlegen…']);
    for (const click of out.clicked) assert.deepEqual(click.action, click.expected, click.title);
});

test('Preset-Editor: echte Formularzeilen, vorbelegt, mit freien Zeilen und nur dort einem Zurücksetzen-Knopf', () => {
    const out = JSON.parse(widgets(`
        const repo = { name: 'alpha' };
        const draft = { terminals: ${JSON.stringify(PRESETS.items[0].terminals)}, urls: ['http://a.test', 'http://b.test'] };
        draft.terminals[0].placement = 'panel';
        const built = buildPresetEditor(repo, draft, true, '');
        const rows = (b) => b.rows.map((row) => [ObjC.unwrap(row.popup.titleOfSelectedItem), ObjC.unwrap(row.name.stringValue),
            ObjC.unwrap(row.prompt.stringValue), ObjC.unwrap(row.cwd.stringValue), ObjC.unwrap(row.placement.titleOfSelectedItem)]);
        const eight = buildPresetEditor(repo, { terminals: Array.from({ length: 8 }, (_, i) => ({ name: 'T' + i, type: 'Shell', prompt: '', cwd: '' })), urls: [] }, false, '');
        const many = buildPresetEditor(repo, { terminals: Array.from({ length: 12 }, (_, i) => ({ name: 'T' + i, type: 'Shell', prompt: '', cwd: '' })), urls: [] }, false, '');
        return JSON.stringify({ title: ObjC.unwrap(built.alert.messageText), rows: rows(built), buttons: titles(built.alert),
            fresh: titles(buildPresetEditor(repo, draft, false, 'Hinweis').alert),
            note: ObjC.unwrap(buildPresetEditor(repo, draft, false, 'Hinweis').alert.informativeText),
            urls: ObjC.unwrap(built.urls.stringValue), counts: [built.rows.length, eight.rows.length, many.rows.length],
            popupItems: Array.from({ length: built.rows[0].popup.numberOfItems }, (_, i) => ObjC.unwrap(built.rows[0].popup.itemTitleAtIndex(i))) });`));
    assert.equal(out.title, 'Preset · alpha');
    assert.deepEqual(out.rows.slice(0, 3), [
        ['Eigener Befehl', 'Dev', 'npm run dev', 'frontend', 'Unteres Panel'],
        ['Claude Code', 'Agent', '', '', 'Standard'],
        ['–', '', '', '', 'Standard'],
    ]);
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
        built.rows[1].placement.selectItemWithTitle($('Editor-Tab'));
        fill(built.rows[4], 'Eigener Befehl', '', 'npm test', '');
        built.urls.stringValue = $(' http://a.test ,, http://b.test , ');
        const empty = buildPresetEditor({ name: 'x' }, { terminals: [], urls: [] }, false, '');
        return JSON.stringify({ collected: collectPreset(built), empty: collectPreset(empty) });`));
    assert.deepEqual(out.collected.terminals, [
        { type: 'Codex 2', name: 'Mein Codex', prompt: 'Räum "auf" it\'s', cwd: 'src', placement: 'tabs' },
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

test('Preset-Editor und Rückfrage: der allgemeine Standard sagt, für wen er gilt und was nach dem Zurücksetzen gilt', () => {
    const out = JSON.parse(widgets(`
        const draft = { terminals: [], urls: [] };
        const general = buildPresetEditor(GENERAL_REPO, draft, true, '');
        const own = buildPresetEditor({ name: 'alpha' }, draft, true, '');
        const app = { chooseFromList: () => false };
        const ui = nativeUi(app);
        response = FIRST; ui.confirmResetPreset('Allgemeiner Standard', resetEffect({}, true));
        response = FIRST; ui.confirmResetPreset('alpha', resetEffect({ general: { terminals: [], urls: [] } }, false));
        response = FIRST; ui.confirmResetPreset('alpha');
        return JSON.stringify({ title: ObjC.unwrap(general.alert.messageText), general: ObjC.unwrap(general.alert.informativeText),
            own: ObjC.unwrap(own.alert.informativeText), seen });`, `
        let response;
        const seen = [];
        function scriptedPresent(alert) { seen.push(ObjC.unwrap(alert.informativeText)); return response; }`));
    assert.equal(out.title, 'Preset · Allgemeiner Standard');
    assert.match(out.general, /für jedes Repository, das kein eigenes Preset hat/);
    assert.match(out.own, /^Welche Terminals und Browser-Tabs starten für dieses Repository\?/);
    assert.deepEqual(out.seen, [
        'Danach gelten wieder die eingebauten Standard-Terminals ohne Browser-Tabs.',
        'Danach gilt wieder der allgemeine Standard. Das Repository selbst bleibt unberührt.',
        'Danach starten wieder die Standard-Terminals. Das Repository selbst bleibt unberührt.',        // ohne Angabe wie bisher
    ]);
});

test('Quick-Öffnen-Aufruf an vibecode.py: Pfad und Modus als eigene, gequotete Argumente', () => {
    const out = JSON.parse(jxa(`${library}
const seen = [];
const app = { doShellScript: (command) => { seen.push(command); return '{"message": "ok"}'; } };
function run() {
    makeBackend(app, '/usr/bin/python3', '/c/vibecode.py').folder('quick-open', { path: "/g/My 'Repo'", mode: 'on' });
    return JSON.stringify(seen);
}`));
    assert.deepEqual(out, ["'/usr/bin/python3' '/c/vibecode.py' 'folders' 'quick-open' '--json' '--path=/g/My '\\''Repo'\\''' '--mode=on'"]);
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
    backend.preset('save-general', { data: { terminals: [{ name: 'A', type: 'Shell', prompt: '', cwd: '' }], urls: [] } });
    backend.preset('reset-general');
    return JSON.stringify(seen);
}`));
    const base = "'/usr/bin/python3' '/c/vibecode.py' 'presets'";
    assert.deepEqual(out, [
        `${base} 'save' '--json' '--path=/g/My Repo' '--data={"terminals":[{"name":"A","type":"Shell","prompt":"it'\\''s","cwd":""}],"urls":[]}'`,
        `${base} 'reset' '--json' '--path=/g/a'`,
        `${base} 'move' '--json' '--path=/alt/a' '--to=/neu/a'`,
        `${base} 'save-general' '--json' '--data={"terminals":[{"name":"A","type":"Shell","prompt":"","cwd":""}],"urls":[]}'`,
        `${base} 'reset-general' '--json'`,
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
