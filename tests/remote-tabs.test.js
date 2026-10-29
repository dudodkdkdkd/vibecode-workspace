const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const source = fs.readFileSync(path.join(__dirname,
    '../workspaces/vscode-extension/auto-open-tabs/extension.js'), 'utf8');

async function preview({ remote = true, urls, forwardError, responseDelay = 0, dispose = false }) {
    const panels = [], forwarded = [], requested = [];
    const vscode = {
        Uri: { parse: value => ({ toString: () => value }) },
        ViewColumn: { Active: 1 },
        env: { remoteName: remote ? 'ssh-remote' : undefined, asExternalUri: async uri => {
            forwarded.push(uri.toString());
            if (forwardError) throw new Error('Connection failed');
            return { toString: () => uri.toString().replace('localhost:5173', '127.0.0.1:55173') };
        } },
        workspace: {
            isTrusted: true,
            getConfiguration: () => ({ get: key => key === 'autoOpenUrls' ? urls : [] }),
        },
        window: {
            createWebviewPanel: (_id, _title, _column, options) => {
                const panel = { webview: { html: '' }, options, onDidDispose: listener => { panel.dispose = listener; } };
                panels.push(panel);
                return panel;
            },
            showErrorMessage: message => assert.fail(message),
        },
        tasks: { fetchTasks: async () => [] },
    };
    const client = { get: (url, _options, callback) => {
        requested.push(url);
        setTimeout(() => callback({ resume() {} }), responseDelay);
        return new EventEmitter();
    } };
    const sandbox = { module: { exports: {} }, URL, setTimeout, clearTimeout,
        require: name => name === 'vscode' ? vscode : client };
    vm.runInNewContext(source, sandbox);
    await sandbox.module.exports.activate({ subscriptions: [] });
    if (dispose) panels.forEach(panel => panel.dispose());
    await new Promise(resolve => setTimeout(resolve, responseDelay + 10));
    return { panels, forwarded, requested };
}

test('remote preview probes and embeds the forwarded URL with its complete path and query', async () => {
    const url = 'http://localhost:5173/path?view=story&mode=dev';
    const app = await preview({ urls: [url] });
    assert.deepEqual(app.forwarded, [url]);
    assert.deepEqual(app.requested, ['http://127.0.0.1:55173/path?view=story&mode=dev']);
    assert.match(app.panels[0].webview.html, /src="http:\/\/127\.0\.0\.1:55173\/path\?view=story&amp;mode=dev"/);
    assert.match(app.panels[0].webview.html, /frame-src http:\/\/127\.0\.0\.1:55173/);
    assert.match(app.panels[0].webview.html, /sandbox="allow-scripts allow-forms allow-same-origin allow-downloads"/);
});

test('local previews and public URLs keep their original address and one tab per URL', async () => {
    const urls = ['http://localhost:5173', 'https://example.com/docs'];
    const local = await preview({ remote: false, urls });
    assert.deepEqual(local.forwarded, []);
    assert.deepEqual(local.requested, urls);
    assert.equal(local.panels.length, 2);
    const remote = await preview({ urls: ['https://example.com/docs'] });
    assert.deepEqual(remote.forwarded, []);
});

test('forwarding failures show a useful status and disposed tabs stop updating', async () => {
    const failed = await preview({ urls: ['http://localhost:5173'], forwardError: true });
    assert.deepEqual(failed.requested, []);
    assert.match(failed.panels[0].webview.html, /Connection failed/);
    const closed = await preview({ urls: ['http://localhost:5173'], dispose: true, responseDelay: 15 });
    assert.doesNotMatch(closed.panels[0].webview.html, /<iframe/);
});
