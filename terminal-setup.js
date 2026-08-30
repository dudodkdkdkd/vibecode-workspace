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
    const executable = type === "Claude Code" ? "claude" : "codex";
    const flag = type === "Claude Code"
        ? "--dangerously-skip-permissions"
        : "--sandbox workspace-write --ask-for-approval never";
    const argument = prompt ? ` -- ${shellQuote(prompt)}` : "";
    return `if command -v ${executable} >/dev/null 2>&1; then exec ${executable} ${flag}${argument}; else echo '${type} ist nicht installiert.'; exec zsh -l; fi`;
}

function defaultTerminals() {
    return ["Shell", "Claude Code", "Codex"].map((type) => ({
        name: type, type, prompt: "", command: terminalCommand(type, ""), cwd: "",
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

function configureProject(app, project, existing) {
    const title = `Terminals · ${project.name}`;
    let count;
    while (true) {
        const answer = ask(app,
            `Wie viele Terminals sollen für „${project.name}“ geöffnet werden?\n\n0 = keine Terminals. Claude Code startet im YOLO-Modus. Codex startet mit Workspace-Sandbox ohne Sicherheitsabfragen; durch die Sandbox verbotene Aktionen werden blockiert.`,
            String(existing.length), title).trim();
        if (/^\d+$/.test(answer) && Number.isSafeInteger(Number(answer))) {
            count = Number(answer);
            break;
        }
        app.displayAlert("Bitte eine ganze Zahl ab 0 eingeben.");
    }

    const terminals = [];
    const types = ["Shell", "Claude Code", "Codex", "Eigener Befehl"];
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
    let saved = { version: 1, projects: {} };
    if ($.NSFileManager.defaultManager.fileExistsAtPath($(savedFile))) {
        saved = JSON.parse(readText(savedFile));
        if (!saved || saved.version !== 1 || !saved.projects || typeof saved.projects !== "object" || Array.isArray(saved.projects)) {
            throw new Error("Ungültige Terminal-Konfiguration. Die vorhandene Datei wurde nicht verändert.");
        }
    }
    const result = { version: 1, projects: {} };
    for (const project of projects) {
        if (Object.prototype.hasOwnProperty.call(saved.projects, project.path)) {
            const entries = saved.projects[project.path];
            if (!Array.isArray(entries) || entries.some((entry) => !entry ||
                !["Shell", "Claude Code", "Codex", "Eigener Befehl"].includes(entry.type) ||
                [entry.name, entry.prompt, entry.command, entry.cwd].some((value) => typeof value !== "string"))) {
                throw new Error(`Ungültige Terminals für ${project.name}.`);
            }
            result.projects[project.path] = entries;
        }
    }

    try {
        const selected = app.chooseFromList(projects.map((project) => project.name), {
            withTitle: "VibeCode Workspace Setup",
            withPrompt: "Für welche Repositories möchtest du Anzahl und Inhalt der Terminals festlegen? Mehrfachauswahl mit ⌘. Nicht ausgewählte Ordner behalten ihre bisherigen Terminals oder die drei Standard-Terminals.",
            defaultItems: projects.map((project) => project.name),
            multipleSelectionsAllowed: true,
        });
        if (selected === false) return "cancelled";
        for (const project of projects) {
            if (!selected.includes(project.name)) continue;
            const terminals = configureProject(app, project,
                result.projects[project.path] || defaultTerminals());
            if (terminals === null) return "cancelled";
            result.projects[project.path] = terminals;
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
