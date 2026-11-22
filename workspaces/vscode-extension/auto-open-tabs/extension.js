const vscode = require("vscode");
const http = require("node:http");
const https = require("node:https");

// Dev-Server wie Storybook brauchen deutlich länger als Vite. Der Tab zeigt
// solange einen Hinweis und lädt die Seite, sobald der Server antwortet.
const PROBE_TIMEOUT_MS = 2000;
const RETRY_INTERVAL_MS = 1000;
const MAX_WAIT_MS = 300000;
const TERMINAL_LAYOUTS = [
    { value: "panel", label: "Splits im Terminalpanel", detail: "Bisherige Ansicht unten im Fenster" },
    { value: "tabs", label: "Terminal-Tabs pro Projekt", detail: "Eine Editorzeile mit einer Tableiste je Projekt" },
    { value: "grid", label: "Terminal-Raster pro Projekt", detail: "Terminals nebeneinander, Projekte untereinander" },
];

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

function uniqueTerminals(definitions) {
    const seen = new Set();
    return definitions.filter((definition) => {
        if (!definition || typeof definition.name !== "string" || !definition.name.trim() ||
            typeof definition.command !== "string" || !definition.command.trim() || seen.has(definition.name)) return false;
        seen.add(definition.name);
        return true;
    });
}

function findTerminal(name) {
    return vscode.window.terminals.find((terminal) =>
        terminal.name === name || terminal.name.startsWith(name + " ("));
}

function terminalLocationKey(definition) {
    return JSON.stringify([definition.cwd ?? "", definition.name]);
}

function terminalLayout(definition, layout, overrides) {
    if (!definition.group) return "panel";
    return definition.placement ?? overrides[terminalLocationKey(definition)] ?? layout;
}

async function editorTerminalLocations(definitions, layout, overrides) {
    const locations = new Map();
    const projects = new Map();
    for (const definition of definitions) {
        const destination = terminalLayout(definition, layout, overrides);
        if (destination !== "tabs" && destination !== "grid") continue;
        if (!projects.has(definition.group)) projects.set(definition.group, { panes: [] });
        const project = projects.get(definition.group);
        if (destination === "tabs") {
            if (!project.tabs) {
                project.tabs = [];
                project.panes.push(project.tabs);
            }
            project.tabs.push(definition);
        } else {
            project.panes.push([definition]);
        }
    }
    const groups = [];
    let column = 1;
    for (const { panes } of projects.values()) {
        for (const pane of panes) {
            for (const terminal of pane) {
                locations.set(terminal.name, { viewColumn: column, preserveFocus: true });
            }
            column++;
        }
        groups.push(panes.length > 1 ? { groups: panes.map(() => ({})) } : {});
    }
    if (![...locations.keys()].some((name) => !findTerminal(name))) return locations;

    // VS Code alternates orientation at each level. The root stacks projects,
    // and every nested group places that project's terminals side by side.
    const singleRow = groups.length === 1 && groups[0].groups;
    try {
        await vscode.commands.executeCommand("vscode.setEditorLayout", singleRow
            ? { orientation: 0, groups: singleRow }
            : { orientation: 1, groups });
    } catch (error) {
        vscode.window.showWarningMessage(`VibeCode: Das Editorlayout konnte nicht geöffnet werden. Die Terminals starten im Panel. ${error.message}`);
        locations.clear();
    }
    return locations;
}

async function showStartedTerminal(definition, terminal) {
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

async function startTerminals(configured, layout, overrides) {
    const definitions = uniqueTerminals(configured);
    const editorLocations = await editorTerminalLocations(definitions, layout, overrides);
    const panelProject = (definition) => definition.group && !editorLocations.has(definition.name);
    // Queue all project panel splits before waiting for any editor terminal.
    const startupOrder = editorLocations.size
        ? [...definitions.filter(panelProject), ...definitions.filter((definition) => !panelProject(definition))]
        : definitions;
    const parents = new Map();
    const created = [];
    for (const definition of startupOrder) {
        const editorLocation = editorLocations.get(definition.name);
        // Beim Neuladen keine laufenden Agenten/Server ein zweites Mal starten.
        const existing = findTerminal(definition.name);
        if (existing) {
            if (definition.group && !editorLocation) parents.set(definition.group, existing);
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
                location: editorLocation ?? (parent ? { parentTerminal: parent } : vscode.TerminalLocation.Panel),
            });
        } catch (error) {
            vscode.window.showWarningMessage(`VibeCode: ${definition.name} konnte nicht gestartet werden: ${error.message}`);
            continue;
        }
        if (editorLocation) {
            // Editor-Tabs nacheinander öffnen, damit ihre Reihenfolge stabil bleibt.
            await showStartedTerminal(definition, terminal);
        } else {
            // Panel-Splits synchron anlegen. VS Code kann einen neu angelegten
            // parentTerminal nach seinem Open-Ereignis nicht mehr auflösen.
            if (definition.group) parents.set(definition.group, terminal);
            created.push({ definition, terminal });
        }
    }
    for (const { definition, terminal } of created) await showStartedTerminal(definition, terminal);
}

async function chooseTerminalLocations(settings, projects) {
    const overrides = { ...settings.get("terminalLocations", {}) };
    const layout = settings.get("terminalLayout", "panel");
    const selected = await vscode.window.showQuickPick(projects.map((definition) => ({
        label: definition.name,
        description: TERMINAL_LAYOUTS.find((item) => item.value === terminalLayout(definition, layout, overrides))?.label,
        definition,
    })), { canPickMany: true, placeHolder: "Terminals ohne festen Öffnungsort im Preset auswählen" });
    if (!selected?.length) return;
    const choice = await vscode.window.showQuickPick([
        ...TERMINAL_LAYOUTS,
        { value: "default", label: "Standard-Layout verwenden" },
    ], { placeHolder: "Öffnungsort für die gewählten Terminals" });
    if (!choice) return;
    for (const { definition } of selected) {
        const key = terminalLocationKey(definition);
        if (choice.value === "default") delete overrides[key];
        else overrides[key] = choice.value;
    }
    await settings.update("terminalLocations", overrides, vscode.ConfigurationTarget.Global);
    return choice;
}

async function activate(context) {
    const urls = vscode.workspace.getConfiguration("vibecodeWorkspace").get("autoOpenUrls", []);
    for (const url of Array.isArray(urls) ? urls : []) {
        if (typeof url !== "string" || !url.trim()) continue;
        openTab(url.trim());
    }
    const startConfigured = async () => {
        try {
            const settings = vscode.workspace.getConfiguration("vibecodeWorkspace");
            const terminals = settings.get("autoStartTerminals", []);
            if (Array.isArray(terminals) && terminals.length) {
                await startTerminals(terminals, settings.get("terminalLayout", "panel"), settings.get("terminalLocations", {}));
            } else {
                await startOrderedTasks();
            }
        } catch (error) {
            vscode.window.showErrorMessage(`VibeCode: Terminals konnten nicht gestartet werden: ${error.message}`);
        }
    };
    let starting;
    const start = () => starting ??= startConfigured().finally(() => { starting = undefined; });
    const projectTerminals = (settings) => {
        const configured = settings.get("autoStartTerminals", []);
        return Array.isArray(configured) ? uniqueTerminals(configured).filter((definition) => definition.group) : [];
    };
    const applyOnNextStart = async (projects, message) => {
        await starting;
        if (vscode.workspace.isTrusted && projects.length && !projects.some((definition) => findTerminal(definition.name))) {
            await start();
        } else {
            vscode.window.showInformationMessage(message);
        }
    };
    context.subscriptions.push(vscode.commands.registerCommand("vibecodeWorkspace.chooseTerminalLayout", async () => {
        const settings = vscode.workspace.getConfiguration("vibecodeWorkspace");
        const current = settings.get("terminalLayout", "panel");
        const choice = await vscode.window.showQuickPick(TERMINAL_LAYOUTS.map((item) => ({
            ...item, description: item.value === current ? "Ausgewählt" : undefined,
        })), { placeHolder: "Layout für die VibeCode-Projektterminals wählen" });
        if (!choice) return;
        await settings.update("terminalLayout", choice.value, vscode.ConfigurationTarget.Global);
        await applyOnNextStart(projectTerminals(settings), `VibeCode: „${choice.label}“ gilt beim nächsten Start der Projektterminals.`);
    }));
    context.subscriptions.push(vscode.commands.registerCommand("vibecodeWorkspace.chooseTerminalLocations", async () => {
        const settings = vscode.workspace.getConfiguration("vibecodeWorkspace");
        const projects = projectTerminals(settings);
        if (!projects.length) {
            vscode.window.showInformationMessage("VibeCode: In diesem Workspace sind keine Projektterminals konfiguriert.");
            return;
        }
        const configurable = projects.filter((definition) => definition.placement === undefined);
        if (!configurable.length) {
            vscode.window.showInformationMessage("VibeCode: Die Öffnungsorte sind in den Projekt-Presets festgelegt.");
            return;
        }
        if (await chooseTerminalLocations(settings, configurable)) {
            await applyOnNextStart(projects, "VibeCode: Die Öffnungsorte gelten beim nächsten Start der Projektterminals.");
        }
    }));
    if (vscode.workspace.isTrusted) await start();
    else context.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(start));
}

module.exports = { activate };
