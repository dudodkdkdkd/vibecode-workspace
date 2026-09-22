const vscode = require("vscode");
const http = require("node:http");
const https = require("node:https");

// Dev-Server wie Storybook brauchen deutlich länger als Vite. Der Tab zeigt
// solange einen Hinweis und lädt die Seite, sobald der Server antwortet.
const PROBE_TIMEOUT_MS = 2000;
const RETRY_INTERVAL_MS = 1000;
const MAX_WAIT_MS = 300000;

function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function tabTitle(url) {
    try {
        return new URL(url).host;
    } catch {
        return url;
    }
}

function frameOrigin(url) {
    try {
        return new URL(url).origin;
    } catch {
        return url;
    }
}

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isReachable(url) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };
        try {
            const client = url.startsWith("https:") ? https : http;
            const request = client.get(url, { timeout: PROBE_TIMEOUT_MS }, (response) => {
                response.resume();
                finish(true);
            });
            request.on("error", () => finish(false));
            request.on("timeout", () => {
                request.destroy();
                finish(false);
            });
        } catch {
            finish(false);
        }
    });
}

function page(csp, body) {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
html, body { margin: 0; padding: 0; width: 100%; height: 100%; }
iframe { width: 100%; height: 100%; border: 0; display: block; }
.status {
    display: flex; align-items: center; justify-content: center; height: 100%;
    font-family: var(--vscode-font-family); font-size: 13px;
    color: var(--vscode-descriptionForeground); background: var(--vscode-editor-background);
}
</style>
</head>
<body>${body}</body>
</html>`;
}

function statusHtml(message) {
    return page("default-src 'none'; style-src 'unsafe-inline';",
        `<div class="status">${escapeHtml(message)}</div>`);
}

function frameHtml(url) {
    return page(`default-src 'none'; frame-src ${frameOrigin(url)}; style-src 'unsafe-inline';`,
        `<iframe src="${escapeHtml(url)}" sandbox="allow-scripts allow-forms allow-same-origin allow-downloads"></iframe>`);
}

function openTab(url) {
    const panel = vscode.window.createWebviewPanel(
        "vibecodeWorkspace.autoOpenTab",
        tabTitle(url),
        { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
        { enableScripts: true, retainContextWhenHidden: true }
    );

    let disposed = false;
    panel.onDidDispose(() => {
        disposed = true;
    });
    panel.webview.html = statusHtml(`Warte auf ${url} …`);

    (async () => {
        const deadline = Date.now() + MAX_WAIT_MS;
        while (!disposed) {
            if (await isReachable(url)) {
                if (!disposed) panel.webview.html = frameHtml(url);
                return;
            }
            if (Date.now() >= deadline) {
                if (!disposed) panel.webview.html = statusHtml(`${url} antwortet nicht. Tab schließen und Workspace neu starten.`);
                return;
            }
            await delay(RETRY_INTERVAL_MS);
        }
    })();
}

function activate() {
    const urls = vscode.workspace.getConfiguration("vibecodeWorkspace").get("autoOpenUrls", []);
    if (!Array.isArray(urls)) return;
    for (const url of urls) {
        if (typeof url !== "string" || !url.trim()) continue;
        openTab(url.trim());
    }
}

module.exports = { activate };
