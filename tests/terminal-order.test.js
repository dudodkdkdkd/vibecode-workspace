const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname,
    '../workspaces/vscode-extension/auto-open-tabs/extension.js'), 'utf8');
const labels = ['Frontend', 'Storybook', 'Claude', 'Codex 1', 'Codex 2'];

function extension({ trusted = true, active = [], fail, end, configured = labels } = {}) {
    const events = { start: new Set(), end: new Set(), trust: new Set() };
    const subscribe = name => listener => {
        events[name].add(listener);
        return { dispose: () => events[name].delete(listener) };
    };
    const tasks = labels.map(name => ({ name, scope: 2 }));
    const started = [];
    const warnings = [];
    const errors = [];
    let pendingStart = false;
    let parallelStarts = 0;
    const vscode = {
        TaskScope: { Workspace: 2 },
        workspace: {
            isTrusted: trusted,
            getConfiguration: () => ({ get: key => key === 'autoStartTasks' ? configured : [] }),
            onDidGrantWorkspaceTrust: subscribe('trust'),
        },
        window: {
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
        activate: () => sandbox.module.exports.activate(context), started, warnings, errors,
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
