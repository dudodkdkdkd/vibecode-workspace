// Run on macOS: node --test tests/terminals.test.js
// Uses real JXA/JSON/workspace generation with scripted answers instead of UI.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const workspacesRoot = path.join(root, 'workspaces');
const remoteRoot = path.join(root, 'remote');
const setupSource = fs.readFileSync(path.join(workspacesRoot, 'terminal-setup.js'), 'utf8');
const selectionSource = fs.readFileSync(path.join(workspacesRoot, 'project-selection.js'), 'utf8');
const launcherSource = fs.readFileSync(path.join(workspacesRoot, 'VibeCode Workspace.command'), 'utf8');
const workspaceSource = launcherSource.split("<<'JXA'\n")[1].split('\nJXA\n')[0];
const quote = (value) => "'" + value.replace(/'/g, "'\\''") + "'";

function fixture(t) {
    const dir = fs.mkdtempSync('/private/tmp/vibecode-test-');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const a = path.join(dir, "Repo 'A'");
    const b = path.join(dir, 'Repo B');
    fs.mkdirSync(a);
    fs.mkdirSync(b);
    const files = {
        dir, a, b,
        projects: path.join(dir, 'projects.tsv'),
        saved: path.join(dir, 'terminals.json'),
        output: path.join(dir, 'output.json'),
    };
    fs.writeFileSync(files.projects, `A\t${a}\nB\t${b}\n`);
    return files;
}

function jxa(source, args, env = {}) {
    return execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-', ...args], {
        input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
        env: { ...process.env, ...env },
    }).trim();
}

function setup(files, answers) {
    const mock = `
const answers = ${JSON.stringify(answers)};
function next() {
    if (!answers.length) throw new Error('Missing scripted answer');
    const answer = answers.shift();
    if (answer === '__cancel__') {
        const error = new Error('User cancelled');
        error.errorNumber = -128;
        throw error;
    }
    return answer;
}
const testApp = {
    chooseFromList: function () { return next(); },
    displayDialog: function () { return { textReturned: next() }; },
    displayAlert: function () {},
};
`;
    return jxa(mock + setupSource.replace('Application.currentApplication()', 'testApp'),
        [files.projects, files.saved, files.output]);
}

function workspace(files, { selected = ['A', 'B'], autoStart = 'true', all = false, env = {} } = {}) {
    const selection = path.join(files.dir, 'selection.txt');
    const defaults = path.join(files.dir, 'defaults.tsv');
    fs.writeFileSync(selection, selected.join('\n') + '\n');
    fs.writeFileSync(defaults, [
        'A\tShell\texec zsh -l\t',
        'A\tExtra\tnpm test\t',
        'B\tShell\texec zsh -l\t',
    ].join('\n') + '\n');
    const list = path.join(files.dir, 'workspace-list.txt');
    jxa(workspaceSource, [selection, files.projects, defaults, files.output, files.saved, list],
        { AUTO_START_VALUE: autoStart, ...env });
    if (all) return fs.readFileSync(list, 'utf8').trim().split('\n')
        .map(file => ({ file, ...JSON.parse(fs.readFileSync(file, 'utf8')) }));
    return JSON.parse(fs.readFileSync(files.output, 'utf8'));
}

function openedUrls(files, result) {
    return (result ?? workspace(files)).settings['vibecodeWorkspace.autoOpenUrls'] ?? [];
}

function projectSelection(files, { defaults = [], answers }) {
    const namesFile = path.join(files.dir, 'names.txt');
    const defaultsFile = path.join(files.dir, 'defaults.txt');
    fs.writeFileSync(namesFile, 'A\nB\n');
    fs.writeFileSync(defaultsFile, defaults.join('\n'));
    const source = `
const answers = ${JSON.stringify(answers)};
const shown = [];
function showProjectDialog(alert, checkboxes) {
    if (!answers.length) throw new Error('Missing scripted dialog answer');
    shown.push({
        names: checkboxes.map(button => ObjC.unwrap(button.title)),
        selected: checkboxes.map(button => button.state === $.NSControlStateValueOn),
        prompt: ObjC.unwrap(alert.informativeText),
    });
    const answer = answers.shift();
    for (const index of answer.clicks || []) checkboxes[index].performClick(null);
    return answer.cancel ? $.NSAlertSecondButtonReturn : $.NSAlertFirstButtonReturn;
}
` + selectionSource
        .replace('function run(argv) {', 'function selectRun(argv) {')
        .replace('alert.runModal', 'showProjectDialog(alert, checkboxes)')
        .replace('app.activateIgnoringOtherApps(true);', '') + `
function run(argv) {
    const selected = selectRun(argv);
    return JSON.stringify({ selected, shown });
}
`;
    return JSON.parse(jxa(source, [namesFile, defaultsFile]));
}

test('project checkboxes allow independent clicks and preserve the previous selection', (t) => {
    const files = fixture(t);
    const selected = projectSelection(files, { defaults: ['B'], answers: [{ clicks: [0] }] });
    assert.equal(selected.selected, 'A\nB');
    assert.deepEqual(selected.shown[0].names, ['A', 'B']);
    assert.deepEqual(selected.shown[0].selected, [false, true]);

    const toggled = projectSelection(files, { defaults: ['A', 'B'], answers: [{ clicks: [0] }] });
    assert.equal(toggled.selected, 'B');
});

test('project selection requires a checked project and supports cancellation', (t) => {
    const files = fixture(t);
    const retried = projectSelection(files, { answers: [{}, { clicks: [1] }] });
    assert.equal(retried.selected, 'B');
    assert.equal(retried.shown.length, 2);
    assert.match(retried.shown[1].prompt, /mindestens ein Projekt/);
    assert.equal(projectSelection(files, { answers: [{ clicks: [0], cancel: true }] }).selected, '');
});

test('setup offers five terminals with separate Codex profiles', (t) => {
    const source = setupSource.replace('function run(argv) {', 'function configureRun(argv) {') + `
function run() { return JSON.stringify(defaultTerminals()); }
`;
    const defaults = JSON.parse(jxa(source, []));
    assert.deepEqual(defaults.map(({ name, type, cwd }) => ({ name, type, cwd })), [
        { name: 'Frontend', type: 'Eigener Befehl', cwd: 'frontend' },
        { name: 'Storybook', type: 'Eigener Befehl', cwd: 'frontend' },
        { name: 'Claude', type: 'Claude Code', cwd: '' },
        { name: 'Codex 1', type: 'Codex', cwd: '' },
        { name: 'Codex 2', type: 'Codex 2', cwd: '' },
    ]);
    assert.match(defaults[2].command, /exec claude --dangerously-skip-permissions/);
    for (const index of [3, 4]) {
        assert.match(defaults[index].command, /exec codex --dangerously-bypass-approvals-and-sandbox/);
    }
    assert.equal(defaults[1].command, 'npm run storybook -- --no-open');
    assert.equal(defaults[0].command, 'npm run dev');
    const files = fixture(t);
    const bin = path.join(files.dir, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'codex'), '#!/bin/zsh\nprintf "%s" "$CODEX_HOME"\n', { mode: 0o755 });
    for (const [index, profile] of [[3, '.codex'], [4, '.codex-account2']]) {
        assert.equal(execFileSync('/bin/zsh', ['-c', defaults[index].command], {
            env: { ...process.env, PATH: `${bin}:/usr/bin:/bin`, CODEX_HOME: '/wrong-profile' },
        }).toString(), path.join(process.env.HOME, profile));
    }
});

test('terminal setup opens with no repositories preselected', (t) => {
    const files = fixture(t);
    const source = `
let defaultItems;
const testApp = {
    chooseFromList: function (_items, options) {
        defaultItems = options.defaultItems;
        return false;
    },
};
` + setupSource.replace('Application.currentApplication()', 'testApp')
        .replace('function run(argv) {', 'function configureRun(argv) {') + `
function run(argv) {
    configureRun(argv);
    return JSON.stringify(defaultItems);
}
`;
    assert.deepEqual(JSON.parse(jxa(source, [files.projects, files.saved, files.output])), []);
});

test('setup stores counts, repeated agents, literal prompts and custom commands per repo', (t) => {
    const files = fixture(t);
    const prompt = "Check 'quotes', $HOME, $(touch nope), `id`, | and\nnew lines";
    const custom = "printf '%s\\n' 'hello | world' | cat";
    assert.equal(setup(files, [
        ['A', 'B'], '6',
        ['Claude Code'], prompt, 'Agent', '',
        ['Claude Code'], '', 'Agent', 'frontend',
        ['Codex'], '--looks-like-an-option', 'Codex', '',
        ['Codex 2'], 'second account', 'Codex 2', '',
        ['Antigravity'], 'turbo task', 'agy', '',
        ['Eigener Befehl'], custom, 'Server', '',
        'http://localhost:3000, http://localhost:6006',
        '0',
        '',
    ]), 'saved');
    const saved = JSON.parse(fs.readFileSync(files.output, 'utf8'));
    assert.equal(saved.projects[files.a].terminals.length, 6);
    assert.deepEqual(saved.projects[files.a].urls, ['http://localhost:3000', 'http://localhost:6006']);
    assert.deepEqual(saved.projects[files.b], { terminals: [], urls: [] });
    const terminals = saved.projects[files.a].terminals;
    assert.match(terminals[0].command, /claude --dangerously-skip-permissions/);
    assert.match(terminals[2].command, /codex --dangerously-bypass-approvals-and-sandbox -- /);
    assert.match(terminals[3].command, /CODEX_HOME="\$HOME\/\.codex-account2" exec codex --dangerously-bypass-approvals-and-sandbox -- /);
    assert.match(terminals[4].command, /agy --dangerously-skip-permissions --prompt-interactive /);
    assert.equal(terminals[5].command, custom);

    // Execute generated agent commands against a fake CLI, never a real agent.
    const bin = path.join(files.dir, 'bin');
    fs.mkdirSync(bin);
    for (const name of ['claude', 'codex', 'agy']) {
        fs.writeFileSync(path.join(bin, name), '#!/bin/zsh\nprintf "%s\\0" "$@"\n', { mode: 0o755 });
    }
    for (const [index, expectedArgs] of [
        [0, ['--dangerously-skip-permissions', '--', prompt]],
        [2, ['--dangerously-bypass-approvals-and-sandbox', '--', '--looks-like-an-option']],
        [3, ['--dangerously-bypass-approvals-and-sandbox', '--', 'second account']],
        [4, ['--dangerously-skip-permissions', '--prompt-interactive', 'turbo task']],
    ]) {
        const args = execFileSync('/bin/zsh', ['-c', terminals[index].command], {
            cwd: files.dir, env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
        }).toString().split('\0').slice(0, -1);
        assert.deepEqual(args, expectedArgs);
    }
    fs.writeFileSync(path.join(bin, 'codex'), '#!/bin/zsh\nprintf "%s" "$CODEX_HOME"\n', { mode: 0o755 });
    assert.equal(execFileSync('/bin/zsh', ['-c', terminals[3].command], {
        cwd: files.dir, env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
    }).toString(), path.join(process.env.HOME, '.codex-account2'));
    assert.equal(fs.existsSync(path.join(files.dir, 'nope')), false);

    fs.copyFileSync(files.output, files.saved);
    const result = workspace(files);
    assert.equal(result.folders.length, 2);
    assert.deepEqual(result.tasks.tasks.map((task) => task.label),
        ['A · Agent', 'A · Agent (2)', 'A · Codex', 'A · Codex 2', 'A · agy', 'A · Server']);
    assert.equal(result.tasks.tasks[1].options.cwd, `${files.a}/frontend`);
    assert.equal(result.tasks.tasks[0].command, terminals[0].command);
    assert.deepEqual(result.settings['vibecodeWorkspace.autoStartTasks'], result.tasks.tasks.map(task => task.label));
    assert.ok(result.tasks.tasks.every(task => task.runOptions === undefined));
    assert.ok(result.tasks.tasks.every((task) => task.icon.color === 'terminal.ansiBlue'));
    assert.deepEqual(openedUrls(files, result), ['http://localhost:3000', 'http://localhost:6006']);
});

test('editing one repo preserves other settings, including zero terminals', (t) => {
    const files = fixture(t);
    const b = [{ name: 'B task', type: 'Shell', prompt: '', command: 'exec zsh -l', cwd: '' }];
    fs.writeFileSync(files.saved, JSON.stringify({ version: 1, projects: { [files.a]: [], [files.b]: b } }));
    assert.equal(setup(files, [['A'], '0', '']), 'saved');
    assert.deepEqual(JSON.parse(fs.readFileSync(files.output)).projects,
        { [files.a]: { terminals: [], urls: [] }, [files.b]: { terminals: b, urls: [] } });
});

test('browser tabs are configured per repo and deduplicated across selected repos on launch', (t) => {
    const files = fixture(t);
    assert.equal(setup(files, [
        ['A', 'B'], '0', 'http://localhost:5173, http://localhost:6006',
        '0', 'http://localhost:6006, http://localhost:9009',
    ]), 'saved');
    const saved = JSON.parse(fs.readFileSync(files.output, 'utf8'));
    assert.deepEqual(saved.projects[files.a].urls, ['http://localhost:5173', 'http://localhost:6006']);
    assert.deepEqual(saved.projects[files.b].urls, ['http://localhost:6006', 'http://localhost:9009']);

    fs.copyFileSync(files.output, files.saved);
    assert.deepEqual(openedUrls(files),
        ['http://localhost:5173', 'http://localhost:6006', 'http://localhost:9009']);
});

test('saved Codex presets use full access while custom commands and prompt text stay unchanged', (t) => {
    const files = fixture(t);
    const prompt = "Explain if command -v codex >/dev/null 2>&1; then exec codex --yolo; and 'quotes'";
    const suffix = ` -- ${quote(prompt)}; else echo 'Codex ist nicht installiert.'; exec zsh -l; fi`;
    const oldCommand = 'if command -v codex >/dev/null 2>&1; then exec codex --sandbox workspace-write --ask-for-approval never' + suffix;
    const newCommand = 'if command -v codex >/dev/null 2>&1; then exec codex --dangerously-bypass-approvals-and-sandbox' + suffix;
    const entries = [
        { name: 'Legacy', type: 'Codex', prompt, command: oldCommand, cwd: 'src' },
        { name: 'Custom', type: 'Eigener Befehl', prompt: oldCommand, command: oldCommand, cwd: '' },
        { name: 'Current', type: 'Codex', prompt, command: newCommand, cwd: '' },
        { name: 'No prompt', type: 'Codex', prompt: '', command: "if command -v codex >/dev/null 2>&1; then exec codex --yolo; else echo 'Codex ist nicht installiert.'; exec zsh -l; fi", cwd: '' },
        ...['.codex', '.codex-account2'].map((profile, index) => ({
            name: `Profile ${index + 1}`, type: index ? 'Codex 2' : 'Codex', prompt,
            command: oldCommand.replace('then exec', `then CODEX_HOME="$HOME/${profile}" exec`), cwd: '',
        })),
    ];
    const original = JSON.stringify({ version: 1, projects: { [files.a]: entries, [files.b]: [] } });
    fs.writeFileSync(files.saved, original);
    const tasks = workspace(files).tasks.tasks;
    assert.equal(tasks.length, 6);
    assert.equal(tasks[0].command, newCommand);
    assert.equal(tasks[0].options.cwd, `${files.a}/src`);
    assert.equal(tasks[1].command, oldCommand);
    assert.equal(tasks[2].command, newCommand);
    assert.match(tasks[3].command, /codex --dangerously-bypass-approvals-and-sandbox;/);
    for (const [index, profile] of [[4, '.codex'], [5, '.codex-account2']]) {
        assert.equal(tasks[index].command,
            newCommand.replace('then exec', `then CODEX_HOME="$HOME/${profile}" exec`));
    }
    assert.equal(fs.readFileSync(files.saved, 'utf8'), original);
});

test('cancelling the selection, a terminal dialog or the browser-tab dialog writes nothing', (t) => {
    const files = fixture(t);
    const original = JSON.stringify({ version: 1, projects: { [files.b]: [] } });
    fs.writeFileSync(files.saved, original);
    for (const answers of [[false], [['A', 'B'], '0', '__cancel__'], [['A'], '1', false]]) {
        assert.equal(setup(files, answers), 'cancelled');
        assert.equal(fs.existsSync(files.output), false);
        assert.equal(fs.readFileSync(files.saved, 'utf8'), original);
    }
});

test('invalid counts and nonrelative working directories are requested again', (t) => {
    const files = fixture(t);
    assert.equal(setup(files, [['A'], '-1', '1.5', 'invalid', '1', ['Shell'], 'Shell',
        '/tmp', '../outside', '~/outside', 'src', '']), 'saved');
    assert.equal(JSON.parse(fs.readFileSync(files.output)).projects[files.a].terminals[0].cwd, 'src');
});

test('workspace keeps legacy defaults, respects selection and can disable autostart', (t) => {
    const files = fixture(t);
    const result = workspace(files, { selected: ['B'], autoStart: 'false' });
    assert.deepEqual(result.folders, [{ name: 'B', path: files.b }]);
    assert.equal(result.tasks.tasks.length, 1);
    assert.equal(result.tasks.tasks[0].label, 'B · Shell');
    assert.equal(result.tasks.tasks[0].runOptions, undefined);
    assert.equal(result.settings['vibecodeWorkspace.autoStartTasks'], undefined);
});

test('malformed saved configuration fails without replacing existing output', (t) => {
    const files = fixture(t);
    fs.writeFileSync(files.output, 'unchanged');
    for (const contents of ['{broken', '{"version":3,"projects":{}}',
        JSON.stringify({ version: 1, projects: { [files.a]: 'invalid' } }),
        JSON.stringify({ version: 2, projects: { [files.a]: { terminals: [], urls: 'invalid' } } })]) {
        fs.writeFileSync(files.saved, contents);
        assert.throws(() => setup(files, [['A'], '0']));
        assert.equal(fs.readFileSync(files.output, 'utf8'), 'unchanged');
        assert.throws(() => workspace(files));
        assert.equal(fs.readFileSync(files.output, 'utf8'), 'unchanged');
    }
});

test('noninteractive setup preserves saved terminal settings and deduplicates folders', (t) => {
    const files = fixture(t);
    const configDir = path.join(files.dir, 'config');
    fs.mkdirSync(configDir);
    const script = path.join(files.dir, 'Setup.command');
    const source = fs.readFileSync(path.join(workspacesRoot, 'Setup VibeCode Workspace.command'), 'utf8')
        .replace('CONFIG_DIR="$HOME/.config/vibecode-workspace"', `CONFIG_DIR=${quote(configDir)}`);
    fs.writeFileSync(script, source);
    const savedFile = path.join(configDir, 'terminals.json');
    fs.writeFileSync(savedFile, '{"version":1,"projects":{}}');
    execFileSync('/bin/zsh', [script, '--replace', files.a, files.a]);
    execFileSync('/bin/zsh', [script, '--add', files.b]);
    assert.equal(fs.readFileSync(path.join(configDir, 'projects.tsv'), 'utf8').trim().split('\n').length, 2);
    assert.equal(fs.readFileSync(savedFile, 'utf8'), '{"version":1,"projects":{}}');
});

test('launcher refreshes sibling repositories on every run, including renamed folders and worktrees', (t) => {
    const files = fixture(t);
    const script = path.join(files.dir, 'Inventory.command');
    fs.writeFileSync(script, launcherSource.split('\n# Diagnosemodus')[0] + '\ncat "$TMP_CONFIG"\n');
    const lastSelection = path.join(files.dir, 'last-selection.txt');
    fs.writeFileSync(lastSelection, `${files.b}\n`);
    fs.writeFileSync(path.join(files.dir, 'config.local.zsh'), `
CONFIG_DIR=${quote(files.dir)}
SAVED_PROJECTS=${quote(files.projects)}
LAST_SELECTION=${quote(lastSelection)}
WORKSPACE_DIR=${quote(files.dir)}
EDITOR_CMD=/usr/bin/true
`);
    fs.mkdirSync(path.join(files.a, '.git'));
    fs.mkdirSync(path.join(files.b, '.git'));
    const inventory = () => execFileSync('/bin/zsh', [script], { encoding: 'utf8' })
        .trim().split('\n').map(line => line.split('\t'));
    assert.deepEqual(inventory(), [['A', files.a], ['B', files.b]]);

    const renamed = path.join(files.dir, 'Repo renamed');
    fs.renameSync(files.a, renamed);
    const worktree = path.join(files.dir, 'New worktree');
    fs.mkdirSync(worktree);
    fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${files.b}/.git/worktrees/new\n`);
    fs.symlinkSync(files.b, path.join(files.dir, 'Alias B'));
    const nested = path.join(files.dir, 'Not a repository', 'Nested repo', '.git');
    fs.mkdirSync(nested, { recursive: true });
    assert.deepEqual(inventory(), [
        ['B', files.b], ['New worktree', worktree], ['Repo renamed', renamed],
    ]);

    fs.rmSync(worktree, { recursive: true });
    fs.rmSync(files.b, { recursive: true });
    assert.deepEqual(inventory(), [['Repo renamed', renamed]]);
    assert.equal(fs.readFileSync(files.projects, 'utf8'), `A\t${files.a}\nB\t${files.b}\n`);
    assert.equal(fs.readFileSync(lastSelection, 'utf8'), `${files.b}\n`);
});

test('full launcher opens five terminals per project, supports overrides and a global configuration', (t) => {
    const files = fixture(t);
    fs.mkdirSync(path.join(files.a, 'frontend'));
    const script = path.join(files.dir, 'VibeCode Workspace.command');
    fs.writeFileSync(script, launcherSource);
    fs.copyFileSync(path.join(remoteRoot, 'remote.py'), path.join(files.dir, 'remote.py'));
    fs.copyFileSync(path.join(remoteRoot, 'remote.example.json'), path.join(files.dir, 'remote.example.json'));
    fs.writeFileSync(path.join(files.dir, 'config.local.zsh'), `
CONFIG_DIR=${quote(files.dir)}
SAVED_PROJECTS=${quote(files.projects)}
LAST_SELECTION=${quote(path.join(files.dir, 'last-selection.txt'))}
WORKSPACE_DIR=${quote(files.dir)}
EDITOR_CMD=/usr/bin/true
CLOSE_LAUNCHER_TERMINAL=false
`);
    const wrapper = `
osascript() {
    if [[ "\${3:-}" == */project-selection.js ]]; then
        cat "$TMP_DEFAULTS" > "$DEFAULTS_CAPTURE"
        if [[ "\${SELECTION_CANCELLED_VALUE:-false}" == "true" ]]; then
            print -r -- ""
        else
            cat "$TMP_NAMES"
        fi
    elif [[ "\${1:-}" == "-l" ]]; then
        /usr/bin/osascript "$@"
    fi
}
source "$1"
`;
    const defaultsCapture = path.join(files.dir, 'defaults-capture.txt');
    const launch = (cancelled = false) => {
        execFileSync('/bin/zsh', ['-c', wrapper, 'test', script], {
            env: { ...process.env, DEFAULTS_CAPTURE: defaultsCapture,
                SELECTION_CANCELLED_VALUE: String(cancelled) },
        });
        return JSON.parse(fs.readFileSync(path.join(files.dir, 'Vibe-Session.code-workspace')));
    };
    const defaultWorkspace = launch();
    const defaults = defaultWorkspace.tasks.tasks;
    assert.deepEqual(defaultWorkspace.settings['vibecodeWorkspace.autoStartTasks'], defaults.map(task => task.label));
    assert.ok(defaults.every(task => task.runOptions === undefined));
    const splitTerminals = defaultWorkspace.settings['vibecodeWorkspace.autoStartTerminals'];
    assert.equal(defaultWorkspace.settings['python.terminal.activateEnvironment'], false);
    assert.equal(defaultWorkspace.settings['python.terminal.activateEnvInCurrentTerminal'], false);
    assert.deepEqual(splitTerminals.map(terminal => terminal.name), defaults.map(task => task.label));
    assert.deepEqual(splitTerminals.slice(0, 5).map(terminal => terminal.group), ['A', 'A', 'A', 'A', 'A']);
    assert.equal(splitTerminals[0].command, 'npm run dev');
    assert.equal(splitTerminals[0].cwd, `${files.a}/frontend`);
    assert.equal(splitTerminals[0].color, 'terminal.ansiBlue');
    assert.equal(splitTerminals.at(-1).group, undefined);
    assert.deepEqual(splitTerminals.at(-1).args, ['python3', path.join(files.dir, 'remote.py'), 'control']);
    assert.equal(splitTerminals.at(-1).env.VIBECODE_REMOTE_DIR, path.join(files.dir, 'remote'));
    assert.equal(fs.readFileSync(defaultsCapture, 'utf8'), '');
    assert.deepEqual(fs.readFileSync(path.join(files.dir, 'last-selection.txt'), 'utf8').trim().split('\n'),
        [files.a, files.b]);
    launch();
    assert.equal(fs.readFileSync(defaultsCapture, 'utf8'), 'A\nB\n');
    const previousWorkspace = fs.readFileSync(path.join(files.dir, 'Vibe-Session.code-workspace'), 'utf8');
    const previousSelection = fs.readFileSync(path.join(files.dir, 'last-selection.txt'), 'utf8');
    launch(true);
    assert.equal(fs.readFileSync(path.join(files.dir, 'Vibe-Session.code-workspace'), 'utf8'), previousWorkspace);
    assert.equal(fs.readFileSync(path.join(files.dir, 'last-selection.txt'), 'utf8'), previousSelection);
    fs.writeFileSync(path.join(files.dir, 'last-selection.txt'), 'A\n');
    launch();
    assert.equal(fs.readFileSync(defaultsCapture, 'utf8'), 'A\n');
    fs.writeFileSync(path.join(files.dir, 'last-selection.txt'), 'old name\n');
    launch();
    assert.equal(fs.readFileSync(defaultsCapture, 'utf8'), '');
    const defaultProjectTasks = defaults.filter((task) => task.label !== 'VibeCode · Wachhalten + Apps');
    const controlTask = defaults.find((task) => task.label === 'VibeCode · Wachhalten + Apps');
    assert.equal(defaults.length, 11);
    assert.deepEqual(defaultProjectTasks.slice(0, 5).map((task) => task.label), [
        'A · Frontend', 'A · Storybook', 'A · Claude',
        'A · Codex 1', 'A · Codex 2',
    ]);
    assert.equal(defaultProjectTasks[0].command, 'npm run dev');
    assert.equal(defaultProjectTasks[0].options.cwd, `${files.a}/frontend`);
    assert.equal(defaultProjectTasks[1].command, 'npm run storybook -- --no-open');
    assert.equal(defaultProjectTasks[1].options.cwd, `${files.a}/frontend`);
    assert.equal(defaultProjectTasks[5].options.cwd, files.b);
    assert.equal(defaultProjectTasks[6].options.cwd, files.b);
    assert.ok(defaultProjectTasks.every((task) => fs.statSync(task.options.cwd).isDirectory()));
    assert.equal(defaultProjectTasks.filter((task) => task.command.includes('exec claude --dangerously-skip-permissions')).length, 2);
    assert.equal(defaultProjectTasks.filter((task) => task.command.includes('exec codex --dangerously-bypass-approvals-and-sandbox')).length, 4);
    assert.equal(defaultProjectTasks.filter((task) => task.command.includes('CODEX_HOME="$HOME/.codex"')).length, 2);
    assert.equal(defaultProjectTasks.filter((task) => task.command.includes('CODEX_HOME="$HOME/.codex-account2"')).length, 2);
    assert.equal(defaultProjectTasks.filter((task) => task.command.includes('exec agy --dangerously-skip-permissions')).length, 0);
    assert.equal(controlTask.type, 'process');
    assert.equal(controlTask.command, '/usr/bin/env');
    assert.deepEqual(controlTask.args, ['python3', path.join(files.dir, 'remote.py'), 'control']);
    assert.equal(controlTask.options.env.VIBECODE_REMOTE_DIR, path.join(files.dir, 'remote'));
    assert.equal(defaultWorkspace.settings['vibecodeWorkspace.autoStartTasks'].at(-1), controlTask.label);
    assert.equal(controlTask.presentation.close, true);
    assert.equal(fs.existsSync(path.join(files.dir, 'remote', 'config.json')), false);
    fs.writeFileSync(files.saved, JSON.stringify({ version: 1, projects: { [files.a]: [] } }));
    const tasks = launch().tasks.tasks;
    const projectTasks = tasks.filter((task) => task.label !== 'VibeCode · Wachhalten + Apps');
    assert.equal(tasks.length, 6);
    assert.equal(projectTasks.length, 5);
    assert.ok(projectTasks.every((task) => task.label.startsWith('B · ')));

    // The local global setting opens all five even with saved per-project choices.
    fs.writeFileSync(files.saved, JSON.stringify({ version: 2, projects: {
        [files.a]: { terminals: [], urls: ['http://localhost:5173'] },
        [files.b]: { terminals: [{ name: 'Custom', command: 'echo custom', cwd: '' }], urls: [] },
    } }));
    fs.appendFileSync(path.join(files.dir, 'config.local.zsh'), '\nUSE_PROJECT_TERMINALS=false\n');
    const globalWorkspace = launch();
    const globalTasks = globalWorkspace.tasks.tasks;
    assert.equal(globalTasks.length, 11);
    for (const project of ['A', 'B']) {
        const group = globalTasks.filter(task => task.label.startsWith(`${project} · `));
        assert.deepEqual(group.map(task => task.label),
            ['Frontend', 'Storybook', 'Claude', 'Codex 1', 'Codex 2'].map(name => `${project} · ${name}`));
    }
    assert.deepEqual(globalWorkspace.settings['vibecodeWorkspace.autoStartTasks'], globalTasks.map(task => task.label));
    assert.deepEqual(openedUrls(files, globalWorkspace), ['http://localhost:5173']);
    fs.appendFileSync(path.join(files.dir, 'config.local.zsh'), '\nAUTO_START_TERMINALS=false\n');
    const controlOnly = launch();
    assert.deepEqual(controlOnly.settings['vibecodeWorkspace.autoStartTasks'], ['VibeCode · Wachhalten + Apps']);
    assert.deepEqual(controlOnly.settings['vibecodeWorkspace.autoStartTerminals'].map(terminal => terminal.name),
        ['VibeCode · Wachhalten + Apps']);
    fs.appendFileSync(path.join(files.dir, 'config.local.zsh'), '\nAUTO_START_TERMINALS=true\n');

    // Three selected folders, each with several tasks, must have three colors.
    const c = path.join(files.dir, 'Repo C');
    fs.mkdirSync(c);
    fs.appendFileSync(files.projects, `C\t${c}\n`);
    fs.unlinkSync(files.saved);
    fs.unlinkSync(path.join(files.dir, 'last-selection.txt'));
    const coloredTasks = launch().tasks.tasks;
    assert.equal(coloredTasks.length, 16);
    for (const [project, color] of [
        ['A', 'terminal.ansiBlue'], ['B', 'terminal.ansiGreen'], ['C', 'terminal.ansiMagenta'],
    ]) {
        const group = coloredTasks.filter((task) => task.label.startsWith(`${project} · `));
        assert.equal(group.length, 5);
        assert.ok(group.every((task) => task.icon.id === 'terminal' && task.icon.color === color));
    }
    fs.writeFileSync(files.projects, `A renamed\t${files.a}\nB\t${files.b}\nC\t${c}\n`);
    launch();
    assert.equal(fs.readFileSync(defaultsCapture, 'utf8'), 'A renamed\nB\nC\n');
});

test('cancelling terminal setup also discards newly selected repository folders', (t) => {
    const files = fixture(t);
    const originalProjects = `A\t${files.a}\n`;
    const originalTerminals = '{"version":1,"projects":{}}';
    fs.writeFileSync(files.projects, originalProjects);
    fs.writeFileSync(files.saved, originalTerminals);
    const script = path.join(files.dir, 'Setup.command');
    const source = fs.readFileSync(path.join(workspacesRoot, 'Setup VibeCode Workspace.command'), 'utf8')
        .replace('CONFIG_DIR="$HOME/.config/vibecode-workspace"', `CONFIG_DIR=${quote(files.dir)}`);
    fs.writeFileSync(script, source);
    const wrapper = `
osascript() {
    if [[ "\${1:-}" == "-l" ]]; then
        print -r -- cancelled
    elif (( $# == 0 )); then
        print -r -- ${quote(files.b)}
    else
        print -r -- Hinzufügen
    fi
}
source "$1"
`;
    execFileSync('/bin/zsh', ['-c', wrapper, 'test', script]);
    assert.equal(fs.readFileSync(files.projects, 'utf8'), originalProjects);
    assert.equal(fs.readFileSync(files.saved, 'utf8'), originalTerminals);
});

test('remote setup registers SSH projects without a local checkout and retains them when adding local folders', t => {
    const files = fixture(t);
    const script = path.join(files.dir, 'Setup.command');
    fs.writeFileSync(script, fs.readFileSync(path.join(workspacesRoot, 'Setup VibeCode Workspace.command'), 'utf8')
        .replace('CONFIG_DIR="$HOME/.config/vibecode-workspace"', `CONFIG_DIR=${quote(files.dir)}`)
        // Expected CLI validation failures must not open real error alerts.
        .replace('/usr/bin/osascript - "$exit_code"', 'osascript - "$exit_code"'));
    fs.copyFileSync(path.join(workspacesRoot, 'remote-project.js'), path.join(files.dir, 'remote-project.js'));
    const remotePath = "/home/user/Repo 'ä' #1%";
    const uri = 'vscode-remote://ssh-remote+spark' + remotePath.split('/').map(encodeURIComponent).join('/');
    const wrapper = `osascript() { if [[ "\${1:-}" == "-l" ]]; then /usr/bin/osascript "$@"; fi; }; source "$1" "\${@:2}"`;
    const run = (...args) => execFileSync('/bin/zsh', ['-c', wrapper, 'test', script, ...args], { stdio: 'pipe', encoding: 'utf8' });
    run('--add-remote', 'spark', remotePath);
    run('--add-remote', 'spark', remotePath);
    run('--add', files.b);
    const projects = fs.readFileSync(files.projects, 'utf8');
    assert.ok(projects.includes(`Repo 'ä' #1% [SSH: spark]\t${uri}\n`));
    assert.equal(projects.trim().split('\n').length, 3);
    for (const [host, remote] of [['-oProxyCommand=oops', '/repo'], ['spark:22', '/repo'],
        ['spark', '~/repo'], ['spark', ''], ['spark', '/repo/../outside'], ['spark', '/repo\nother']]) {
        assert.throws(() => run('--add-remote', host, remote));
        assert.equal(fs.readFileSync(files.projects, 'utf8'), projects);
    }
    assert.match(run('--check'), /Ordner: 3/);
});

test('remote project and terminal dialogs support cancellation and remote shell defaults', t => {
    const files = fixture(t);
    const source = fs.readFileSync(path.join(workspacesRoot, 'remote-project.js'), 'utf8');
    const mock = `const answers = ["spark", "/home/user/app", ""];\nconst testApp = {
        displayDialog: () => ({ textReturned: answers.shift() }), displayAlert: () => {} };\n`;
    assert.equal(jxa(mock + source.replace('Application.currentApplication()', 'testApp'), []),
        'app [SSH: spark]\tvscode-remote://ssh-remote+spark/home/user/app');
    const cancel = `const testApp = { displayDialog: () => { const e = new Error(); e.errorNumber = -128; throw e; } };\n`;
    assert.equal(jxa(cancel + source.replace('Application.currentApplication()', 'testApp'), []), '');
    const uri = 'vscode-remote://ssh-remote+spark/home/user/app';
    fs.writeFileSync(files.projects, `Remote\t${uri}\n`);
    assert.equal(setup(files, [['Remote'], '2', ['Shell'], 'Shell', '', ['Codex'], '', 'Codex', '', '']), 'saved');
    const saved = JSON.parse(fs.readFileSync(files.output, 'utf8')).projects[uri];
    assert.equal(saved.terminals[0].command, 'exec bash -l');
    assert.match(saved.terminals[1].command, /exec bash -l; fi$/);
    assert.match(saved.terminals[1].command, /CODEX_HOME="\$HOME\/\.codex" exec codex/);
});

test('cancelling remote registration or its terminal setup preserves the saved project and terminal files', t => {
    const files = fixture(t);
    const originalProjects = fs.readFileSync(files.projects, 'utf8');
    const originalTerminals = '{"version":2,"projects":{}}';
    fs.writeFileSync(files.saved, originalTerminals);
    const script = path.join(files.dir, 'Setup.command');
    fs.writeFileSync(script, fs.readFileSync(path.join(workspacesRoot, 'Setup VibeCode Workspace.command'), 'utf8')
        .replace('CONFIG_DIR="$HOME/.config/vibecode-workspace"', `CONFIG_DIR=${quote(files.dir)}`));
    const wrapper = `
osascript() {
    if [[ "\${3:-}" == */remote-project.js ]]; then
        [[ "$CANCEL_REGISTRATION" == true ]] || print -r -- $'Remote\tvscode-remote://ssh-remote+spark/home/user/app'
        return 0
    elif [[ "\${1:-}" == "-l" ]]; then print -r -- cancelled; fi
}
source "$1" --add-remote
`;
    for (const cancelled of ['true', 'false']) {
        execFileSync('/bin/zsh', ['-c', wrapper, 'test', script], {
            env: { ...process.env, CANCEL_REGISTRATION: cancelled },
        });
        assert.equal(fs.readFileSync(files.projects, 'utf8'), originalProjects);
        assert.equal(fs.readFileSync(files.saved, 'utf8'), originalTerminals);
    }
});

test('workspaces group remote repos by SSH host with matching Git folders and terminal URIs', t => {
    const files = fixture(t);
    const a = 'vscode-remote://ssh-remote+spark/home/user/Repo%20A%23';
    const b = 'vscode-remote://ssh-remote+spark/home/user/B';
    const c = 'vscode-remote://ssh-remote+user@other/home/user/C';
    fs.appendFileSync(files.projects, `Remote A\t${a}\nRemote B\t${b}\nRemote C\t${c}\n`);
    const entry = { terminals: [{ name: 'Codex', command: 'exec codex', cwd: 'src #1' }], urls: ['http://localhost:5173'] };
    fs.writeFileSync(files.saved, JSON.stringify({ version: 2, projects: { [a]: entry, [b]: entry, [c]: entry } }));
    const results = workspace(files, { selected: ['A', 'Remote A', 'Remote B', 'Remote C'], all: true,
        env: { CONTROL_TERMINAL_ENABLED_VALUE: 'true', CONTROL_SCRIPT_VALUE: '/local/remote.py' } });
    assert.equal(results.length, 3);
    const [local, spark, other] = results;
    assert.equal(local.remoteAuthority, undefined);
    assert.deepEqual(local.folders, [{ name: 'A', path: files.a }]);
    assert.equal(local.settings['vibecodeWorkspace.autoOpenUrls'], undefined);
    assert.equal(local.tasks.tasks.at(-1).label, 'VibeCode · Wachhalten + Apps');
    assert.equal(spark.remoteAuthority, 'ssh-remote+spark');
    assert.deepEqual(spark.folders, [{ name: 'Remote A', uri: a }, { name: 'Remote B', uri: b }]);
    assert.deepEqual(spark.tasks.tasks.map(task => task.options.cwd), ['/home/user/Repo A#/src #1', '/home/user/B/src #1']);
    assert.deepEqual(spark.settings['vibecodeWorkspace.autoStartTerminals'].map(terminal => terminal.cwd),
        [a + '/src%20%231', b + '/src%20%231']);
    assert.ok(spark.settings['vibecodeWorkspace.autoStartTerminals'].every(terminal => terminal.shellPath === '/bin/bash'));
    assert.ok(spark.tasks.tasks.every(task => task.options.shell.executable === '/bin/bash'));
    assert.deepEqual(spark.settings['vibecodeWorkspace.autoOpenUrls'], ['http://localhost:5173']);
    assert.equal(other.remoteAuthority, 'ssh-remote+user@other');
    assert.deepEqual(other.folders, [{ name: 'Remote C', uri: c }]);
    assert.deepEqual(other.settings['vibecodeWorkspace.autoOpenUrls'], ['http://localhost:5173']);
    assert.ok(other.file.endsWith('-SSH-user%40other.code-workspace'));
    const remoteOnly = workspace(files, { selected: ['Remote A'], autoStart: 'false', all: true,
        env: { CONTROL_TERMINAL_ENABLED_VALUE: 'true' } });
    assert.equal(remoteOnly.length, 1);
    assert.equal(remoteOnly[0].tasks.tasks.length, 1);
    assert.equal(remoteOnly[0].settings['vibecodeWorkspace.autoStartTerminals'], undefined);
    assert.equal(remoteOnly[0].settings['vibecodeWorkspace.autoStartTasks'], undefined);
});

test('full launcher keeps offline remote entries, installs Remote SSH and opens each workspace through LaunchServices', t => {
    const files = fixture(t);
    const remote = 'vscode-remote://ssh-remote+spark/not/on/this/mac';
    fs.appendFileSync(files.projects, `Remote\t${remote}\n`);
    const cli = path.join(files.dir, 'Editor.app/Contents/Resources/app/bin/code');
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    fs.writeFileSync(cli, '#!/bin/zsh\nprintf "%s\\n" "$@" >> "$EDITOR_CAPTURE"\n', { mode: 0o755 });
    const script = path.join(files.dir, 'Launch.command');
    fs.writeFileSync(script, launcherSource);
    fs.writeFileSync(path.join(files.dir, 'config.local.zsh'), `
CONFIG_DIR=${quote(files.dir)}
SAVED_PROJECTS=${quote(files.projects)}
LAST_SELECTION=${quote(path.join(files.dir, 'last-selection.txt'))}
WORKSPACE_DIR=${quote(files.dir)}
EDITOR_CMD=${quote(cli)}
OPEN_CONTROL_TERMINAL=false
CLOSE_LAUNCHER_TERMINAL=false
`);
    const wrapper = `
osascript() {
    if [[ "\${3:-}" == */project-selection.js ]]; then cat "$TMP_NAMES"
    elif [[ "\${1:-}" == "-l" ]]; then /usr/bin/osascript "$@"; fi
}
open() { printf '%s\\n' "$@" >> "$OPEN_CAPTURE"; }
source "$1"
`;
    const capture = path.join(files.dir, 'open.txt');
    const editorCapture = path.join(files.dir, 'editor.txt');
    execFileSync('/bin/zsh', ['-c', wrapper, 'test', script], {
        env: { ...process.env, OPEN_CAPTURE: capture, EDITOR_CAPTURE: editorCapture },
    });
    assert.deepEqual(fs.readFileSync(editorCapture, 'utf8').trim().split('\n'),
        ['--list-extensions', '--install-extension', 'ms-vscode-remote.remote-ssh']);
    assert.deepEqual(fs.readFileSync(capture, 'utf8').trim().split('\n'), [
        '-a', path.join(files.dir, 'Editor.app'), path.join(files.dir, 'Vibe-Session.code-workspace'),
        path.join(files.dir, 'Vibe-Session-SSH-spark.code-workspace'),
    ]);
    const result = JSON.parse(fs.readFileSync(path.join(files.dir, 'Vibe-Session-SSH-spark.code-workspace')));
    assert.equal(result.tasks.tasks.length, 5);
    assert.equal(result.tasks.tasks[0].options.cwd, '/not/on/this/mac/frontend');
    assert.equal(result.settings['vibecodeWorkspace.autoStartTerminals'][0].cwd, remote + '/frontend');
    assert.ok(result.tasks.tasks.every(task => !task.command.includes('exec zsh')));
    assert.ok(fs.readFileSync(path.join(files.dir, 'last-selection.txt'), 'utf8').includes(remote));
});

test('malformed remote URIs and escaping terminal directories leave previous workspaces intact', t => {
    const files = fixture(t);
    fs.writeFileSync(files.output, 'unchanged');
    for (const remote of ['vscode-remote://ssh-remote+spark/home/user/%0Aapp',
        'vscode-remote://ssh-remote+spark/home/user/../app', 'vscode-remote://ssh-remote+spark/home/user/app?query']) {
        fs.writeFileSync(files.projects, `A\t${files.a}\nRemote\t${remote}\n`);
        assert.throws(() => workspace(files, { selected: ['A', 'Remote'], all: true }));
        assert.equal(fs.readFileSync(files.output, 'utf8'), 'unchanged');
    }
    const remote = 'vscode-remote://ssh-remote+spark/home/user/app';
    fs.writeFileSync(files.projects, `A\t${files.a}\nRemote\t${remote}\n`);
    fs.writeFileSync(files.saved, JSON.stringify({ version: 2, projects: { [remote]: {
        terminals: [{ name: 'Shell', command: 'exec bash -l', cwd: '../outside' }], urls: [],
    } } }));
    assert.throws(() => workspace(files, { selected: ['A', 'Remote'], all: true }));
    assert.equal(fs.readFileSync(files.output, 'utf8'), 'unchanged');
});

test('remote host dialogs accept a server home root and cancel without saving', t => {
    const files = fixture(t);
    const source = fs.readFileSync(path.join(workspacesRoot, 'remote-project.js'), 'utf8');
    const mock = `const answers = ['spark', '']; const testApp = {
        displayDialog: () => ({ textReturned: answers.shift() }), displayAlert: () => {} };\n`;
    assert.equal(jxa(mock + source.replaceAll('Application.currentApplication()', 'testApp'), ['--host']), 'spark\t~');
    assert.equal(jxa(source, ['--host', 'user@spark', '~/projects/']), 'user@spark\t~/projects');
    const cancel = `const testApp = { displayDialog: () => { const e = new Error(); e.errorNumber = -128; throw e; } };\n`;
    assert.equal(jxa(cancel + source.replaceAll('Application.currentApplication()', 'testApp'), ['--host']), '');
    const script = path.join(files.dir, 'Setup.command');
    fs.writeFileSync(script, fs.readFileSync(path.join(workspacesRoot, 'Setup VibeCode Workspace.command'), 'utf8')
        .replace('CONFIG_DIR="$HOME/.config/vibecode-workspace"', `CONFIG_DIR=${quote(files.dir)}`));
    const previous = fs.readFileSync(files.projects, 'utf8');
    execFileSync('/bin/zsh', ['-c', 'osascript() { print -r -- ""; }; source "$1" --add-remote-host', 'test', script]);
    assert.equal(fs.existsSync(path.join(files.dir, 'remote-hosts.json')), false);
    assert.equal(fs.readFileSync(files.projects, 'utf8'), previous);
});

test('host registration, recursive launcher discovery and terminal setup share dynamic repo identities', t => {
    const files = fixture(t);
    const server = path.join(files.dir, 'server');
    const repo = path.join(server, 'group', "Remote 'ä' #");
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    const bin = path.join(files.dir, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'ssh'), `#!/bin/sh
for arg do remote_command="$arg"; done
exec /bin/sh -c "$remote_command"
`, { mode: 0o755 });
    for (const name of ['remote-project.js', 'remote-hosts.py']) {
        fs.copyFileSync(path.join(workspacesRoot, name), path.join(files.dir, name));
    }
    const script = path.join(files.dir, 'Setup.command');
    fs.writeFileSync(script, fs.readFileSync(path.join(workspacesRoot, 'Setup VibeCode Workspace.command'), 'utf8')
        .replace('CONFIG_DIR="$HOME/.config/vibecode-workspace"', `CONFIG_DIR=${quote(files.dir)}`));
    const wrapper = `
python3() { PATH="$TEST_BIN:$PATH" command python3 "$@"; }
osascript() { if [[ "\${1:-}" == "-l" ]]; then /usr/bin/osascript "$@"; fi; }
source "$1" "\${@:2}"
`;
    const env = { ...process.env, TEST_BIN: bin };
    const previousProjects = fs.readFileSync(files.projects, 'utf8');
    execFileSync('/bin/zsh', ['-c', wrapper, 'test', script, '--add-remote-host', 'spark', server], { env });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(files.dir, 'remote-hosts.json'))),
        { version: 1, hosts: [{ host: 'spark', root: server }] });
    assert.equal(fs.readFileSync(files.projects, 'utf8'), previousProjects);

    const inventoryScript = path.join(files.dir, 'Inventory.command');
    fs.writeFileSync(inventoryScript, launcherSource.split('\n# Diagnosemodus')[0] + '\ncat "$TMP_CONFIG"\n');
    fs.writeFileSync(path.join(files.dir, 'config.local.zsh'), `
CONFIG_DIR=${quote(files.dir)}
SAVED_PROJECTS=${quote(files.projects)}
WORKSPACE_DIR=${quote(files.dir)}
EDITOR_CMD=/usr/bin/true
export PATH=${quote(bin)}:"$PATH"
`);
    const uri = 'vscode-remote://ssh-remote+spark' + repo.split('/').map(encodeURIComponent).join('/');
    const name = "Remote 'ä' # [SSH: spark]";
    const inventory = () => execFileSync('/bin/zsh', [inventoryScript], { encoding: 'utf8', stdio: 'pipe' });
    assert.ok(inventory().includes(`${name}\t${uri}\n`));
    const newRepo = path.join(server, 'another', 'new-repo');
    fs.mkdirSync(path.join(newRepo, '.git'), { recursive: true });
    assert.ok(inventory().includes('new-repo [SSH: spark]'));
    fs.writeFileSync(path.join(bin, 'ssh'), '#!/bin/sh\nexit 255\n', { mode: 0o755 });
    assert.ok(inventory().includes(`${name}\t${uri}\n`), 'offline hosts must preserve cached choices');

    // The diagnostics path must not attempt any SSH connection.
    const called = path.join(files.dir, 'ssh-must-not-run');
    fs.writeFileSync(path.join(bin, 'ssh'), `#!/bin/sh\ntouch ${quote(called)}\nexit 255\n`, { mode: 0o755 });
    execFileSync('/bin/zsh', [inventoryScript, '--check']);
    assert.equal(fs.existsSync(called), false);

    // An offline terminal setup uses the snapshot, without persisting its repos
    // into projects.tsv. Explicit and discovered entries must deduplicate.
    fs.appendFileSync(files.projects, `Manual name\t${uri}\n`);
    const fixedProjects = fs.readFileSync(files.projects, 'utf8');
    fs.writeFileSync(path.join(files.dir, 'terminal-setup.js'), `
const answers = [['Manual name'], '0', ''];
const testApp = { chooseFromList: () => answers.shift(),
    displayDialog: () => ({ textReturned: answers.shift() }), displayAlert() {} };
` + setupSource.replace('Application.currentApplication()', 'testApp'));
    execFileSync('/bin/zsh', ['-c', wrapper, 'test', script, '--terminals'], { env });
    assert.equal(fs.readFileSync(files.projects, 'utf8'), fixedProjects);
    assert.deepEqual(JSON.parse(fs.readFileSync(files.saved)).projects[uri], { terminals: [], urls: [] });
    // Removing a repo on the host removes it from the next successful scan.
    fs.writeFileSync(path.join(bin, 'ssh'), '#!/bin/sh\nfor arg do remote_command="$arg"; done\nexec /bin/sh -c "$remote_command"\n', { mode: 0o755 });
    fs.rmSync(newRepo, { recursive: true });
    assert.ok(!inventory().includes('new-repo [SSH: spark]'));

    // A host alone is sufficient; no manual/local project entries are required.
    fs.writeFileSync(files.projects, '');
    const wizard = path.join(files.dir, 'terminal-setup.js');
    fs.writeFileSync(wizard, fs.readFileSync(wizard, 'utf8').replace("[['Manual name'], '0', '']", `${JSON.stringify([[name], '0', ''])}`));
    execFileSync('/bin/zsh', ['-c', wrapper, 'test', script, '--terminals'], { env, stdio: 'pipe' });
    assert.equal(fs.readFileSync(files.projects, 'utf8'), '');
    assert.deepEqual(JSON.parse(fs.readFileSync(files.saved)).projects[uri], { terminals: [], urls: [] });

    // Corrupt discovery data must abort setup before its normalizer can drop
    // previously saved remote terminal settings.
    const previousTerminals = fs.readFileSync(files.saved, 'utf8');
    fs.writeFileSync(path.join(files.dir, 'remote-repositories.json'), '{broken');
    fs.writeFileSync(script, fs.readFileSync(script, 'utf8')
        .replace('/usr/bin/osascript - "$exit_code"', 'osascript - "$exit_code"'));
    assert.throws(() => execFileSync('/bin/zsh', ['-c', wrapper, 'test', script, '--terminals'], { env, stdio: 'pipe' }));
    assert.equal(fs.readFileSync(files.projects, 'utf8'), '');
    assert.equal(fs.readFileSync(files.saved, 'utf8'), previousTerminals);
});

test('guided remote setup routes the CLI and setup menu to the same assistant and handles cancellation', t => {
    const files = fixture(t);
    const script = path.join(files.dir, 'Setup.command');
    fs.writeFileSync(script, fs.readFileSync(path.join(workspacesRoot, 'Setup VibeCode Workspace.command'), 'utf8')
        .replace('CONFIG_DIR="$HOME/.config/vibecode-workspace"', `CONFIG_DIR=${quote(files.dir)}`));
    fs.writeFileSync(path.join(files.dir, 'ssh-setup.py'), `
import json, os, sys
with open(os.environ['ASSISTANT_CAPTURE'], 'w') as handle:
    json.dump(sys.argv[1:], handle)
raise SystemExit(int(os.environ.get('ASSISTANT_EXIT', '0')))
`);
    const previous = fs.readFileSync(files.projects, 'utf8');
    const capture = path.join(files.dir, 'assistant.json');
    const notices = path.join(files.dir, 'notices.txt');
    const wrapper = `
osascript() {
    if [[ "\${1:-}" == "-e" ]]; then print -r -- notice >> "$NOTICE_CAPTURE"
    else print -r -- 'Remote-Verbindung einrichten'; fi
}
source "$1" "\${@:2}"
`;
    for (const args of [[], ['--connect-remote']]) {
        execFileSync('/bin/zsh', ['-c', wrapper, 'test', script, ...args], {
            env: { ...process.env, ASSISTANT_CAPTURE: capture, NOTICE_CAPTURE: notices },
        });
        assert.deepEqual(JSON.parse(fs.readFileSync(capture)), [files.dir]);
        assert.equal(fs.readFileSync(files.projects, 'utf8'), previous);
    }
    const completedNotices = fs.readFileSync(notices, 'utf8');
    execFileSync('/bin/zsh', ['-c', wrapper, 'test', script, '--connect-remote'], {
        env: { ...process.env, ASSISTANT_CAPTURE: capture, NOTICE_CAPTURE: notices, ASSISTANT_EXIT: '130' },
    });
    assert.equal(fs.readFileSync(notices, 'utf8'), completedNotices, 'cancellation must not announce success');
});
