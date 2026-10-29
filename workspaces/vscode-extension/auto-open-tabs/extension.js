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
        // Die UI-Erweiterung läuft auf dem Mac. VS Code leitet localhost-URLs
        // zum SSH-Host weiter, auch wenn der lokale Port bereits belegt ist.
        let target = url;
        try {
            const parsed = new URL(url);
            if (vscode.env?.remoteName && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
                target = (await vscode.env.asExternalUri(vscode.Uri.parse(url))).toString();
            }
        } catch (error) {
            if (!disposed) panel.webview.html = statusHtml(`${url} konnte nicht weitergeleitet werden: ${error.message}`);
            return;
        }
        const deadline = Date.now() + MAX_WAIT_MS;
        while (!disposed) {
            if (await isReachable(target)) {
                if (!disposed) panel.webview.html = frameHtml(target);
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

function isSameTask(candidate, task) {
    return candidate.name === task.name && candidate.scope === task.scope;
}

// executeTask liefert die Ausführung bereits vor dem tatsächlichen Start zurück.
// Erst das Prozessstart-Ereignis bestätigt, dass das Terminal angelegt wurde.
function startTask(task) {
    return new Promise((resolve, reject) => {
        const subscriptions = [];
        let timeout;
        const finish = (error) => {
            clearTimeout(timeout);
            subscriptions.forEach((subscription) => subscription.dispose());
            if (error) reject(error);
            else resolve();
        };
        subscriptions.push(vscode.tasks.onDidStartTaskProcess((event) => {
            if (isSameTask(event.execution.task, task)) finish();
        }));
        // Auch ein sofort beendeter/fehlgeschlagener Task darf die restlichen
        // Terminals nicht blockieren. Auf das Ende laufender Server warten wir nicht.
        subscriptions.push(vscode.tasks.onDidEndTask((event) => {
            if (isSameTask(event.execution.task, task)) finish();
        }));
        timeout = setTimeout(() => finish(new Error("Terminal-Start dauert zu lange.")), 30000);
        try {
            Promise.resolve(vscode.tasks.executeTask(task)).catch(finish);
        } catch (error) {
            finish(error);
        }
    });
}

async function startOrderedTasks() {
    const labels = vscode.workspace.getConfiguration("vibecodeWorkspace").get("autoStartTasks", []);
    if (!Array.isArray(labels) || !labels.length) return;
    const tasks = (await vscode.tasks.fetchTasks()).filter((task) => task.scope === vscode.TaskScope.Workspace);
    for (const label of new Set(labels)) {
        if (typeof label !== "string" || !label.trim()) continue;
        const task = tasks.find((candidate) => candidate.name === label);
        if (task && vscode.tasks.taskExecutions.some((execution) => isSameTask(execution.task, task))) continue;
        try {
            if (!task) throw new Error("Workspace-Task wurde nicht gefunden.");
            await startTask(task);
        } catch (error) {
            vscode.window.showWarningMessage(`VibeCode: ${label} konnte nicht gestartet werden: ${error.message}`);
        }
    }
}

function shellQuote(value) {
    return "'" + value.replace(/'/g, "'\\''") + "'";
}

async function startSplitTerminals(definitions) {
    const parents = new Map();
    const seen = new Set();
    const created = [];
    // Die ganze Gruppe ohne await anlegen. In VS Code 1.138 wird parentTerminal
    // nach dem Open-Ereignis numerisch serialisiert, aber nur die anfängliche
    // Extension-ID im Hauptprozess aufgelöst. Sonst entstehen einzelne Tabs.
    for (const definition of definitions) {
        if (!definition || typeof definition.name !== "string" || !definition.name.trim() ||
            typeof definition.command !== "string" || !definition.command.trim() || seen.has(definition.name)) continue;
        seen.add(definition.name);
        // Beim Neuladen keine laufenden Agenten/Server ein zweites Mal starten.
        const existing = vscode.window.terminals.find((terminal) =>
            terminal.name === definition.name || terminal.name.startsWith(definition.name + " ("));
        if (existing) {
            if (definition.group) parents.set(definition.group, existing);
            continue;
        }
        let terminal;
        try {
            const parent = parents.get(definition.group);
            const command = definition.type === "process"
                ? [definition.command, ...(definition.args || [])].map(shellQuote).join(" ")
                : definition.command;
            const shellPath = definition.shellPath || "/bin/zsh";
            terminal = vscode.window.createTerminal({
                name: definition.name,
                // Ein URI erhält die SSH-Authority; ein fsPath würde diese verlieren.
                cwd: definition.cwd?.startsWith("vscode-remote://")
                    ? vscode.Uri.parse(definition.cwd) : definition.cwd,
                env: definition.env,
                shellPath,
                // Ein direkter Start wie bei Shell-Tasks verhindert, dass andere
                // Erweiterungen Aktivierungsbefehle in laufende Agenten schicken.
                // Ctrl+C beendet nur den gestarteten Befehl. Auch ein exec im
                // Befehl darf die Shell, die danach den Prompt öffnet, nicht ersetzen.
                shellArgs: ["-l", "-c", definition.close ? command
                    : `trap ':' INT\n(\ntrap - INT\n${command}\n)\nexec ${shellQuote(shellPath)} -l`],
                iconPath: new vscode.ThemeIcon("terminal",
                    definition.color ? new vscode.ThemeColor(definition.color) : undefined),
                color: definition.color ? new vscode.ThemeColor(definition.color) : undefined,
                location: parent ? { parentTerminal: parent } : vscode.TerminalLocation.Panel,
            });
            if (definition.group) parents.set(definition.group, terminal);
            created.push({ definition, terminal });
        } catch (error) {
            vscode.window.showWarningMessage(`VibeCode: ${definition.name} konnte nicht gestartet werden: ${error.message}`);
        }
    }
    for (const { definition, terminal } of created) {
        let timeout;
        try {
            await Promise.race([
                terminal.processId,
                new Promise((_, reject) => {
                    timeout = setTimeout(() => reject(new Error("Terminal-Start dauert zu lange.")), 30000);
                }),
            ]);
            terminal.show(true);
        } catch (error) {
            terminal.dispose();
            vscode.window.showWarningMessage(`VibeCode: ${definition.name} konnte nicht gestartet werden: ${error.message}`);
        } finally {
            clearTimeout(timeout);
        }
    }
}

async function activate(context) {
    const urls = vscode.workspace.getConfiguration("vibecodeWorkspace").get("autoOpenUrls", []);
    for (const url of Array.isArray(urls) ? urls : []) {
        if (typeof url !== "string" || !url.trim()) continue;
        openTab(url.trim());
    }
    const start = async () => {
        try {
            const terminals = vscode.workspace.getConfiguration("vibecodeWorkspace").get("autoStartTerminals", []);
            if (Array.isArray(terminals) && terminals.length) await startSplitTerminals(terminals);
            else await startOrderedTasks();
        } catch (error) {
            vscode.window.showErrorMessage(`VibeCode: Terminals konnten nicht gestartet werden: ${error.message}`);
        }
    };
    if (vscode.workspace.isTrusted) await start();
    else context.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(start));
}

module.exports = { activate };
