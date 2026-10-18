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

function workspace(files, { selected = ['A', 'B'], autoStart = 'true' } = {}) {
    const selection = path.join(files.dir, 'selection.txt');
    const defaults = path.join(files.dir, 'defaults.tsv');
    fs.writeFileSync(selection, selected.join('\n') + '\n');
    fs.writeFileSync(defaults, [
        'A\tShell\texec zsh -l\t',
        'A\tExtra\tnpm test\t',
        'B\tShell\texec zsh -l\t',
    ].join('\n') + '\n');
    jxa(workspaceSource, [selection, files.projects, defaults, files.output, files.saved],
        { AUTO_START_VALUE: autoStart });
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

test('setup offers the same ordered four terminals as the launcher defaults', () => {
    const source = setupSource.replace('function run(argv) {', 'function configureRun(argv) {') + `
function run() { return JSON.stringify(defaultTerminals()); }
`;
    const defaults = JSON.parse(jxa(source, []));
    assert.deepEqual(defaults.map(({ name, type, cwd }) => ({ name, type, cwd })), [
        { name: 'Claude', type: 'Claude Code', cwd: '' },
        { name: 'Codex', type: 'Codex', cwd: '' },
        { name: 'Frontend', type: 'Eigener Befehl', cwd: 'frontend' },
        { name: 'Storybook', type: 'Eigener Befehl', cwd: 'frontend' },
    ]);
    assert.match(defaults[0].command, /exec claude --dangerously-skip-permissions/);
    assert.match(defaults[1].command, /exec codex --sandbox workspace-write --ask-for-approval never/);
    assert.equal(defaults[2].command, 'npm run dev');
    assert.equal(defaults[3].command, 'npm run storybook -- --no-open');
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
    assert.match(terminals[2].command, /codex --sandbox workspace-write --ask-for-approval never -- /);
    assert.match(terminals[3].command, /CODEX_HOME="\$HOME\/\.codex-account2" exec codex --sandbox workspace-write --ask-for-approval never -- /);
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
        [2, ['--sandbox', 'workspace-write', '--ask-for-approval', 'never', '--', '--looks-like-an-option']],
        [3, ['--sandbox', 'workspace-write', '--ask-for-approval', 'never', '--', 'second account']],
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
    assert.ok(result.tasks.tasks.every((task) => task.runOptions.runOn === 'folderOpen'));
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

test('legacy Codex presets use the sandbox while custom commands and prompt text stay unchanged', (t) => {
    const files = fixture(t);
    const prompt = "Explain if command -v codex >/dev/null 2>&1; then exec codex --yolo; and 'quotes'";
    const suffix = ` -- ${quote(prompt)}; else echo 'Codex ist nicht installiert.'; exec zsh -l; fi`;
    const oldCommand = 'if command -v codex >/dev/null 2>&1; then exec codex --yolo' + suffix;
    const newCommand = 'if command -v codex >/dev/null 2>&1; then exec codex --sandbox workspace-write --ask-for-approval never' + suffix;
    const entries = [
        { name: 'Legacy', type: 'Codex', prompt, command: oldCommand, cwd: 'src' },
        { name: 'Custom', type: 'Eigener Befehl', prompt: oldCommand, command: oldCommand, cwd: '' },
        { name: 'Current', type: 'Codex', prompt, command: newCommand, cwd: '' },
        { name: 'No prompt', type: 'Codex', prompt: '', command: "if command -v codex >/dev/null 2>&1; then exec codex --yolo; else echo 'Codex ist nicht installiert.'; exec zsh -l; fi", cwd: '' },
    ];
    const original = JSON.stringify({ version: 1, projects: { [files.a]: entries, [files.b]: [] } });
    fs.writeFileSync(files.saved, original);
    const tasks = workspace(files).tasks.tasks;
    assert.equal(tasks.length, 4);
    assert.equal(tasks[0].command, newCommand);
    assert.equal(tasks[0].options.cwd, `${files.a}/src`);
    assert.equal(tasks[1].command, oldCommand);
    assert.equal(tasks[2].command, newCommand);
    assert.match(tasks[3].command, /codex --sandbox workspace-write --ask-for-approval never;/);
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

test('full launcher creates the ordered four-terminal stack and applies per-repo overrides', (t) => {
    const files = fixture(t);
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
    const defaults = launch().tasks.tasks;
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
    assert.equal(defaults.length, 9);
    assert.deepEqual(defaultProjectTasks.slice(0, 4).map((task) => task.label), [
        'A · Claude', 'A · Codex',
        'A · Frontend', 'A · Storybook',
    ]);
    assert.equal(defaultProjectTasks[2].command, 'npm run dev');
    assert.equal(defaultProjectTasks[2].options.cwd, `${files.a}/frontend`);
    assert.equal(defaultProjectTasks[3].command, 'npm run storybook -- --no-open');
    assert.equal(defaultProjectTasks[3].options.cwd, `${files.a}/frontend`);
    assert.equal(defaultProjectTasks.filter((task) => task.command.includes('exec claude --dangerously-skip-permissions')).length, 2);
    assert.equal(defaultProjectTasks.filter((task) => task.command.includes('exec codex --sandbox workspace-write --ask-for-approval never')).length, 2);
    assert.equal(defaultProjectTasks.filter((task) => task.command.includes('CODEX_HOME="$HOME/.codex-account2"')).length, 0);
    assert.equal(defaultProjectTasks.filter((task) => task.command.includes('exec agy --dangerously-skip-permissions')).length, 0);
    assert.equal(controlTask.type, 'process');
    assert.equal(controlTask.command, '/usr/bin/env');
    assert.deepEqual(controlTask.args, ['python3', path.join(files.dir, 'remote.py'), 'control']);
    assert.equal(controlTask.options.env.VIBECODE_REMOTE_DIR, path.join(files.dir, 'remote'));
    assert.equal(controlTask.runOptions.runOn, 'folderOpen');
    assert.equal(controlTask.presentation.close, true);
    assert.equal(fs.existsSync(path.join(files.dir, 'remote', 'config.json')), false);
    fs.writeFileSync(files.saved, JSON.stringify({ version: 1, projects: { [files.a]: [] } }));
    const tasks = launch().tasks.tasks;
    const projectTasks = tasks.filter((task) => task.label !== 'VibeCode · Wachhalten + Apps');
    assert.equal(tasks.length, 5);
    assert.equal(projectTasks.length, 4);
    assert.ok(projectTasks.every((task) => task.label.startsWith('B · ')));

    // Three selected folders, each with several tasks, must have three colors.
    const c = path.join(files.dir, 'Repo C');
    fs.mkdirSync(c);
    fs.appendFileSync(files.projects, `C\t${c}\n`);
    fs.unlinkSync(files.saved);
    fs.unlinkSync(path.join(files.dir, 'last-selection.txt'));
    const coloredTasks = launch().tasks.tasks;
    assert.equal(coloredTasks.length, 13);
    for (const [project, color] of [
        ['A', 'terminal.ansiBlue'], ['B', 'terminal.ansiGreen'], ['C', 'terminal.ansiMagenta'],
    ]) {
        const group = coloredTasks.filter((task) => task.presentation.group === project);
        assert.equal(group.length, 4);
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
