// Der Herzschlag der Erweiterung für „Tailscale mit VibeCode starten und beenden“ (nur synthetische Pfade, ein Wegwerf-Ordner).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname,
    '../workspaces/vscode-extension/auto-open-tabs/extension.js'), 'utf8');

async function activateWindow({ workspaceFile, trusted = true, folderExists = true, fsApi = fs, remote = false }) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'vibecode-heartbeat-'));
    const folder = path.join(base, 'tailscale-sessions');
    if (folderExists) fs.mkdirSync(folder);
    const timers = [];
    const vscode = {
        commands: { registerCommand: () => ({ dispose() {} }) },
        Uri: { parse: (value) => ({ toString: () => value }) },
        ViewColumn: { Active: 1 },
        env: { remoteName: remote ? 'ssh-remote' : undefined },
        workspace: {
            isTrusted: trusted, workspaceFile,
            getConfiguration: () => ({ get: (_key, fallback) => fallback }),
            onDidGrantWorkspaceTrust: () => ({ dispose() {} }),
        },
        window: { tabGroups: { all: [], onDidChangeTabGroups: () => ({ dispose() {} }) }, showErrorMessage() {} },
        tasks: { fetchTasks: async () => [] },
    };
    const modules = { vscode, 'node:fs': fsApi, 'node:os': os, 'node:path': path, 'node:http': {}, 'node:https': {} };
    const sandbox = {
        module: { exports: {} }, URL, setTimeout, clearTimeout,
        setInterval: (callback, ms) => { timers.push({ callback, ms, cleared: false }); return timers.length - 1; },
        clearInterval: (id) => { if (timers[id]) timers[id].cleared = true; },
        process: { pid: 4242, env: { VIBECODE_REMOTE_DIR: base } },
        require: (name) => modules[name],
    };
    vm.runInNewContext(source, sandbox);
    const context = { subscriptions: [] };
    await sandbox.module.exports.activate(context);
    return { base, folder, file: path.join(folder, '4242.json'), timers, context, exports: sandbox.module.exports };
}

const vibe = { scheme: 'file', fsPath: '/Users/example/.vibe-workspaces/Vibe-Session.code-workspace', path: '/Users/example/.vibe-workspaces/Vibe-Session.code-workspace' };
// Ein SSH-Fenster: lokale Datei mit remoteAuthority, die Adresse trägt je nach VS Code das Remote-Schema.
const vibeRemote = { scheme: 'vscode-remote', fsPath: '/Users/example/.vibe-workspaces/Vibe-Session-SSH-example-host.code-workspace',
    path: '/Users/example/.vibe-workspaces/Vibe-Session-SSH-example-host.code-workspace' };

test('ein VibeCode-Fenster meldet sich sofort und danach alle 15 Sekunden', async () => {
    const window = await activateWindow({ workspaceFile: vibe });
    assert.equal(JSON.parse(fs.readFileSync(window.file, 'utf8')).pid, 4242);
    assert.equal(window.timers.length, 1);
    assert.equal(window.timers[0].ms, 15000);
    const old = new Date(Date.now() - 600000);
    fs.utimesSync(window.file, old, old);                                   // eine alte Meldung …
    window.timers[0].callback();                                            // … wird beim nächsten Takt erneuert
    assert.ok(Date.now() - fs.statSync(window.file).mtimeMs < 5000);
});

test('beim Schließen verschwindet die Meldung, auch über deactivate()', async () => {
    const closed = await activateWindow({ workspaceFile: vibe });
    closed.context.subscriptions.forEach((subscription) => subscription.dispose());
    assert.equal(fs.existsSync(closed.file), false);
    assert.ok(closed.timers[0].cleared);
    const deactivated = await activateWindow({ workspaceFile: vibe });
    deactivated.exports.deactivate();
    assert.equal(fs.existsSync(deactivated.file), false);
    deactivated.exports.deactivate();                                       // zweimal ist harmlos
});

test('auch ein SSH-Fenster meldet sich, egal ob die Workspace-Datei als file: oder vscode-remote: ankommt', async () => {
    for (const workspaceFile of [vibeRemote, { scheme: 'file', fsPath: vibeRemote.fsPath }, { scheme: 'vscode-remote', path: vibeRemote.path }]) {
        const window = await activateWindow({ workspaceFile, remote: true });
        assert.equal(fs.existsSync(window.file), true, JSON.stringify(workspaceFile));
    }
});

test('fremde Fenster melden sich nie: kein VibeCode-Workspace, kein Workspace, ähnlicher Ordnername', async () => {
    for (const workspaceFile of [undefined, { scheme: 'file', fsPath: '/Users/example/projekt/app.code-workspace', path: '/Users/example/projekt/app.code-workspace' },
        { scheme: 'vscode-remote', path: '/home/example/projekt/app.code-workspace' },
        { scheme: 'file', path: '/Users/example/vibe-workspaces/x.code-workspace' }, { scheme: 'file', path: '/Users/example/.vibe-workspaces-alt/x.code-workspace' }]) {
        const window = await activateWindow({ workspaceFile });
        assert.equal(fs.existsSync(window.file), false, JSON.stringify(workspaceFile));
        assert.equal(window.timers.length, 0);
    }
});

test('ohne Ordner (Funktion aus) wird nichts angelegt und nichts gemeldet', async () => {
    const window = await activateWindow({ workspaceFile: vibe, folderExists: false });
    assert.equal(fs.existsSync(window.folder), false);                      // die Erweiterung legt den Ordner nie selbst an
    window.timers[0].callback();
    assert.equal(fs.existsSync(window.folder), false);
});

test('die Meldung kommt vor der Vertrauensfrage und auch aus einem Remote-Fenster (UI-Erweiterung)', async () => {
    const untrusted = await activateWindow({ workspaceFile: vibe, trusted: false });
    assert.equal(fs.existsSync(untrusted.file), true);
    const remote = await activateWindow({ workspaceFile: vibe, remote: true });
    assert.equal(fs.existsSync(remote.file), true);
});

test('ein Schreibfehler wirft nicht und bricht die Erweiterung nicht ab', async () => {
    const broken = Object.assign({}, fs, { writeFileSync() { throw new Error('Platte voll'); } });
    const window = await activateWindow({ workspaceFile: vibe, fsApi: broken });
    window.timers[0].callback();
    assert.equal(fs.existsSync(window.file), false);
});
