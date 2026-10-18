const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const source = fs.readFileSync(path.join(__dirname,
    '../workspaces/vscode-extension/auto-open-tabs/extension.js'), 'utf8');
const labels = ['Frontend', 'Storybook', 'Claude', 'Codex 1', 'Codex 2'];

function extension({ trusted = true, active = [], fail, end, configured = labels, definitions = [] } = {}) {
    const events = { start: new Set(), end: new Set(), trust: new Set() };
    const subscribe = name => listener => {
        events[name].add(listener);
        return { dispose: () => events[name].delete(listener) };
    };
    const tasks = labels.map(name => ({ name, scope: 2 }));
    const started = [];
    const warnings = [];
    const errors = [];
    const created = [];
    let pendingStart = false;
    let parallelStarts = 0;
    const vscode = {
        TaskScope: { Workspace: 2 },
        TerminalLocation: { Panel: 1 },
        ThemeColor: class { constructor(id) { this.id = id; } },
        ThemeIcon: class { constructor(id, color) { this.id = id; this.color = color; } },
        workspace: {
            isTrusted: trusted,
            getConfiguration: () => ({ get: key => key === 'autoStartTasks' ? configured
                : key === 'autoStartTerminals' ? definitions : [] }),
            onDidGrantWorkspaceTrust: subscribe('trust'),
        },
        window: {
            terminals: active.map(name => ({ name })),
            createTerminal: options => {
                if (pendingStart) parallelStarts++;
                started.push(options.name);
                if (options.name === fail) throw new Error('Could not create terminal');
                assert.ok(!options.location.parentTerminal?.opened,
                    'new split groups must be queued before their parent has opened');
                pendingStart = true;
                const terminal = {
                    name: options.name,
                    processId: new Promise(resolve => setImmediate(() => {
                        pendingStart = false;
                        terminal.opened = true;
                        resolve(123);
                    })),
                    sendText: () => { throw new Error('commands must start directly, not be typed into agent sessions'); },
                    show: preserveFocus => { terminal.preserveFocus = preserveFocus; },
                    dispose: () => { terminal.disposed = true; },
                };
                vscode.window.terminals.push(terminal);
                created.push({ options, terminal });
                return terminal;
            },
            showWarningMessage: message => warnings.push(message),
            showErrorMessage: message => errors.push(message),
        },
        tasks: {
            // A repository task with the same name must never replace a workspace task.
            fetchTasks: async () => [{ name: 'Frontend', scope: {} }, ...tasks.toReversed()],
            taskExecutions: tasks.filter(task => active.includes(task.name)).map(task => ({ task })),
            onDidStartTaskProcess: subscribe('start'),
            onDidEndTask: subscribe('end'),
            executeTask: async task => {
                if (pendingStart) parallelStarts++;
                assert.equal(task.scope, 2);
                started.push(task.name);
                if (task.name === fail) throw new Error('Could not create terminal');
                const execution = { task };
                pendingStart = true;
                // executeTask resolves first; the terminal process starts later.
                setImmediate(() => {
                    pendingStart = false;
                    for (const listener of events[task.name === end ? 'end' : 'start']) {
                        listener({ execution });
                    }
                });
                return execution;
            },
        },
    };
    const context = { subscriptions: [] };
    const sandbox = {
        module: { exports: {} }, URL, setTimeout, clearTimeout,
        require: name => name === 'vscode' ? vscode : require(name),
    };
    vm.runInNewContext(source, sandbox);
    return {
        activate: () => sandbox.module.exports.activate(context), started, warnings, errors, created,
        parallelStarts: () => parallelStarts,
        subscriptions: () => events.start.size + events.end.size,
        grantTrust: async () => {
            vscode.workspace.isTrusted = true;
            for (const listener of events.trust) await listener();
        },
    };
}

test('terminals start in configured order after each process starts, without waiting for server exit', async () => {
    const app = extension();
    await app.activate();
    assert.deepEqual(app.started, labels);
    assert.equal(app.parallelStarts(), 0);
    assert.equal(app.subscriptions(), 0);
    assert.deepEqual(app.errors, []);
    assert.deepEqual(app.warnings, []);
});

test('failed or immediately ended tasks do not block the remaining terminals', async () => {
    const app = extension({ fail: 'Frontend', end: 'Storybook' });
    await app.activate();
    assert.deepEqual(app.started, labels);
    assert.equal(app.parallelStarts(), 0);
    assert.equal(app.subscriptions(), 0);
    assert.equal(app.warnings.length, 1);
    assert.match(app.warnings[0], /Frontend/);
    assert.deepEqual(app.errors, []);
});

test('startup waits for workspace trust and skips tasks that are already running', async () => {
    const app = extension({ trusted: false, active: ['Frontend', 'Storybook'] });
    await app.activate();
    assert.deepEqual(app.started, []);
    await app.grantTrust();
    assert.deepEqual(app.started, ['Claude', 'Codex 1', 'Codex 2']);
    assert.equal(app.parallelStarts(), 0);
});

test('duplicate or missing task labels do not duplicate or halt startup', async () => {
    const app = extension({ configured: ['Frontend', 'Missing', 'Frontend', 'Claude'] });
    await app.activate();
    assert.deepEqual(app.started, ['Frontend', 'Claude']);
    assert.equal(app.warnings.length, 1);
    assert.match(app.warnings[0], /Missing/);
    assert.equal(app.parallelStarts(), 0);
});

test('project terminals split beside the previous terminal in the requested order', async () => {
    const definitions = ['A', 'B'].flatMap(group => labels.map(name => ({
        name: `${group} · ${name}`, group, command: `echo ${name}`, cwd: `/repos/${group}`,
        env: { PROJECT: group }, color: 'terminal.ansiBlue', type: 'shell',
    })));
    definitions.push({ name: 'Control', command: 'echo control', type: 'shell' });
    const app = extension({ definitions });
    await app.activate();
    assert.deepEqual(app.started, definitions.map(definition => definition.name));
    for (let index = 0; index < app.created.length; index++) {
        const { options, terminal } = app.created[index];
        if (index === 0 || index === 5 || index === 10) assert.equal(options.location, 1);
        else assert.equal(options.location.parentTerminal, app.created[index - 1].terminal);
        assert.equal(options.shellPath, '/bin/zsh');
        assert.deepEqual(Array.from(options.shellArgs.slice(0, 2)), ['-l', '-c']);
        assert.ok(options.shellArgs[2].includes(definitions[index].command));
        assert.equal(terminal.preserveFocus, true);
        assert.equal(options.cwd, definitions[index].cwd);
        assert.equal(options.env, definitions[index].env);
    }
    assert.equal(app.created[0].options.iconPath.color.id, 'terminal.ansiBlue');
    assert.equal(app.created[0].options.color.id, 'terminal.ansiBlue');
    assert.deepEqual(app.warnings, []);
});

test('split startup preserves running sessions and waits for workspace trust', async () => {
    const definitions = labels.map(name => ({ name, group: 'A', command: 'echo test' }));
    const app = extension({ definitions, trusted: false, active: ['Frontend', 'Storybook'] });
    await app.activate();
    assert.deepEqual(app.started, []);
    await app.grantTrust();
    assert.deepEqual(app.started, ['Claude', 'Codex 1', 'Codex 2']);
    assert.equal(app.created[0].options.location.parentTerminal.name, 'Storybook');
    assert.equal(app.created[1].options.location.parentTerminal, app.created[0].terminal);
});

test('split startup continues after a failed terminal and quotes process arguments literally', async (t) => {
    const directory = fs.mkdtempSync('/private/tmp/vibecode-args-');
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const marker = path.join(directory, 'must-not-exist');
    const literal = `quotes ' and $(touch ${marker}) and\nnew line`;
    const app = extension({ fail: 'Broken', definitions: [
        { name: 'Broken', command: 'echo broken', group: 'A' },
        { name: 'Next', command: 'echo next', group: 'A' },
        { name: 'Process', type: 'process', command: '/usr/bin/printf', args: ['%s', literal], close: true },
    ] });
    await app.activate();
    assert.deepEqual(app.started, ['Broken', 'Next', 'Process']);
    assert.equal(app.created[0].options.location, 1);
    const processCommand = app.created[1].options.shellArgs[2];
    assert.equal(execFileSync('/bin/zsh', ['-c', processCommand], { encoding: 'utf8' }), literal);
    assert.equal(fs.existsSync(marker), false);
    assert.equal(app.warnings.length, 1);
});

test('extension installer registers a complete VSIX through the selected editor CLI', (t) => {
    const directory = fs.mkdtempSync('/private/tmp/vibecode-install-');
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const editor = path.join(directory, 'Editor CLI');
    const argsFile = path.join(directory, 'args.txt');
    const archive = path.join(directory, 'captured.vsix');
    fs.writeFileSync(editor, `#!/bin/zsh
printf '%s\\n' "$@" > "$ARGS_CAPTURE"
/bin/cp "$2" "$VSIX_CAPTURE"
exit "\${INSTALL_EXIT_CODE:-0}"
`, { mode: 0o755 });
    const installer = path.resolve(__dirname, '../workspaces/vscode-extension/auto-open-tabs/install.zsh');
    const env = { ...process.env, ARGS_CAPTURE: argsFile, VSIX_CAPTURE: archive };
    execFileSync('/bin/zsh', [installer, editor], { env });
    const args = fs.readFileSync(argsFile, 'utf8').trim().split('\n');
    assert.equal(args[0], '--install-extension');
    assert.equal(args[2], '--force');
    assert.equal(fs.existsSync(args[1]), false, 'temporary package must be removed');
    const member = name => execFileSync('/usr/bin/unzip', ['-p', archive, name], { encoding: 'utf8' });
    const manifest = JSON.parse(member('extension/package.json'));
    assert.equal(member('extension/extension.js'), source);
    assert.match(member('\\[Content_Types\\].xml'), /application\/json/);
    const identity = member('extension.vsixmanifest');
    assert.ok(identity.includes(`Id="${manifest.name}" Version="${manifest.version}" Publisher="${manifest.publisher}"`));
    assert.match(identity, /Microsoft.VisualStudio.Code.Manifest.*extension\/package.json/);
    assert.throws(() => execFileSync('/bin/zsh', [installer, editor], {
        env: { ...env, INSTALL_EXIT_CODE: '17' },
    }), { status: 17 });
    const failedArgs = fs.readFileSync(argsFile, 'utf8').trim().split('\n');
    assert.equal(fs.existsSync(failedArgs[1]), false, 'failed installation must remove its temporary package');
});
