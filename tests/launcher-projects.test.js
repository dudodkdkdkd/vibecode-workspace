// Run on macOS: node --test tests/launcher-projects.test.js
// Real launcher script in a temp dir; only `osascript` dialogs are intercepted and logged.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const launcherSource = fs.readFileSync(path.join(root, 'workspaces', 'VibeCode Workspace.command'), 'utf8');
const quote = (value) => "'" + value.replace(/'/g, "'\\''") + "'";

function fixture(t) {
    const dir = fs.mkdtempSync('/private/tmp/vibecode-test-');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const a = path.join(dir, 'Repo A');
    const b = path.join(dir, 'Repo B');
    fs.mkdirSync(a);
    fs.mkdirSync(b);
    const files = {
        dir, a, b,
        script: path.join(dir, 'VibeCode Workspace.command'),
        workspace: path.join(dir, 'Vibe-Session.code-workspace'),
        last: path.join(dir, 'last-selection.txt'),
        log: path.join(dir, 'osascript.log'),
    };
    fs.writeFileSync(path.join(dir, 'projects.tsv'), `A\t${a}\nB\t${b}\n`);
    fs.writeFileSync(files.script, launcherSource);
    fs.writeFileSync(path.join(dir, 'config.local.zsh'), `
CONFIG_DIR=${quote(dir)}
SAVED_PROJECTS=${quote(path.join(dir, 'projects.tsv'))}
LAST_SELECTION=${quote(files.last)}
WORKSPACE_DIR=${quote(dir)}
EDITOR_CMD=/usr/bin/true
CLOSE_LAUNCHER_TERMINAL=false
`);
    fs.writeFileSync(files.last, `${b}\n`);
    return files;
}

const wrapper = `
osascript() {
    print -r -- "\${(j: | :)@}" >> "$OSA_LOG"
    if [[ "\${3:-}" == */project-selection.js ]]; then
        print -r -- DIALOG >> "$OSA_LOG"
        print -r -- A
    elif [[ "\${1:-}" == "-l" ]]; then
        /usr/bin/osascript "$@"
    fi
}
source "$1" "\${@:2}"
`;

function launch(files, ...flags) {
    return spawnSync('/bin/zsh', ['-c', wrapper, 'test', files.script, ...flags],
        { encoding: 'utf8', env: { ...process.env, OSA_LOG: files.log } });
}

const log = (files) => (fs.existsSync(files.log) ? fs.readFileSync(files.log, 'utf8') : '');
const folders = (files) => JSON.parse(fs.readFileSync(files.workspace, 'utf8')).folders.map((f) => f.path);

test('--list-projects prints the names the launcher shows and has no side effects', (t) => {
    const files = fixture(t);
    const result = launch(files, '--list-projects');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'A\nB\n');
    assert.ok(!fs.existsSync(files.workspace));
    assert.equal(log(files), '');
});

test('--list-projects includes cached remote projects without connecting or changing the cache', (t) => {
    const files = fixture(t);
    fs.copyFileSync(path.join(root, 'workspaces', 'remote-hosts.py'), path.join(files.dir, 'remote-hosts.py'));
    fs.writeFileSync(path.join(files.dir, 'remote-hosts.json'), JSON.stringify({
        version: 1, hosts: [{ host: 'offline', root: '/repos' }],
    }));
    const cacheFile = path.join(files.dir, 'remote-repositories.json');
    const cache = JSON.stringify({
        version: 1, hosts: { offline: { root: '/repos', paths: ['/repos/Remote Repo'] } },
    });
    fs.writeFileSync(cacheFile, cache);
    const connected = path.join(files.dir, 'ssh-called');
    const ssh = path.join(files.dir, 'ssh');
    fs.writeFileSync(ssh, `#!/bin/sh\n/usr/bin/touch ${quote(connected)}\nexit 1\n`, { mode: 0o755 });
    fs.appendFileSync(path.join(files.dir, 'config.local.zsh'), `export PATH=${quote(files.dir)}:$PATH\n`);

    const result = launch(files, '--list-projects');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split('\n'), ['A', 'B', 'Remote Repo [SSH: offline]']);
    assert.ok(!fs.existsSync(connected), 'listing projects must not open an SSH connection');
    assert.equal(fs.readFileSync(cacheFile, 'utf8'), cache);
    assert.equal(fs.readFileSync(files.last, 'utf8'), `${files.b}\n`);
    assert.ok(!fs.existsSync(files.workspace));
    assert.equal(log(files), '');
});

test('--project opens exactly those projects without the selection dialog', (t) => {
    const files = fixture(t);
    const result = launch(files, '--project', 'B');
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!log(files).includes('DIALOG'));
    assert.deepEqual(folders(files), [files.b]);
    // A saved workspace has its own configuration; "last used" belongs to the dialog.
    assert.equal(fs.readFileSync(files.last, 'utf8'), `${files.b}\n`);

    assert.equal(launch(files, '--project', 'B', '--project', 'A').status, 0);
    assert.deepEqual(folders(files).sort(), [files.a, files.b].sort());
});

test('a project that no longer exists is reported, the rest still opens', (t) => {
    const files = fixture(t);
    const result = launch(files, '--project', 'A', '--project', "ghost 'x'");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /Projekte nicht gefunden: ghost 'x'/);
    assert.deepEqual(folders(files), [files.a]);
    const notification = log(files).split('\n').find((line) => line.includes('display notification'));
    assert.ok(notification && notification.endsWith("ghost 'x'"), notification);
});

test('only missing projects: alert, non-zero exit and no workspace is written', (t) => {
    const files = fixture(t);
    const result = launch(files, '--project', 'ghost');
    assert.equal(result.status, 1);
    assert.match(log(files), /display alert "Projekte nicht gefunden"[^\n]*\| ghost$/m);
    assert.ok(!fs.existsSync(files.workspace));
});

test('--project without a name is a usage error', (t) => {
    const files = fixture(t);
    assert.equal(launch(files, '--project').status, 2);
    assert.ok(!fs.existsSync(files.workspace));
});

test('without flags the selection dialog still runs and stores the last selection', (t) => {
    const files = fixture(t);
    const result = launch(files);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(log(files).includes('DIALOG'));
    assert.deepEqual(folders(files), [files.a]);
    assert.equal(fs.readFileSync(files.last, 'utf8'), `${files.a}\n`);
});
