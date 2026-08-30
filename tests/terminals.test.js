// Run on macOS: node --test tests/terminals.test.js
// Uses real JXA/JSON/workspace generation with scripted answers instead of UI.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const setupSource = fs.readFileSync(path.join(root, 'terminal-setup.js'), 'utf8');
const launcherSource = fs.readFileSync(path.join(root, 'VibeCode Workspace.command'), 'utf8');
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

test('setup stores counts, repeated agents, literal prompts and custom commands per repo', (t) => {
    const files = fixture(t);
    const prompt = "Check 'quotes', $HOME, $(touch nope), `id`, | and\nnew lines";
    const custom = "printf '%s\\n' 'hello | world' | cat";
    assert.equal(setup(files, [
        ['A', 'B'], '4',
        ['Claude Code'], prompt, 'Agent', '',
        ['Claude Code'], '', 'Agent', 'frontend',
        ['Codex'], '--looks-like-an-option', 'Codex', '',
        ['Eigener Befehl'], custom, 'Server', '',
        '0',
    ]), 'saved');
    const saved = JSON.parse(fs.readFileSync(files.output, 'utf8'));
    assert.equal(saved.projects[files.a].length, 4);
    assert.deepEqual(saved.projects[files.b], []);
    const terminals = saved.projects[files.a];
    assert.match(terminals[0].command, /claude --dangerously-skip-permissions/);
    assert.match(terminals[2].command, /codex --sandbox workspace-write --ask-for-approval never -- /);
    assert.equal(terminals[3].command, custom);

    // Execute generated agent commands against a fake CLI, never a real agent.
    const bin = path.join(files.dir, 'bin');
    fs.mkdirSync(bin);
    for (const name of ['claude', 'codex']) {
        fs.writeFileSync(path.join(bin, name), '#!/bin/zsh\nprintf "%s\\0" "$@"\n', { mode: 0o755 });
    }
    for (const [index, flags, expectedPrompt] of [
        [0, ['--dangerously-skip-permissions'], prompt],
        [2, ['--sandbox', 'workspace-write', '--ask-for-approval', 'never'], '--looks-like-an-option'],
    ]) {
        const args = execFileSync('/bin/zsh', ['-c', terminals[index].command], {
            cwd: files.dir, env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
        }).toString().split('\0').slice(0, -1);
        assert.deepEqual(args, [...flags, '--', expectedPrompt]);
    }
    assert.equal(fs.existsSync(path.join(files.dir, 'nope')), false);

    fs.copyFileSync(files.output, files.saved);
    const result = workspace(files);
    assert.equal(result.folders.length, 2);
    assert.deepEqual(result.tasks.tasks.map((task) => task.label),
        ['A · Agent', 'A · Agent (2)', 'A · Codex', 'A · Server']);
    assert.equal(result.tasks.tasks[1].options.cwd, `${files.a}/frontend`);
    assert.equal(result.tasks.tasks[0].command, terminals[0].command);
    assert.ok(result.tasks.tasks.every((task) => task.runOptions.runOn === 'folderOpen'));
    assert.ok(result.tasks.tasks.every((task) => task.icon.color === 'terminal.ansiBlue'));
});

test('editing one repo preserves other settings, including zero terminals', (t) => {
    const files = fixture(t);
    const b = [{ name: 'B task', type: 'Shell', prompt: '', command: 'exec zsh -l', cwd: '' }];
    fs.writeFileSync(files.saved, JSON.stringify({ version: 1, projects: { [files.a]: [], [files.b]: b } }));
    assert.equal(setup(files, [['A'], '0']), 'saved');
    assert.deepEqual(JSON.parse(fs.readFileSync(files.output)).projects,
        { [files.a]: [], [files.b]: b });
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

test('cancelling selection or a later dialog writes nothing', (t) => {
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
        '/tmp', '../outside', '~/outside', 'src']), 'saved');
    assert.equal(JSON.parse(fs.readFileSync(files.output)).projects[files.a][0].cwd, 'src');
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
    for (const contents of ['{broken', '{"version":2,"projects":{}}',
        JSON.stringify({ version: 1, projects: { [files.a]: 'invalid' } })]) {
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
    const source = fs.readFileSync(path.join(root, 'Setup VibeCode Workspace.command'), 'utf8')
        .replace('CONFIG_DIR="$HOME/.config/vibecode-workspace"', `CONFIG_DIR=${quote(configDir)}`);
    fs.writeFileSync(script, source);
    const savedFile = path.join(configDir, 'terminals.json');
    fs.writeFileSync(savedFile, '{"version":1,"projects":{}}');
    execFileSync('/bin/zsh', [script, '--replace', files.a, files.a]);
    execFileSync('/bin/zsh', [script, '--add', files.b]);
    assert.equal(fs.readFileSync(path.join(configDir, 'projects.tsv'), 'utf8').trim().split('\n').length, 2);
    assert.equal(fs.readFileSync(savedFile, 'utf8'), '{"version":1,"projects":{}}');
});

test('full launcher keeps Claude YOLO and Codex sandboxed without approvals, and applies per-repo overrides', (t) => {
    const files = fixture(t);
    const script = path.join(files.dir, 'VibeCode Workspace.command');
    fs.writeFileSync(script, launcherSource);
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
    if [[ "\${1:-}" == "-l" ]]; then
        /usr/bin/osascript "$@"
    elif [[ "\${1:-}" != "-e" ]]; then
        cat "$TMP_DEFAULTS"
    fi
}
source "$1"
`;
    const launch = () => {
        execFileSync('/bin/zsh', ['-c', wrapper, 'test', script]);
        return JSON.parse(fs.readFileSync(path.join(files.dir, 'Vibe-Session.code-workspace')));
    };
    const defaults = launch().tasks.tasks;
    assert.equal(defaults.length, 6);
    assert.equal(defaults.filter((task) => task.command.includes('exec claude --dangerously-skip-permissions')).length, 2);
    assert.equal(defaults.filter((task) => task.command.includes('exec codex --sandbox workspace-write --ask-for-approval never')).length, 2);
    fs.writeFileSync(files.saved, JSON.stringify({ version: 1, projects: { [files.a]: [] } }));
    const tasks = launch().tasks.tasks;
    assert.equal(tasks.length, 3);
    assert.ok(tasks.every((task) => task.label.startsWith('B · ')));

    // Three selected folders, each with several tasks, must have three colors.
    const c = path.join(files.dir, 'Repo C');
    fs.mkdirSync(c);
    fs.appendFileSync(files.projects, `C\t${c}\n`);
    fs.unlinkSync(files.saved);
    fs.unlinkSync(path.join(files.dir, 'last-selection.txt'));
    const coloredTasks = launch().tasks.tasks;
    assert.equal(coloredTasks.length, 9);
    for (const [project, color] of [
        ['A', 'terminal.ansiBlue'], ['B', 'terminal.ansiGreen'], ['C', 'terminal.ansiMagenta'],
    ]) {
        const group = coloredTasks.filter((task) => task.presentation.group === project);
        assert.equal(group.length, 3);
        assert.ok(group.every((task) => task.icon.id === 'terminal' && task.icon.color === color));
    }
});

test('cancelling terminal setup also discards newly selected repository folders', (t) => {
    const files = fixture(t);
    const originalProjects = `A\t${files.a}\n`;
    const originalTerminals = '{"version":1,"projects":{}}';
    fs.writeFileSync(files.projects, originalProjects);
    fs.writeFileSync(files.saved, originalTerminals);
    const script = path.join(files.dir, 'Setup.command');
    const source = fs.readFileSync(path.join(root, 'Setup VibeCode Workspace.command'), 'utf8')
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
