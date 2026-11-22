const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const source = fs.readFileSync(path.join(__dirname,
    '../workspaces/vscode-extension/auto-open-tabs/extension.js'), 'utf8');
const labels = ['Frontend', 'Storybook', 'Claude', 'Codex 1', 'Codex 2'];

function extension({ trusted = true, active = [], fail, end, configured = labels, definitions = [], layout = 'panel', locations = {} } = {}) {
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
    const layouts = [];
    const messages = [];
    const settingsUpdates = [];
    const commands = new Map();
    let selectedLayout;
    let selectedTerminals = [];
    let pendingStart = false;
    let parallelStarts = 0;
    const vscode = {
        ConfigurationTarget: { Global: 1 },
        commands: {
            registerCommand: (id, handler) => {
                commands.set(id, handler);
                return { dispose: () => commands.delete(id) };
            },
            executeCommand: async (id, nextLayout) => {
                assert.equal(id, 'vscode.setEditorLayout');
                layouts.push(JSON.parse(JSON.stringify(nextLayout)));
            },
        },
        TaskScope: { Workspace: 2 },
        TerminalLocation: { Panel: 1 },
        ThemeColor: class { constructor(id) { this.id = id; } },
        ThemeIcon: class { constructor(id, color) { this.id = id; this.color = color; } },
        Uri: { parse: value => {
            const parsed = new URL(value);
            return { scheme: parsed.protocol.slice(0, -1), authority: parsed.host, path: decodeURIComponent(parsed.pathname) };
        } },
        workspace: {
            isTrusted: trusted,
            getConfiguration: () => ({
                get: key => ({ autoStartTasks: configured, autoStartTerminals: definitions, terminalLayout: layout,
                    terminalLocations: locations })[key],
                update: async (key, value, target) => {
                    assert.equal(target, 1);
                    if (key === 'terminalLocations') {
                        locations = JSON.parse(JSON.stringify(value));
                        return;
                    }
                    assert.equal(key, 'terminalLayout');
                    settingsUpdates.push(value);
                    layout = value;
                },
            }),
            onDidGrantWorkspaceTrust: subscribe('trust'),
        },
        window: {
            terminals: active.map(name => ({ name })),
            showQuickPick: async (items, options) => options.canPickMany
                ? items.filter(item => selectedTerminals.includes(item.label))
                : items.find(item => item.value === selectedLayout),
            showInformationMessage: message => messages.push(message),
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
        activate: () => sandbox.module.exports.activate(context), started, warnings, errors, created, layouts, messages, settingsUpdates,
        pickLayout: async value => {
            selectedLayout = value;
            await commands.get('vibecodeWorkspace.chooseTerminalLayout')();
        },
        pickLocations: async (names, value) => {
            selectedTerminals = names;
            selectedLayout = value;
            await commands.get('vibecodeWorkspace.chooseTerminalLocations')();
        },
        locations: () => locations,
        closeProjectTerminals: () => { vscode.window.terminals = vscode.window.terminals.filter(terminal => terminal.name === 'Control'); },
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

const layoutDefinitions = [
    { name: 'API · Shell', group: 'API', command: 'echo API' },
    { name: 'API · Tests', group: 'API', command: 'echo tests' },
    { name: 'Web · Shell', group: 'Web', command: 'echo Web' },
    { name: 'API · Local Dev', group: 'API', command: 'echo local' },
    { name: 'Control', command: 'echo control' },
];

test('tab layout stacks projects in separate rows and keeps the control terminal in the panel', async () => {
    const app = extension({ definitions: layoutDefinitions, layout: 'tabs' });
    await app.activate();
    assert.deepEqual(app.layouts, [{ orientation: 1, groups: [{}, {}] }]);
    assert.deepEqual(app.started, layoutDefinitions.map(definition => definition.name));
    assert.deepEqual(app.created.map(({ options }) => options.location.viewColumn ?? options.location), [1, 1, 2, 1, 1]);
    assert.equal(app.created[4].options.location, 1);
    assert.deepEqual(app.errors, []);
});

test('grid puts all terminals for the same project side by side even when definitions are interleaved', async () => {
    const app = extension({ definitions: layoutDefinitions, layout: 'grid' });
    await app.activate();
    assert.deepEqual(app.layouts, [{ orientation: 1, groups: [{ groups: [{}, {}, {}] }, {}] }]);
    assert.deepEqual(app.created.slice(0, 4).map(({ options }) => options.location.viewColumn), [1, 2, 4, 3]);
    assert.equal(app.created[4].options.location, 1);
    assert.deepEqual(app.errors, []);
});

test('one project in grid mode still opens its terminals side by side', async () => {
    const app = extension({ definitions: layoutDefinitions.slice(0, 2), layout: 'grid' });
    await app.activate();
    assert.deepEqual(app.layouts, [{ orientation: 0, groups: [{}, {}] }]);
    assert.deepEqual(app.created.map(({ options }) => options.location.viewColumn), [1, 2]);
});

test('layout picker saves without restarting running sessions and starts immediately once they are closed', async () => {
    const app = extension({ definitions: layoutDefinitions });
    await app.activate();
    await app.pickLayout();
    assert.deepEqual(app.settingsUpdates, []);
    await app.pickLayout('grid');
    assert.deepEqual(app.settingsUpdates, ['grid']);
    assert.deepEqual(app.layouts, []);
    assert.equal(app.created.length, layoutDefinitions.length);
    assert.match(app.messages[0], /beim nächsten Start/);

    app.closeProjectTerminals();
    await app.pickLayout('grid');
    assert.equal(app.layouts.length, 1);
    assert.deepEqual(app.started.slice(layoutDefinitions.length), layoutDefinitions.slice(0, -1).map(({ name }) => name));
});

test('panel splits, shared editor tabs and separate editor panes can coexist across projects', async () => {
    const definitions = [
        ['API', 'Dev', 'panel'], ['API', 'Codex', 'grid'], ['Web', 'Codex', 'grid'],
        ['API', 'Storybook', 'panel'], ['API', 'Shell', 'tabs'], ['API', 'Tests', 'tabs'],
        ['Web', 'Claude', 'grid'], ['Web', 'Dev', 'panel'],
    ].map(([group, name, placement]) => ({
        name: `${group} · ${name}`, group, placement, command: 'echo test', cwd: `/repos/${group}`,
    }));
    const locations = Object.fromEntries(definitions.map(({ name, cwd, placement }) => [JSON.stringify([cwd, name]), placement]));
    const app = extension({ definitions, locations, layout: 'tabs' });
    await app.activate();

    assert.deepEqual(app.layouts, [{ orientation: 1, groups: [{ groups: [{}, {}] }, { groups: [{}, {}] }] }]);
    const terminals = new Map(app.created.map(entry => [entry.options.name, entry]));
    assert.equal(terminals.get('API · Dev').options.location, 1);
    assert.equal(terminals.get('API · Storybook').options.location.parentTerminal, terminals.get('API · Dev').terminal);
    assert.equal(terminals.get('Web · Dev').options.location, 1);
    assert.equal(terminals.get('API · Codex').options.location.viewColumn, 1);
    assert.equal(terminals.get('API · Shell').options.location.viewColumn, 2);
    assert.equal(terminals.get('API · Tests').options.location.viewColumn, 2);
    assert.equal(terminals.get('Web · Codex').options.location.viewColumn, 3);
    assert.equal(terminals.get('Web · Claude').options.location.viewColumn, 4);
});

test('a restored editor terminal does not become the split parent of a panel terminal', async () => {
    const definitions = layoutDefinitions.slice(0, 2);
    const app = extension({
        definitions, active: ['API · Shell'],
        locations: { [JSON.stringify(['', 'API · Shell'])]: 'grid' },
    });
    await app.activate();
    assert.deepEqual(app.layouts, []);
    assert.deepEqual(app.started, ['API · Tests']);
    assert.equal(app.created[0].options.location, 1);
});

test('a preset placement takes precedence over the VS Code preference', async () => {
    const definition = { ...layoutDefinitions[0], placement: 'panel' };
    const locations = { [JSON.stringify(['', definition.name])]: 'grid' };
    const app = extension({ definitions: [definition], layout: 'tabs', locations });
    await app.activate();
    assert.deepEqual(app.layouts, []);
    assert.equal(app.created[0].options.location, 1);
    await app.pickLocations([definition.name], 'tabs');
    assert.deepEqual(app.locations(), locations);
    assert.match(app.messages[0], /Projekt-Presets festgelegt/);
});

test('the location picker saves multiple selections and can restore the default for one terminal', async () => {
    const app = extension({ definitions: layoutDefinitions, layout: 'tabs' });
    const names = ['API · Shell', 'Web · Shell'];
    const keys = names.map(name => JSON.stringify(['', name]));
    await app.activate();
    await app.pickLocations(names);
    assert.deepEqual(app.locations(), {});
    await app.pickLocations(names, 'panel');
    assert.deepEqual(app.locations(), { [keys[0]]: 'panel', [keys[1]]: 'panel' });
    assert.equal(app.created.length, layoutDefinitions.length);
    await app.pickLocations([names[1]], 'default');
    assert.deepEqual(app.locations(), { [keys[0]]: 'panel' });

    app.closeProjectTerminals();
    await app.pickLocations([names[1]], 'grid');
    const restarted = app.created.slice(layoutDefinitions.length);
    assert.equal(restarted.find(({ options }) => options.name === names[0]).options.location, 1);
    assert.equal(restarted.find(({ options }) => options.name === names[1]).options.location.viewColumn, 2);
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
    assert.deepEqual(manifest.extensionKind, ['ui'], 'local installation must also activate in Remote SSH windows');
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

test('SSH terminals retain remote authority and use bash while preserving their split order', async () => {
    const app = extension({ definitions: labels.map(name => ({
        name, group: 'Remote', command: 'exec codex', shellPath: '/bin/bash',
        cwd: 'vscode-remote://ssh-remote+spark/home/user/Repo%20A',
    })) });
    await app.activate();
    assert.deepEqual(app.started, labels);
    for (const { options } of app.created) {
        assert.equal(options.cwd.scheme, 'vscode-remote');
        assert.equal(options.cwd.authority, 'ssh-remote+spark');
        assert.equal(options.cwd.path, '/home/user/Repo A');
        assert.equal(options.shellPath, '/bin/bash');
        assert.match(options.shellArgs[2], /exec '\/bin\/bash' -l$/);
    }
    assert.equal(app.created[1].options.location.parentTerminal, app.created[0].terminal);
    assert.deepEqual(app.warnings, []);
});
