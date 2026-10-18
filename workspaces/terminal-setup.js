// macOS JXA: Dialoge und JSON-Speicherung der Terminals pro Repository.
ObjC.import("Foundation");

function readText(path) {
    const value = $.NSString.stringWithContentsOfFileEncodingError(
        $(path), $.NSUTF8StringEncoding, null
    );
    if (!value) throw new Error(`Datei konnte nicht gelesen werden: ${path}`);
    return ObjC.unwrap(value);
}

function shellQuote(value) {
    return "'" + value.replace(/'/g, "'\\''") + "'";
}

function terminalCommand(type, prompt) {
    if (type === "Shell") return "exec zsh -l";
    if (type === "Eigener Befehl") return prompt;
    if (type === "Antigravity") {
        const argument = prompt ? ` --prompt-interactive ${shellQuote(prompt)}` : "";
        return `if command -v agy >/dev/null 2>&1; then exec agy --dangerously-skip-permissions${argument}; else echo 'Antigravity (agy) ist nicht installiert.'; exec zsh -l; fi`;
    }
    const executable = type === "Claude Code" ? "claude" : "codex";
    const flag = type === "Claude Code"
        ? "--dangerously-skip-permissions"
        : "--sandbox workspace-write --ask-for-approval never";
    const account = type === "Codex 2" ? 'CODEX_HOME="$HOME/.codex-account2" '
        : type === "Codex" ? 'CODEX_HOME="$HOME/.codex" ' : "";
    const argument = prompt ? ` -- ${shellQuote(prompt)}` : "";
    return `if command -v ${executable} >/dev/null 2>&1; then ${account}exec ${executable} ${flag}${argument}; else echo '${type} ist nicht installiert.'; exec zsh -l; fi`;
}

function defaultTerminals() {
    return [
        { name: "Frontend", type: "Eigener Befehl", prompt: "npm run dev", cwd: "frontend" },
        // --no-open verhindert, dass Storybook zusätzlich den Systembrowser öffnet.
        { name: "Storybook", type: "Eigener Befehl", prompt: "npm run storybook -- --no-open", cwd: "frontend" },
        { name: "Claude", type: "Claude Code", prompt: "", cwd: "" },
        { name: "Codex 1", type: "Codex", prompt: "", cwd: "" },
        { name: "Codex 2", type: "Codex 2", prompt: "", cwd: "" },
    ].map((terminal) => ({
        ...terminal, command: terminalCommand(terminal.type, terminal.prompt),
    }));
}

function ask(app, text, defaultAnswer, title) {
    return app.displayDialog(text, {
        withTitle: title,
        defaultAnswer,
        buttons: ["Abbrechen", "Weiter"],
        defaultButton: "Weiter",
        cancelButton: "Abbrechen",
    }).textReturned;
}

function configureUrls(app, project, existing) {
    const title = `Browser-Tabs · ${project.name}`;
    const answer = ask(app,
        `Welche Browser-Tabs sollen beim Start von „${project.name}“ automatisch geöffnet werden?\n\nURLs mit Komma trennen (z. B. http://localhost:5173, http://localhost:6006). Leer lassen = keine Browser-Tabs.`,
        existing.join(", "), title);
    if (answer === undefined) return null;
    return answer.split(",")
        .map((url) => url.trim())
        .filter(Boolean);
}

// Version 1 speicherte pro Projekt direkt eine Terminal-Liste ohne Browser-Tabs.
// Ungültige Rohdaten werden unverändert durchgereicht, damit die anschließende
// Validierung sie erkennt, statt sie stillschweigend als leer zu behandeln.
function normalizeEntry(raw) {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        return { terminals: raw.terminals, urls: raw.urls === undefined ? [] : raw.urls };
    }
    return { terminals: raw, urls: [] };
}

function validateTerminals(terminals, projectName) {
    if (!Array.isArray(terminals) || terminals.some((entry) => !entry ||
        !["Shell", "Claude Code", "Codex", "Codex 2", "Antigravity", "Eigener Befehl"].includes(entry.type) ||
        [entry.name, entry.prompt, entry.command, entry.cwd].some((value) => typeof value !== "string"))) {
        throw new Error(`Ungültige Terminals für ${projectName}.`);
    }
}

function validateUrls(urls, projectName) {
    if (!Array.isArray(urls) || urls.some((url) => typeof url !== "string" || !url.trim())) {
        throw new Error(`Ungültige Browser-Tabs für ${projectName}.`);
    }
}

function configureProject(app, project, existing) {
    const title = `Terminals · ${project.name}`;
    let count;
    while (true) {
        const answer = ask(app,
            `Wie viele Terminals sollen für „${project.name}“ geöffnet werden?\n\n0 = keine Terminals. Claude Code und Antigravity starten ohne Sicherheitsabfragen. Codex startet mit Workspace-Sandbox ohne Sicherheitsabfragen; durch die Sandbox verbotene Aktionen werden blockiert.`,
            String(existing.length), title).trim();
        if (/^\d+$/.test(answer) && Number.isSafeInteger(Number(answer))) {
            count = Number(answer);
            break;
        }
        app.displayAlert("Bitte eine ganze Zahl ab 0 eingeben.");
    }

    const terminals = [];
    const types = ["Shell", "Claude Code", "Codex", "Codex 2", "Antigravity", "Eigener Befehl"];
    for (let index = 0; index < count; index += 1) {
        const previous = existing[index];
        const terminalTitle = `${project.name} · Terminal ${index + 1} von ${count}`;
        const chosen = app.chooseFromList(types, {
            withTitle: terminalTitle,
            withPrompt: "Was soll in diesem Terminal starten?",
            defaultItems: [previous ? previous.type : "Shell"],
        });
        if (chosen === false) return null;
        const type = chosen[0];
        let prompt = previous && previous.type === type ? previous.prompt : "";
        if (type !== "Shell") {
            do {
                prompt = ask(app, type === "Eigener Befehl"
                    ? "Welcher Shell-Befehl soll ausgeführt werden? (z. B. npm run dev)"
                    : "Optionaler Startprompt / Aufgabe für den Agenten (leer = ohne vorgegebene Aufgabe starten):",
                prompt, terminalTitle);
            } while (type === "Eigener Befehl" && !prompt.trim());
        } else {
            prompt = "";
        }
        const defaultName = previous && previous.type === type ? previous.name : type;
        const name = ask(app, "Name dieses Terminals:", defaultName, terminalTitle).trim() || type;
        let cwd;
        do {
            cwd = ask(app,
                "Arbeitsverzeichnis relativ zum Repository (leer = Repository-Ordner):",
                previous ? previous.cwd : "", terminalTitle).trim();
            if (cwd.startsWith("/") || cwd.startsWith("~") || cwd.split("/").includes("..")) {
                app.displayAlert("Bitte einen relativen Unterordner ohne '..' angeben.");
                cwd = null;
            }
        } while (cwd === null);
        terminals.push({ name, type, prompt, command: terminalCommand(type, prompt), cwd });
    }
    return terminals;
}

function run(argv) {
    const [projectsFile, savedFile, outputFile] = argv;
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    const projects = readText(projectsFile).split(/\r?\n/).filter(Boolean).map((line) => {
        const separator = line.indexOf("\t");
        return { name: line.slice(0, separator), path: line.slice(separator + 1) };
    });
    let saved = { version: 2, projects: {} };
    if ($.NSFileManager.defaultManager.fileExistsAtPath($(savedFile))) {
        saved = JSON.parse(readText(savedFile));
        if (!saved || ![1, 2].includes(saved.version) || !saved.projects || typeof saved.projects !== "object" || Array.isArray(saved.projects)) {
            throw new Error("Ungültige Terminal-Konfiguration. Die vorhandene Datei wurde nicht verändert.");
        }
    }
    const result = { version: 2, projects: {} };
    for (const project of projects) {
        if (Object.prototype.hasOwnProperty.call(saved.projects, project.path)) {
            const { terminals, urls } = normalizeEntry(saved.projects[project.path]);
            validateTerminals(terminals, project.name);
            validateUrls(urls, project.name);
            result.projects[project.path] = { terminals, urls };
        }
    }

    try {
        const selected = app.chooseFromList(projects.map((project) => project.name), {
            withTitle: "VibeCode Workspace Setup",
            withPrompt: "Für welche Repositories möchtest du Anzahl und Inhalt der Terminals sowie die automatisch geöffneten Browser-Tabs festlegen? Mehrfachauswahl mit ⌘. Nicht ausgewählte Ordner behalten ihre bisherige Konfiguration oder die fünf Standard-Terminals. Bei USE_PROJECT_TERMINALS=false in config.local.zsh gelten die globalen Terminals; die Browser-Tabs bleiben projektspezifisch.",
            defaultItems: [],
            multipleSelectionsAllowed: true,
        });
        if (selected === false) return "cancelled";
        for (const project of projects) {
            if (!selected.includes(project.name)) continue;
            const existing = result.projects[project.path] || { terminals: defaultTerminals(), urls: [] };
            const terminals = configureProject(app, project, existing.terminals);
            if (terminals === null) return "cancelled";
            const urls = configureUrls(app, project, existing.urls);
            if (urls === null) return "cancelled";
            result.projects[project.path] = { terminals, urls };
        }
    } catch (error) {
        if (error.errorNumber === -128) return "cancelled";
        throw error;
    }

    const written = $(JSON.stringify(result, null, 2) + "\n").writeToFileAtomicallyEncodingError(
        $(outputFile), true, $.NSUTF8StringEncoding, null
    );
    if (!written) throw new Error(`Terminal-Konfiguration konnte nicht geschrieben werden: ${outputFile}`);
    return "saved";
}
