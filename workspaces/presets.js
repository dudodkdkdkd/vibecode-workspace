// macOS JXA: Presets pro Repository (Terminals und Browser-Tabs) in terminals.json lesen und schreiben.
// Aufruf: osascript -l JavaScript presets.js <modulordner> <befehl> …
//   list <config>                    alle Presets als JSON
//   defaults                         die Standard-Terminals (lokal und remote) als JSON
//   save <config> <pfad> <datei>     Preset aus {terminals, urls} (JSON-Datei) speichern
//   reset <config> <pfad>            Preset entfernen: es gelten wieder die Standard-Terminals
// Befehle und Prüfungen kommen aus terminal-setup.js selbst, nichts davon ist nachgebaut.
ObjC.import("Foundation");

const TYPES = ["Shell", "Claude Code", "Codex", "Codex 2", "Antigravity", "Eigener Befehl"];
const MAX_TERMINALS = 12;

function readText(path) {
    const value = $.NSString.stringWithContentsOfFileEncodingError($(path), $.NSUTF8StringEncoding, null);
    if (!value) throw new Error(`Datei konnte nicht gelesen werden: ${path}`);
    return ObjC.unwrap(value);
}

function exists(path) {
    return $.NSFileManager.defaultManager.fileExistsAtPath($(path));
}

// Die Funktionen des Setup-Assistenten, direkt aus seinem Quelltext: eine Quelle der Wahrheit.
function loadWizard(moduleDirectory) {
    const source = readText(`${moduleDirectory}/terminal-setup.js`);
    return new Function(`${source}
return { terminalCommand, defaultTerminals, validateTerminals, validateUrls, normalizeEntry };`)();
}

function isRemote(path) {
    return path.startsWith("vscode-remote://");
}

function readStore(wizard, file) {
    if (!exists(file)) return { version: 2, projects: {} };
    const saved = JSON.parse(readText(file));
    // Beschädigte Daten werden abgelehnt, nie ersetzt (wie im Setup-Assistenten).
    if (!saved || ![1, 2].includes(saved.version) || !saved.projects || typeof saved.projects !== "object" || Array.isArray(saved.projects)) {
        throw new Error("Ungültige Terminal-Konfiguration. Die vorhandene Datei wurde nicht verändert.");
    }
    const projects = {};
    Object.keys(saved.projects).forEach((path) => {
        const { terminals, urls } = wizard.normalizeEntry(saved.projects[path]);
        wizard.validateTerminals(terminals, path);
        wizard.validateUrls(urls, path);
        projects[path] = { terminals, urls };
    });
    return { version: 2, projects };
}

function writeStore(file, store) {
    // Auf einem frischen Mac gibt es ~/.config/vibecode-workspace noch nicht.
    $.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(
        $(file.slice(0, file.lastIndexOf("/"))), true, $(), null);
    const written = $(JSON.stringify(store, null, 2) + "\n").writeToFileAtomicallyEncodingError(
        $(file), true, $.NSUTF8StringEncoding, null);
    if (!written) throw new Error(`Terminal-Konfiguration konnte nicht geschrieben werden: ${file}`);
}

function visible(terminal) {
    return { name: terminal.name, type: terminal.type, prompt: terminal.prompt, cwd: terminal.cwd };
}

function check(condition, message) {
    if (!condition) throw new Error(message);
}

function buildPreset(wizard, path, preset) {
    check(preset && Array.isArray(preset.terminals) && Array.isArray(preset.urls), "Das Preset braucht terminals und urls.");
    check(preset.terminals.length <= MAX_TERMINALS, `Höchstens ${MAX_TERMINALS} Terminals pro Repository.`);
    const names = new Set();
    const terminals = preset.terminals.map((entry, index) => {
        const where = `Terminal ${index + 1}`;
        check(entry && TYPES.includes(entry.type), `${where}: unbekannter Typ.`);
        check([entry.name, entry.prompt, entry.cwd].every((value) => typeof value === "string"), `${where}: ungültige Angaben.`);
        const name = entry.name.trim() || entry.type;
        check(name.length <= 60 && !/[\u0000-\u001f\u007f]/.test(name), `${where}: Name zu lang oder mit Steuerzeichen.`);
        check(!names.has(name), `Zwei Terminals heißen „${name}“. Jedes braucht einen eigenen Namen.`);
        names.add(name);
        const prompt = entry.type === "Shell" ? "" : entry.prompt.trim();
        check(entry.type !== "Eigener Befehl" || prompt, `${where} („${name}“): Bitte einen Shell-Befehl angeben.`);
        check(!/[\u0000-\u001f\u007f]/.test(prompt.replace(/\n/g, " ")), `${where}: Steuerzeichen im Prompt.`);
        const cwd = entry.cwd.trim();
        check(!cwd.startsWith("/") && !cwd.startsWith("~") && !cwd.split("/").includes("..") && !/[\u0000-\u001f\u007f]/.test(cwd),
            `${where} („${name}“): Bitte einen relativen Unterordner ohne „..“ angeben.`);
        return { name, type: entry.type, prompt, command: wizard.terminalCommand(entry.type, prompt, isRemote(path)), cwd };
    });
    const urls = preset.urls.map((url) => {
        check(typeof url === "string", "Ungültiger Browser-Tab.");
        return url.trim();
    }).filter(Boolean);
    urls.forEach((url) => check(/^https?:\/\/\S+$/.test(url), `Browser-Tab „${url}“: bitte mit http:// oder https:// beginnen.`));
    return { terminals, urls };
}

function checkPath(path) {
    check(typeof path === "string" && path.trim() && !/[\u0000-\u001f\u007f]/.test(path), "Ungültiger Repository-Pfad.");
}

function run(argv) {
    const [moduleDirectory, command, config, path, file] = argv;
    const wizard = loadWizard(moduleDirectory);
    const terminalsFile = `${config}/terminals.json`;
    if (command === "defaults") {
        return JSON.stringify({
            local: wizard.defaultTerminals(false).map(visible), remote: wizard.defaultTerminals(true).map(visible),
        });
    }
    check(typeof config === "string" && config, "Konfigurationsordner fehlt.");
    if (command === "list") {
        const store = readStore(wizard, terminalsFile);
        return JSON.stringify(Object.keys(store.projects).map((key) => ({
            path: key, terminals: store.projects[key].terminals.map(visible), urls: store.projects[key].urls,
        })));
    }
    checkPath(path);
    if (command === "save") {
        check(file && exists(file), "Preset-Datei fehlt.");
        const built = buildPreset(wizard, path, JSON.parse(readText(file)));
        const store = readStore(wizard, terminalsFile);
        store.projects[path] = built;
        writeStore(terminalsFile, store);
        return JSON.stringify({ terminals: built.terminals.map(visible), urls: built.urls });
    }
    if (command === "reset") {
        const store = readStore(wizard, terminalsFile);
        if (Object.prototype.hasOwnProperty.call(store.projects, path)) {
            delete store.projects[path];
            writeStore(terminalsFile, store);
        }
        return "ok";
    }
    throw new Error("Befehle: list | defaults | save | reset");
}
