// Run on macOS: node --test tests/launcher-projects.test.js
// Real launcher script in a temp dir; only `osascript` dialogs are intercepted and logged.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
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

// ------------------------------------------------------------------ --summary und SSH-Hosts

function withHosts(files) {
    // Ein falsches remote-hosts.py meldet, ob und wie die Host-Suche aufgerufen wurde.
    files.argsFile = path.join(files.dir, 'hosts-args.txt');
    fs.writeFileSync(path.join(files.dir, 'remote-hosts.json'),
        '{"version": 1, "hosts": [{"host": "spark", "root": "~/p"}]}');
    fs.writeFileSync(path.join(files.dir, 'remote-hosts.py'), `import pathlib, sys
pathlib.Path(sys.argv[0]).with_name('hosts-args.txt').write_text(' '.join(sys.argv[3:]))   # argv: Skript, discover, Konfigordner, Flags …
print('repo [SSH: spark]\\tvscode-remote://ssh-remote+spark/home/example/repo')
`);
    return files;
}

const summary = (files) => JSON.parse(launch(files, '--summary').stdout);

test('--summary: eine Statuszeile mit Anzahl, auch im Singular und ohne Projekte', (t) => {
    const files = fixture(t);
    assert.deepEqual(summary(files), { text: '2 Projekte eingerichtet', level: 'ok' });
    fs.writeFileSync(path.join(files.dir, 'projects.tsv'), `A\t${files.a}\n`);
    assert.deepEqual(summary(files), { text: '1 Projekt eingerichtet', level: 'ok' });
    fs.writeFileSync(path.join(files.dir, 'projects.tsv'), `A\t${path.join(files.dir, 'weg')}\n`);
    assert.deepEqual(summary(files), { text: 'Keine Projekte gefunden: Repository-Ordner einrichten', level: 'warn' });
    assert.ok(!fs.existsSync(files.workspace));                       // reine Auskunft: nichts wird gestartet
});

test('--summary zählt Remote-Repositories mit', (t) => {
    const files = withHosts(fixture(t));
    assert.deepEqual(summary(files), { text: '3 Projekte eingerichtet (davon 1 per SSH)', level: 'ok' });
});

test('Auskünfte befragen nie SSH-Hosts, ein normaler Start schon', (t) => {
    const files = withHosts(fixture(t));
    for (const flag of ['--summary', '--list-projects', '--check']) {
        fs.rmSync(files.argsFile, { force: true });
        assert.equal(launch(files, flag).status, 0, flag);
        assert.equal(fs.readFileSync(files.argsFile, 'utf8'), '--cached', flag);   // nur der Cache
    }
    fs.rmSync(files.argsFile, { force: true });
    assert.equal(launch(files, '--project', 'A').status, 0);
    assert.equal(fs.readFileSync(files.argsFile, 'utf8'), '');                      // live suchen
});

// ------------------------------------------------------------------ lokale Suchordner

function withSearchFolder(files, folders) {
    fs.copyFileSync(path.join(root, 'workspaces', 'local-folders.py'), path.join(files.dir, 'local-folders.py'));
    files.search = path.join(files.dir, 'search');
    for (const name of ['x', 'y']) fs.mkdirSync(path.join(files.search, name, '.git'), { recursive: true });
    fs.mkdirSync(path.join(files.search, 'node_modules', 'pkg', '.git'), { recursive: true });
    fs.writeFileSync(path.join(files.dir, 'search-folders.json'),
        JSON.stringify({ version: 1, folders: (folders || [files.search]).map((folder) => ({ path: folder })) }));
    return files;
}

test('Suchordner: Repositories darin erscheinen in der Projektliste, Abhängigkeitsordner nicht', (t) => {
    const files = withSearchFolder(fixture(t));
    const result = launch(files, '--list-projects');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split('\n'), ['A', 'B', 'x', 'y']);
    assert.deepEqual(summary(files), { text: '4 Projekte eingerichtet', level: 'ok' });
});

test('Suchordner: ein Projekt daraus lässt sich per --project starten', (t) => {
    const files = withSearchFolder(fixture(t));
    assert.equal(launch(files, '--project', 'y').status, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(files.workspace, 'utf8')).folders.map((f) => f.path),
        [path.join(files.search, 'y')]);
});

test('Suchordner: ein fehlender Ordner wird übersprungen, ein kaputtes File bricht den Start nicht', (t) => {
    const files = withSearchFolder(fixture(t), [path.join(os.tmpdir(), 'vibecode-gibt-es-nicht')]);
    assert.deepEqual(launch(files, '--list-projects').stdout.trim().split('\n'), ['A', 'B']);
    fs.writeFileSync(path.join(files.dir, 'search-folders.json'), '{kaputt');
    const broken = launch(files, '--list-projects');
    assert.equal(broken.status, 0);
    assert.deepEqual(broken.stdout.trim().split('\n'), ['A', 'B']);                // eingetragene Projekte bleiben
    assert.match(broken.stderr, /Suchordner konnten nicht gelesen werden/);
});

test('Suchordner: ohne search-folders.json ändert sich nichts', (t) => {
    const files = fixture(t);
    fs.copyFileSync(path.join(root, 'workspaces', 'local-folders.py'), path.join(files.dir, 'local-folders.py'));
    assert.equal(launch(files, '--list-projects').stdout, 'A\nB\n');
});

// ------------------------------------------------------------------ Presets pro Repository

function savePreset(files, repo, preset) {
    fs.writeFileSync(path.join(files.dir, 'preset.json'), JSON.stringify(preset));
    const result = spawnSync('/usr/bin/osascript', ['-l', 'JavaScript', path.join(root, 'workspaces', 'presets.js'),
        path.join(root, 'workspaces'), 'save', files.dir, repo, path.join(files.dir, 'preset.json')], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
}

// VS Code nennt jedes Terminal "<Projekt> · <Name>"; die Tests vergleichen den Namen aus dem Preset.
const terminalsOf = (files, group) => JSON.parse(fs.readFileSync(files.workspace, 'utf8'))
    .settings['vibecodeWorkspace.autoStartTerminals'].filter((terminal) => terminal.group === group)
    .map((terminal) => Object.assign({}, terminal, { name: terminal.name.replace(`${group} · `, '') }));

test('--list-paths gibt Name und Pfad genau so aus, wie der Launcher sie nachschlägt', (t) => {
    const files = fixture(t);
    const result = launch(files, '--list-paths');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `A\t${files.a}\nB\t${files.b}\n`);
});

test('Presets: der echte Launcher startet die Terminals und Tabs aus einem gespeicherten Preset', (t) => {
    const files = fixture(t);
    fs.mkdirSync(path.join(files.a, 'frontend'));
    // Ohne Preset gelten die fünf Standard-Terminals.
    assert.equal(launch(files, '--project', 'A').status, 0);
    assert.deepEqual(terminalsOf(files, 'A').map((terminal) => terminal.name),
        ['Frontend', 'Storybook', 'Claude', 'Codex 1', 'Codex 2']);

    savePreset(files, files.a, {
        terminals: [{ name: 'Dev', type: 'Eigener Befehl', prompt: 'npm run dev', cwd: 'frontend' },
            { name: 'Agent', type: 'Claude Code', prompt: 'Räum "auf"', cwd: '' }],
        urls: ['http://localhost:5173'],
    });
    assert.equal(launch(files, '--project', 'A').status, 0);
    const terminals = terminalsOf(files, 'A');
    assert.deepEqual(terminals.map((terminal) => terminal.name), ['Dev', 'Agent']);
    assert.equal(terminals[0].command, 'npm run dev');
    assert.equal(terminals[0].cwd, `${files.a}/frontend`);
    assert.equal(terminals[1].cwd, files.a);
    assert.ok(terminals[1].command.includes("exec claude --dangerously-skip-permissions -- 'Räum \"auf\"'"));
    assert.deepEqual(JSON.parse(fs.readFileSync(files.workspace, 'utf8')).settings['vibecodeWorkspace.autoOpenUrls'],
        ['http://localhost:5173']);
});

test('Presets: ein anderes Repository behält seine Standard-Terminals', (t) => {
    const files = fixture(t);
    savePreset(files, files.a, { terminals: [{ name: 'Nur eins', type: 'Shell', prompt: '', cwd: '' }], urls: [] });
    assert.equal(launch(files, '--project', 'A', '--project', 'B').status, 0);
    assert.deepEqual(terminalsOf(files, 'A').map((terminal) => terminal.name), ['Nur eins']);
    assert.equal(terminalsOf(files, 'B').length, 5);
});

test('Presets: ein zurückgesetztes Preset bringt die Standard-Terminals zurück', (t) => {
    const files = fixture(t);
    savePreset(files, files.a, { terminals: [{ name: 'Nur eins', type: 'Shell', prompt: '', cwd: '' }], urls: [] });
    spawnSync('/usr/bin/osascript', ['-l', 'JavaScript', path.join(root, 'workspaces', 'presets.js'),
        path.join(root, 'workspaces'), 'reset', files.dir, files.a], { encoding: 'utf8' });
    assert.equal(launch(files, '--project', 'A').status, 0);
    assert.equal(terminalsOf(files, 'A').length, 5);
});

test('Allgemeiner Standard: der echte Launcher nutzt ihn für Repositories ohne Preset, ein eigenes Preset gewinnt, Zurücksetzen bringt die fünf zurück', (t) => {
    const files = fixture(t);
    fs.mkdirSync(path.join(files.a, 'frontend'));                       // B hat keinen frontend-Ordner
    const presetsJs = (...args) => spawnSync('/usr/bin/osascript', ['-l', 'JavaScript', path.join(root, 'workspaces', 'presets.js'),
        path.join(root, 'workspaces'), ...args], { encoding: 'utf8' });
    fs.writeFileSync(path.join(files.dir, 'general.json'), JSON.stringify({
        terminals: [{ name: 'Dev', type: 'Eigener Befehl', prompt: 'npm run dev', cwd: 'frontend' },
            { name: 'Agent', type: 'Claude Code', prompt: '', cwd: '' }],
        urls: ['http://localhost:3000'],
    }));
    const saved = presetsJs('save-general', files.dir, path.join(files.dir, 'general.json'));
    assert.equal(saved.status, 0, saved.stderr);

    assert.equal(launch(files, '--project', 'A', '--project', 'B').status, 0);
    assert.deepEqual(terminalsOf(files, 'A').map((terminal) => [terminal.name, terminal.cwd]),
        [['Dev', `${files.a}/frontend`], ['Agent', files.a]]);
    assert.deepEqual(terminalsOf(files, 'B').map((terminal) => [terminal.name, terminal.cwd]),
        [['Dev', files.b], ['Agent', files.b]]);                         // kein frontend-Ordner: Start im Repository-Ordner
    assert.deepEqual(JSON.parse(fs.readFileSync(files.workspace, 'utf8')).settings['vibecodeWorkspace.autoOpenUrls'],
        ['http://localhost:3000']);

    savePreset(files, files.a, { terminals: [{ name: 'Nur eins', type: 'Shell', prompt: '', cwd: '' }], urls: [] });
    assert.equal(launch(files, '--project', 'A', '--project', 'B').status, 0);
    assert.deepEqual(terminalsOf(files, 'A').map((terminal) => terminal.name), ['Nur eins']);
    assert.deepEqual(terminalsOf(files, 'B').map((terminal) => terminal.name), ['Dev', 'Agent']);

    assert.equal(presetsJs('reset-general', files.dir).status, 0);
    assert.equal(launch(files, '--project', 'B').status, 0);
    assert.deepEqual(terminalsOf(files, 'B').map((terminal) => terminal.name),
        ['Frontend', 'Storybook', 'Claude', 'Codex 1', 'Codex 2']);
});

// ------------------------------------------------------------------ Local Dev (--local-dev)

// Wie im Repository: local-dev/ liegt neben workspaces/, das Skript und seine Konfiguration in workspaces/.
function withLocalDevModule(files) {
    const workspaces = path.join(files.dir, 'workspaces');
    fs.mkdirSync(workspaces);
    fs.renameSync(files.script, path.join(workspaces, 'VibeCode Workspace.command'));
    fs.renameSync(path.join(files.dir, 'config.local.zsh'), path.join(workspaces, 'config.local.zsh'));
    files.script = path.join(workspaces, 'VibeCode Workspace.command');
    fs.mkdirSync(path.join(files.dir, 'local-dev'));
    fs.writeFileSync(path.join(files.dir, 'local-dev', 'launcher.zsh'), '#!/bin/zsh\n');
    return fs.realpathSync(path.join(files.dir, 'local-dev', 'launcher.zsh'));
}

test('Local Dev: ohne das Modul startet der Workspace trotzdem und der Launcher sagt, warum es fehlt', (t) => {
    const files = fixture(t);
    const result = launch(files, '--project', 'A', '--local-dev', 'ollama', 'qwen:7b', 'opencode');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /Local Dev ist nicht installiert/);
    assert.ok(!terminalsOf(files, 'A').some((terminal) => terminal.name.endsWith('Local Dev')));
    assert.equal(terminalsOf(files, 'A').length, 5);                                // die normalen Terminals sind unberührt
});

test('Local Dev: der echte Launcher startet es als letztes Terminal des ersten Repositories, mit allem vorgegeben', (t) => {
    const files = fixture(t);
    const script = withLocalDevModule(files);
    const result = launch(files, '--project', 'B', '--project', 'A', '--local-dev', 'ollama', 'qwen:7b', 'opencode');
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /Local Dev ist nicht installiert/);
    const terminals = JSON.parse(fs.readFileSync(files.workspace, 'utf8')).settings['vibecodeWorkspace.autoStartTerminals'];
    const local = terminals.filter((terminal) => terminal.name.endsWith('Local Dev'));
    assert.equal(local.length, 1);
    assert.deepEqual([local[0].name, local[0].group, local[0].type, local[0].command, local[0].args],
        ['B · Local Dev', 'B', 'process', '/bin/zsh', [script, 'start']]);             // das erste ausgewählte Repository
    assert.equal(local[0].cwd, files.b);
    assert.deepEqual(local[0].env, { LOCAL_DEV_PROVIDER: 'ollama', LOCAL_DEV_MODEL: 'qwen:7b',
        LOCAL_DEV_FRAMEWORK: 'opencode', LOCAL_DEV_REPOSITORY_PATH: files.b });
    assert.deepEqual(terminalsOf(files, 'B').map((terminal) => terminal.name).slice(-2), ['Codex 2', 'Local Dev']);
    assert.equal(terminalsOf(files, 'A').length, 5);                                // A bekommt kein zweites
    // Ohne das Flag gibt es nichts davon, und --project allein fasst "zuletzt gewählt" weiter nicht an.
    assert.equal(launch(files, '--project', 'A').status, 0);
    assert.ok(!terminalsOf(files, 'A').some((terminal) => terminal.name.endsWith('Local Dev')));
});

test('Local Dev: --local-dev ohne drei Werte ist ein Fehler und startet nichts', (t) => {
    const files = fixture(t);
    for (const args of [['--local-dev'], ['--local-dev', 'ollama'], ['--local-dev', 'ollama', 'qwen:7b'],
        ['--local-dev', 'ollama', '', 'opencode']]) {
        const result = launch(files, '--project', 'A', ...args);
        assert.equal(result.status, 2, args.join(' '));
        assert.match(result.stderr, /--local-dev braucht Anbieter, Modell und CLI/);
    }
    assert.ok(!fs.existsSync(files.workspace));
});

