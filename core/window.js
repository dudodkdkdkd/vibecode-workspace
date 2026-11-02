// VibeCode Hauptfenster (JXA/AppKit). Aufruf (macht core/vibecode.py):
//   osascript -l JavaScript window.js <python> <vibecode.py>
// Die Logik liegt in vibecode.py; dieses Fenster zeigt sie nur an und ruft sie auf.
ObjC.import("AppKit");

const WIDTH = 460;
const ROW = 26;
// Muss zu terminal-setup.js passen; die Prüfung und der Befehlsaufbau liegen dort, nicht hier.
const PRESET_TYPES = ["Shell", "Claude Code", "Codex", "Codex 2", "Antigravity", "Eigener Befehl"];
const PRESET_ROWS = { min: 6, max: 12 };
const PRESET_WIDTH = 640;

function shellQuote(value) {
    return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

function cleanMessage(error) {
    const text = String((error && error.message) || error);
    const index = text.lastIndexOf("VibeCode: ");
    return (index >= 0 ? text.slice(index + "VibeCode: ".length) : text).trim();
}

// ---------------------------------------------------------------- Aufrufe an vibecode.py

function makeBackend(app, python, core) {
    const call = (...args) => app.doShellScript([python, core, ...args].map(shellQuote).join(" "));
    return {
        state: () => JSON.parse(call("_state")),
        save: (workspace) => call("save", `--name=${workspace.name}`,
            ...workspace.projects.map((project) => `--project=${project}`),
            workspace.shortcut ? "--shortcut" : "--no-shortcut",
            // Local Dev: nicht angegeben = unverändert, null = entfernen, sonst alle drei Werte ("=" gegen führende Minuszeichen).
            ...(workspace.localDev === null ? ["--no-local-dev"] : workspace.localDev
                ? [`--local-dev-provider=${workspace.localDev.provider}`, `--local-dev-model=${workspace.localDev.model}`,
                    `--local-dev-framework=${workspace.localDev.framework}`] : []),
            ...(workspace.renameFrom ? [`--rename-from=${workspace.renameFrom}`] : [])),
        // Startbare Kombinationen {available, options, error}; ein Fehler macht den Dialog nicht unbenutzbar, er zeigt nur kein Local Dev.
        localDevOptions: () => JSON.parse(call("local-options")),
        // Einstellung unten bei Local Dev: alle Kombinationen plus gespeicherte Vorauswahl {available, options, current, error} ...
        localSettings: () => JSON.parse(call("local-settings")),
        // ... und speichern (das Modul prüft und schreibt, wie sein --setup).
        setLocalDefault: (value) => call("local-default", `--provider=${value.provider}`, `--model=${value.model}`,
            `--framework=${value.framework}`),
        remove: (name) => call("delete", `--name=${name}`),
        // Quick-Öffnen eines Workspaces: Shortcut auf dem Schreibtisch, der die Projekte zum Ankreuzen zeigt. "--name=" gegen "-x".
        quickWorkspace: (name, enabled) => call("workspace-quick", `--name=${name}`, enabled ? "on" : "off"),
        start: (name) => call("start", `--name=${name}`),
        open: (id) => call("open", id),
        syncShortcuts: () => call("shortcuts", "sync"),
        setting: (name, enabled) => call("settings", name, enabled ? "on" : "off"),
        sshOpen: (kind, name) => call("ssh-open", `--kind=${kind}`, ...(name ? [`--name=${name}`] : [])),
        // Presets: {message}; das Preset geht als JSON in --data. Fehler kommen als Ausnahme mit lesbarem Grund.
        preset: (action, options) => JSON.parse(call("presets", action, "--json",
            ...Object.keys(options || {}).filter((key) => options[key]).map((key) =>
                `--${key}=${typeof options[key] === "object" ? JSON.stringify(options[key]) : options[key]}`))),
        // Suchordner: {message, warning}; Fehler kommen als Ausnahme mit lesbarem Grund.
        folder: (action, options) => JSON.parse(call("folders", action, "--json",
            ...Object.keys(options || {}).filter((key) => options[key]).map((key) => `--${key}=${options[key]}`))),
        // Ergebnis ist immer {code, out, err}: Exit-Code 2 von "join" heißt "noch nicht freigegeben".
        ssh: (action, line) => JSON.parse(call("_ssh", action, ...(line === undefined ? [] : [`--line=${line}`]))),
    };
}

// ---------------------------------------------------------------- Ablauf (ohne Widgets)

// Auswahl für Local Dev im Dialog: "Kein Local Dev" und jede startbare Kombination. Ein gespeicherter Wert, den es nicht mehr
// gibt (Anbieter deinstalliert), bleibt als eigener Eintrag stehen, damit Speichern ihn nicht stillschweigend löscht.
function localDevChoices(options, saved, withNone = true) {
    const used = new Set();
    const unique = (text) => {
        let result = text;
        for (let n = 2; used.has(result); n += 1) result = `${text} (${n})`;   // NSPopUpButton ersetzt gleiche Titel
        used.add(result);
        return result;
    };
    const choices = withNone ? [{ label: unique("Kein Local Dev"), value: null }] : [];
    options.forEach((option) => choices.push({
        // Die Einstellung zeigt auch Nicht-Installiertes; der Workspace-Dialog bekommt nur Startbares (dann entfällt der Zusatz).
        label: unique(`${option.providerName} · ${option.model}${option.local ? "" : " (nicht lokal)"} → ${option.frameworkName}` +
            `${option.providerReady === false ? " · Anbieter fehlt" : ""}${option.frameworkReady === false ? " · CLI fehlt" : ""}`),
        value: { provider: option.provider, model: option.model, framework: option.framework },
    }));
    const same = (a, b) => a.provider === b.provider && a.model === b.model && a.framework === b.framework;
    if (saved && !choices.some((choice) => choice.value && same(choice.value, saved))) {
        choices.push({ label: unique(`${saved.provider} · ${saved.model} → ${saved.framework} (nicht verfügbar)`), value: saved });
    }
    return choices.map((choice) => Object.assign(choice, { selected: choice.value ? Boolean(saved) && same(choice.value, saved) : !saved }));
}

function editLoop(ui, backend, state, existing) {
    let draft = existing
        ? { name: existing.name, projects: existing.projects.slice(), shortcut: existing.shortcut }
        : { name: "", projects: [], shortcut: false };
    let message = "";
    // Local Dev nur anbieten, wenn das Modul da ist und etwas startbar ist (oder schon etwas gespeichert ist).
    let local = null;
    try {
        const found = backend.localDevOptions();
        if (found.error) message = found.error;
        if (found.available && (found.options.length || (existing && existing.localDev))) {
            local = { choices: localDevChoices(found.options, existing && existing.localDev ? existing.localDev : null) };
            draft.localDev = existing && existing.localDev ? existing.localDev : null;
        }
    } catch (error) {
        message = cleanMessage(error);
    }
    for (;;) {
        const result = ui.edit(state, draft, existing, message, local);
        if (!result) return null;
        if (result.remove) {
            if (ui.confirmDelete(existing.name)) {
                backend.remove(existing.name);
                return null;
            }
            message = "";
            continue;
        }
        try {
            backend.save(Object.assign({
                name: result.name, projects: result.projects, shortcut: result.shortcut,
                renameFrom: existing ? existing.name : null,
            }, result.localDev === undefined ? {} : { localDev: result.localDev }));
            return result.name;
        } catch (error) {
            // Eingaben behalten: wer einen doppelten Namen tippt, soll nicht alles neu anklicken.
            draft = result;
            message = cleanMessage(error);
        }
    }
}

// Der allgemeine Standard wird wie ein Repository-Preset bearbeitet, hat aber keinen Pfad: er gilt für jedes
// Repository ohne eigenes Preset (lokal wie remote) und wird in terminals.json unter "default" gespeichert.
const GENERAL_REPO = { name: "Allgemeiner Standard", path: null, remote: false, general: true };

// Was nach dem Zurücksetzen gilt, für die Rückfrage.
function resetEffect(presets, general) {
    if (general) return "Danach gelten wieder die eingebauten Standard-Terminals ohne Browser-Tabs.";
    return `Danach ${presets.general ? "gilt wieder der allgemeine Standard" : "starten wieder die Standard-Terminals"}. ` +
        "Das Repository selbst bleibt unberührt.";
}

function presetLoop(ui, backend, state, repo) {
    const presets = state.presets;
    const existing = repo.general ? presets.general || null : presets.items.find((item) => item.path === repo.path) || null;
    // Ohne eigenes Preset startet der Editor mit dem, was heute für dieses Repository wirklich läuft:
    // dem allgemeinen Standard, sonst den eingebauten Terminals.
    const base = existing || presets.general || { terminals: presets.defaults[repo.remote ? "remote" : "local"], urls: [] };
    let draft = { terminals: base.terminals.map((terminal) => Object.assign({}, terminal)), urls: base.urls.slice() };
    if (draft.terminals.length > PRESET_ROWS.max) {
        ui.error(`Dieses Preset hat mehr als ${PRESET_ROWS.max} Terminals. Ändere es im Setup (Terminals ändern).`);
        return;
    }
    let note = "";
    for (;;) {
        const result = ui.editPreset(repo, draft, Boolean(existing), note);
        if (!result) return;
        if (result.reset) {
            if (ui.confirmResetPreset(repo.name, resetEffect(presets, repo.general))) {
                if (repo.general) backend.preset("reset-general");
                else backend.preset("reset", { path: repo.path });
                return;
            }
            note = "";
            continue;
        }
        try {
            const data = { terminals: result.terminals, urls: result.urls };
            if (repo.general) backend.preset("save-general", { data });
            else backend.preset("save", { path: repo.path, data });
            return;
        } catch (error) {
            // Eingaben behalten: ein Tippfehler im Unterordner soll nicht alles neu ausfüllen lassen.
            draft = result;
            note = cleanMessage(error);
        }
    }
}

function sshItems(ssh) {
    const items = ssh.hosts.map((host) => ({
        kind: "host", name: host.host, title: host.host,
        detail: `${host.root} · ${host.repos} ${host.repos === 1 ? "Repository" : "Repositories"}`,
        label: `${host.host} — ${host.root} · ${host.repos} Repositories`,
    }));
    if (ssh.mac) {
        const who = ssh.mac.user ? `${ssh.mac.user}@${ssh.mac.host}` : ssh.mac.host;
        items.push({ kind: "mac", name: ssh.mac.host, title: who, detail: "Mac · direkter Zugang", label: `${who} (Mac)` });
    }
    return items;
}

function allowLine(output) {
    const match = /^\s*(workspace remote ssh allow .+)$/m.exec(output);
    return match ? match[1] : "";
}

function newConnection(ui, backend, ssh) {
    const kinds = [];
    if (ssh.guided) kinds.push("guided");
    if (ssh.share) kinds.push("line");
    const kind = ui.newKind(kinds);
    if (!kind) return false;
    if (kind === "guided") {
        backend.sshOpen("guided");
        return true;
    }
    const line = ui.askLine("Mit anderem Mac verbinden",
        "Füge die Zeile ein, die der andere Mac unter „Diesen Mac freigeben…“ anzeigt. Sie beginnt mit „workspace remote ssh join“.");
    if (line === null) return false;
    const result = backend.ssh("join", line);
    if (result.code === 0) {
        ui.info(result.out);
    } else if (result.code === 2) {
        ui.info("Noch nicht freigegeben.\n\nÖffne auf dem anderen Mac VibeCode Workspace → Bereich SSH → Diesen Mac freigeben… → Schlüssel eintragen… " +
            "und füge diese Zeile ein (sie liegt in der Zwischenablage):\n\n" + allowLine(result.out) +
            "\n\nDanach hier im Bereich SSH auf Verbinden klicken.");
    } else {
        ui.error(result.err || result.out);
    }
    return false;
}

function allowFlow(ui, backend) {
    const line = ui.askLine("Schlüssel eintragen",
        "Füge die Zeile ein, die der andere Mac anzeigt. Sie beginnt mit „workspace remote ssh allow“.");
    if (line === null) return;
    const check = backend.ssh("allow-check", line);
    if (check.code !== 0) {
        ui.error(check.err || check.out);
        return;
    }
    const key = JSON.parse(check.out);
    if (key.known) {
        ui.info(`„${key.name}“ ist schon freigegeben.`);
        return;
    }
    if (!ui.confirmAllow(key.name, key.fingerprint)) return;
    const done = backend.ssh("allow", line);
    if (done.code === 0) ui.info(`Freigegeben: ${key.name}.\n\nAuf dem anderen Mac jetzt im Bereich SSH auf Verbinden klicken.`);
    else ui.error(done.err || done.out);
}

function shareFlow(ui, backend) {
    let result = backend.ssh("share");
    for (;;) {
        if (result.code !== 0) {
            ui.error(result.err || result.out);
            return;
        }
        // Das Modul liefert den Zustand als JSON; die Maske zeigt daraus nur, was gerade zu tun ist.
        let share;
        try {
            share = JSON.parse(result.out);
        } catch (error) {
            ui.error("Die Antwort des Remote-Moduls war nicht lesbar.");
            return;
        }
        const choice = ui.share(share);
        if (choice === "wake") {
            result = backend.ssh("share-wake");
        } else if (choice === "recheck") {
            result = backend.ssh("share-recheck");           // ohne die Systemeinstellungen noch einmal zu öffnen
        } else if (choice === "allow") {
            allowFlow(ui, backend);
            return;
        } else {
            return;
        }
    }
}

// Eine Aktion aus der Übersicht. true = das Fenster hat seine Arbeit getan und kann schließen
// (ein Workspace oder ein Terminal wurde gestartet).
function perform(ui, backend, state, choice) {
    switch (choice.action) {
    case "start":
        backend.start(choice.name);
        return true;
    case "new":
    case "edit": {
        if (!state.projects.length) {
            ui.error("Der Launcher kennt noch keine Projekte. Füge unter „Repository-Suche“ einen Ordner mit deinen Repositories hinzu.");
            return false;
        }
        const existing = choice.action === "edit"
            ? state.workspaces.find((workspace) => workspace.name === choice.name) : null;
        editLoop(ui, backend, state, existing);
        return false;
    }
    case "sync":
        ui.info(backend.syncShortcuts());
        return false;
    case "setting":
        backend.setting(choice.name, choice.enabled);
        return false;
    case "open":
        backend.open(choice.id);
        return true;
    case "connect":
        backend.sshOpen(choice.item.kind, choice.item.name);
        return true;
    case "addFolder": {
        const chosen = ui.pickFolders();
        if (!chosen || !chosen.length) return false;
        const lines = [];
        chosen.forEach((path) => {
            try {
                const result = backend.folder("add", { path });
                lines.push(result.message + (result.warning ? `\n⚠︎ ${result.warning}` : ""));
            } catch (error) {
                lines.push(`${path}\n⚠︎ ${cleanMessage(error)}`);
            }
        });
        ui.info(lines.join("\n\n"));
        return false;
    }
    case "addRemoteFolder": {
        const entry = ui.askRemoteFolder("");
        if (!entry) return false;
        const result = backend.folder("add-remote", { host: entry.host, root: entry.root });
        ui.info(result.message + (result.warning
            ? `\n\n⚠︎ ${result.warning}\n\nDie Anmeldung ohne Passwort richtest du im Bereich SSH unter „Neue Verbindung…“ → Geführte Einrichtung ein.`
            : ""));
        return false;
    }
    case "quickOpen":
        backend.folder("quick-open", { path: choice.path, mode: choice.enabled ? "on" : "off" });
        return false;
    case "quickWorkspace":
        backend.quickWorkspace(choice.name, choice.enabled);
        return false;
    case "localSetup": {
        const found = backend.localSettings();
        if (found.error) {
            ui.error(found.error);
            return false;
        }
        if (!found.options.length) {
            ui.info("Local Dev kennt keine passende Kombination aus Anbieter, Modell und CLI. Prüfe die Einrichtung unter „Öffnen“ (Local Dev → --setup).");
            return false;
        }
        const chosen = ui.pickLocalDev(localDevChoices(found.options, found.current, false));
        if (chosen) backend.setLocalDefault(chosen);          // die Zeile zeigt den neuen Stand, sobald die Übersicht neu aufgebaut ist
        return false;
    }
    case "removeFolder": {
        const remote = choice.kind === "remote";
        if (!ui.confirmRemoveFolder(choice.label)) return false;
        backend.folder(remote ? "remove-remote" : "remove", remote ? { host: choice.host } : { path: choice.path });
        return false;
    }
    case "editGeneralPreset":
        presetLoop(ui, backend, state, GENERAL_REPO);
        return false;
    case "newPreset":
    case "editPreset": {
        const repos = state.presets.repos;
        const repo = choice.action === "editPreset" ? repos.find((entry) => entry.path === choice.path) : ui.pickRepo(repos);
        if (repo) presetLoop(ui, backend, state, repo);
        return false;
    }
    case "resetPreset":
        if (ui.confirmResetPreset(choice.label, resetEffect(state.presets, false))) backend.preset("reset", { path: choice.path });
        return false;
    case "resetGeneralPreset":
        if (ui.confirmResetPreset(GENERAL_REPO.name, resetEffect(state.presets, true))) backend.preset("reset-general");
        return false;
    case "movePreset":
        if (ui.confirmMovePreset(choice.label, choice.toLabel)) {
            backend.preset("move", { path: choice.path, to: choice.to });
        }
        return false;
    case "sshNew":
        return newConnection(ui, backend, state.ssh);
    case "sshShare":
        shareFlow(ui, backend);
        return false;
    default:
        return false;
    }
}

function flow(ui, backend) {
    for (;;) {
        let state;
        try {
            state = backend.state();
        } catch (error) {
            ui.error(cleanMessage(error));
            return;
        }
        const choice = ui.dashboard(state);
        if (!choice || choice.action === "close") return;
        try {
            if (perform(ui, backend, state, choice)) return;
        } catch (error) {
            ui.error(cleanMessage(error));
        }
    }
}

// ---------------------------------------------------------------- Übersicht (Modell, ohne Widgets)

function dashboardModel(state) {
    const rows = [{ type: "title", text: "VibeCode Workspace",
        sub: "Was eingerichtet ist, siehst du hier. Alles Weitere ist ein Klick entfernt." }];

    rows.push({ type: "section", text: "Workspaces" });
    if (!state.workspaces.length) rows.push({ type: "note", text: "Noch kein Workspace angelegt." });
    state.workspaces.forEach((workspace) => {
        // Das Wichtige zuerst: bei langen Projektlisten wird das Ende der Zeile gekürzt.
        const detail = [workspace.shortcut ? "Schreibtisch ✓" : "kein Shortcut"];
        if (workspace.quickOpen) detail.push("Quick ✓");
        if (workspace.localDev) detail.push("Local Dev ✓");
        if (workspace.missing.length) detail.push(`⚠︎ nicht gefunden: ${workspace.missing.join(", ")}`);
        detail.push(workspace.projects.join(", "));
        rows.push({
            type: "item", title: workspace.name, detail: detail.join(" · "),
            level: workspace.missing.length ? "warn" : "ok",
            // Quick-Öffnen: das Kästchen legt einen zweiten Shortcut an, der die Projekte zum Ankreuzen zeigt statt alles zu starten.
            buttons: [{ label: "Quick-Öffnen", checkbox: true, checked: Boolean(workspace.quickOpen),
                    action: { action: "quickWorkspace", name: workspace.name, enabled: !workspace.quickOpen } },
                { label: "Starten", action: { action: "start", name: workspace.name } },
                { label: "Bearbeiten…", action: { action: "edit", name: workspace.name } }],
        });
    });
    rows.push({
        type: "footer",
        buttons: [{ label: "Workspace anlegen…", action: { action: "new" } }].concat(
            state.canLaunch ? [{ label: "Einmaliger Workspace…", action: { action: "open", id: "launch" } }] : [],
            state.workspaces.some((workspace) => workspace.shortcut || workspace.quickOpen)
                ? [{ label: "Shortcuts erneuern", action: { action: "sync" } }] : []),
    });

    const folders = state.folders;
    if (folders && (folders.canAddLocal || folders.canAddRemote || folders.local.length || folders.remote.length)) {
        rows.push({ type: "section", text: "Repository-Suche" });
        if (!folders.local.length && !folders.remote.length) {
            rows.push({ type: "note", text: "Noch kein Suchordner: füge einen Ordner mit deinen Repositories hinzu." });
        }
        const repositories = (count) => `${count} ${count === 1 ? "Repository" : "Repositories"}`;
        folders.local.forEach((folder) => {
            let detail = `Lokal · ${repositories(folder.repos)}`;
            let level = "ok";
            if (!folder.exists) { detail = "⚠︎ Ordner nicht gefunden"; level = "warn"; }
            else if (folder.truncated) { detail += " · ⚠︎ Ordner sehr groß, Suche abgebrochen"; level = "warn"; }
            else if (!folder.repos) { detail = "Lokal · ⚠︎ keine Repositories gefunden"; level = "warn"; }
            // Quick-Öffnen: das Kästchen legt einen Shortcut auf dem Schreibtisch an (oder entfernt ihn). Ein Doppelklick darauf
            // zeigt die Repositories dieses Ordners zum Ankreuzen und öffnet sie.
            if (folder.quickOpen && folder.shortcut && level === "ok") detail += ` · Schreibtisch: „${folder.shortcut}“`;
            const buttons = [];
            if (folder.exists) {
                buttons.push({ label: "Quick-Öffnen", checkbox: true, checked: Boolean(folder.quickOpen),
                    action: { action: "quickOpen", path: folder.path, enabled: !folder.quickOpen } });
            }
            buttons.push({ label: "Entfernen", action: { action: "removeFolder", kind: "local", path: folder.path, label: folder.path } });
            rows.push({ type: "item", title: folder.path, detail, level, middle: true, buttons });
        });
        folders.remote.forEach((folder) => rows.push({
            type: "item", title: `${folder.host}:${folder.root}`, middle: true,
            detail: folder.repos ? `SSH · ${repositories(folder.repos)} (zuletzt gefunden)` : "SSH · ⚠︎ noch keine Repositories gefunden",
            level: folder.repos ? "ok" : "warn",
            buttons: [{ label: "Entfernen", action: { action: "removeFolder", kind: "remote", host: folder.host,
                label: `${folder.host}:${folder.root}` } }],
        }));
        (folders.errors || []).forEach((text) => rows.push({ type: "note", text: `⚠︎ ${text}`, level: "warn" }));
        const footer = [];
        if (folders.canAddLocal) footer.push({ label: "Ordner hinzufügen…", action: { action: "addFolder" } });
        if (folders.canAddRemote) footer.push({ label: "Remote-Ordner hinzufügen…", action: { action: "addRemoteFolder" } });
        if (footer.length) rows.push({ type: "footer", buttons: footer });
    }

    const presets = state.presets;
    if (presets && presets.available) {
        rows.push({ type: "section", text: "Presets pro Repository" });
        const summary = (entry) => `${entry.terminals.map((terminal) => terminal.name).join(", ") || "keine Terminals"} · ` +
            `${entry.urls.length} ${entry.urls.length === 1 ? "Browser-Tab" : "Browser-Tabs"}`;
        // Der allgemeine Standard gilt für jedes Repository ohne eigenes Preset: erst der eigene, sonst die eingebauten.
        if (presets.general) {
            rows.push({
                type: "item", title: GENERAL_REPO.name, detail: summary(presets.general), level: "ok",
                buttons: [{ label: "Bearbeiten…", action: { action: "editGeneralPreset" } },
                    { label: "Zurücksetzen", action: { action: "resetGeneralPreset" } }],
            });
        } else {
            const defaults = presets.defaults.local.map((terminal) => terminal.name).join(", ");
            rows.push({
                type: "item", title: GENERAL_REPO.name, level: "off",
                detail: `Eingebaut: ${defaults || "Standard-Terminals"}`,
                buttons: [{ label: "Festlegen…", action: { action: "editGeneralPreset" } }],
            });
        }
        presets.items.forEach((item) => rows.push({
            type: "item", title: item.name, detail: summary(item), level: "ok",
            buttons: [{ label: "Bearbeiten…", action: { action: "editPreset", path: item.path } },
                { label: "Zurücksetzen", action: { action: "resetPreset", path: item.path, label: item.name } }],
        }));
        presets.orphans.forEach((orphan) => rows.push({
            type: "item", title: orphan.name, level: "warn",
            detail: `⚠︎ Repository nicht mehr gefunden${orphan.suggestion ? ` · neuer Ort: ${orphan.suggestion.path}` : ""} · ${summary(orphan)}`,
            buttons: (orphan.suggestion ? [{ label: "Übernehmen", action: {
                action: "movePreset", path: orphan.path, to: orphan.suggestion.path, label: orphan.name, toLabel: orphan.suggestion.path } }] : [])
                .concat([{ label: "Entfernen", action: { action: "resetPreset", path: orphan.path, label: orphan.name } }]),
        }));
        (presets.errors || []).forEach((text) => rows.push({ type: "note", text: `⚠︎ ${text}`, level: "warn" }));
        if (presets.repos.length) {
            rows.push({ type: "footer", buttons: [{ label: "Preset anlegen…", action: { action: "newPreset" } }] });
        }
    }

    if (state.ssh && state.ssh.available) {
        rows.push({ type: "section", text: "SSH" });
        const items = sshItems(state.ssh);
        if (!items.length) rows.push({ type: "note", text: "Noch keine Verbindung eingerichtet." });
        items.forEach((item) => rows.push({
            type: "item", title: item.title, detail: item.detail, level: "ok",
            buttons: [{ label: "Verbinden", action: { action: "connect", item } }],
        }));
        (state.ssh.errors || []).forEach((text) => rows.push({ type: "note", text: `⚠︎ ${text}`, level: "warn" }));
        const footer = [{ label: "Neue Verbindung…", action: { action: "sshNew" } }];
        if (state.ssh.share) footer.push({ label: "Diesen Mac freigeben…", action: { action: "sshShare" } });
        rows.push({ type: "footer", buttons: footer });
    }

    const wake = state.settings && state.settings.wake;
    if (wake || state.entries.length) {
        rows.push({ type: "section", text: "App-Einstellungen" });
        if (wake) {
            rows.push({ type: "item", title: "Wachhalten & Apps", detail: wake.text, level: wake.level,
                buttons: (typeof wake.enabled === "boolean"
                    ? [{ label: wake.enabled ? "Ausschalten" : "Einschalten",
                        action: { action: "setting", name: "keep-awake", enabled: !wake.enabled } }] : [])
                    .concat([{ label: "Apps wählen…", action: { action: "open", id: "remote" } }]) });
            rows.push({ type: "note", text: "Ein: Mac bleibt wach, gewählte Apps starten. Aus: gewählte Apps werden beendet." });
        }
        state.entries.forEach((entry) => rows.push({
            type: "item", title: entry.title, detail: entry.status ? entry.status.text : "",
            level: entry.status ? entry.status.level : "none",
            buttons: (entry.id === "local" ? [{ label: "Einstellen…", action: { action: "localSetup" } }] : [])
                .concat([{ label: "Öffnen", action: { action: "open", id: entry.id } }]),
        }));
    }
    return rows;
}

// ---------------------------------------------------------------- Widgets

// Einziger Ort, an dem ein Fenster wirklich angezeigt wird; Tests ersetzen ihn.
function present(alert, widgets) {
    return alert.runModal;
}

// JXA liefert NSInteger-Werte (auch die Button-Konstanten) als Text; ein Vergleich mit === ist
// nur dann richtig, wenn beide Seiten dieselbe Darstellung haben. Daher immer als Zahl vergleichen.
function isButton(response, constant) {
    return Number(response) === Number(constant);
}

function label(text, frame, bold) {
    const field = $.NSTextField.alloc.initWithFrame(frame);
    field.stringValue = $(text);
    field.bezeled = false;
    field.drawsBackground = false;
    field.editable = false;
    field.selectable = false;
    if (bold) field.font = $.NSFont.boldSystemFontOfSize(12);
    return field;
}

function buildEdit(state, draft, existing, message, local) {
    const names = state.projects.concat(draft.projects.filter((name) => !state.projects.includes(name)));
    const listHeight = Math.min(Math.max(names.length, 1) * ROW, 220);
    const total = 18 + 8 + 24 + 14 + 18 + 6 + listHeight + 14 + 24 + (local ? 62 : 0);
    const view = $.NSView.alloc.initWithFrame($.NSMakeRect(0, 0, WIDTH, total));
    let y = total;

    y -= 18;
    view.addSubview(label("Name", $.NSMakeRect(0, y, WIDTH, 18), true));
    y -= 32;
    const field = $.NSTextField.alloc.initWithFrame($.NSMakeRect(0, y, WIDTH, 24));
    field.stringValue = $(draft.name);
    view.addSubview(field);

    y -= 32;
    view.addSubview(label("Projekte", $.NSMakeRect(0, y + 14, WIDTH, 18), true));
    y -= listHeight - 8;
    const list = $.NSView.alloc.initWithFrame($.NSMakeRect(0, 0, WIDTH, names.length * ROW));
    const boxes = names.map((name, index) => {
        const known = state.projects.includes(name);
        const box = $.NSButton.alloc.initWithFrame($.NSMakeRect(8, names.length * ROW - (index + 1) * ROW, WIDTH - 16, ROW));
        box.setButtonType($.NSSwitchButton);
        box.title = $(known ? name : `${name} (nicht gefunden)`);
        box.state = draft.projects.includes(name) ? $.NSControlStateValueOn : $.NSControlStateValueOff;
        list.addSubview(box);
        return box;
    });
    const scroll = $.NSScrollView.alloc.initWithFrame($.NSMakeRect(0, y, WIDTH, listHeight));
    scroll.hasVerticalScroller = true;
    scroll.documentView = list;
    scroll.contentView.scrollToPoint($.NSMakePoint(0, Math.max(0, names.length * ROW - listHeight)));
    view.addSubview(scroll);

    y -= 38;
    const shortcut = $.NSButton.alloc.initWithFrame($.NSMakeRect(0, y, WIDTH, 24));
    shortcut.setButtonType($.NSSwitchButton);
    shortcut.title = $("Shortcut auf dem Schreibtisch anlegen");
    shortcut.state = draft.shortcut ? $.NSControlStateValueOn : $.NSControlStateValueOff;
    view.addSubview(shortcut);

    let localPopup = null;
    if (local) {
        y -= 30;
        view.addSubview(label("Local Dev: zusätzliches Terminal mit lokalem Modell, im ersten Repository der Auswahl", $.NSMakeRect(0, y, WIDTH, 18), true));
        y -= 32;
        localPopup = $.NSPopUpButton.alloc.initWithFramePullsDown($.NSMakeRect(0, y, WIDTH, 26), false);
        local.choices.forEach((choice) => localPopup.addItemWithTitle($(choice.label)));
        local.choices.forEach((choice, index) => { if (choice.selected) localPopup.selectItemAtIndex(index); });
        view.addSubview(localPopup);
    }

    const alert = $.NSAlert.alloc.init;
    alert.messageText = $(existing ? `Workspace „${existing.name}“ bearbeiten` : "Workspace anlegen");
    alert.informativeText = $(message || "Ein Workspace ist eine benannte Auswahl von Projekten. Mit Shortcut startet er per Doppelklick vom Schreibtisch, ohne Auswahldialog.");
    alert.accessoryView = view;
    alert.addButtonWithTitle($("Speichern"));
    alert.addButtonWithTitle($("Abbrechen"));
    if (existing) alert.addButtonWithTitle($("Löschen…"));
    return { alert, field, boxes, names, shortcut, local: localPopup ? { popup: localPopup, choices: local.choices } : null };
}

function collectEdit(built) {
    const result = {
        name: ObjC.unwrap(built.field.stringValue).trim(),
        projects: built.names.filter((_, index) => built.boxes[index].state === $.NSControlStateValueOn),
        shortcut: built.shortcut.state === $.NSControlStateValueOn,
    };
    // Ohne Auswahlmenü bleibt localDev ungesetzt: Speichern lässt Local Dev dann unverändert.
    if (built.local) result.localDev = built.local.choices[Number(built.local.popup.indexOfSelectedItem)].value;
    return result;
}

function buildLocalDevSetting(choices) {
    const popup = $.NSPopUpButton.alloc.initWithFramePullsDown($.NSMakeRect(0, 0, 540, 26), false);   // breit: die Hinweise stehen am Ende
    choices.forEach((choice) => popup.addItemWithTitle($(choice.label)));
    const current = choices.findIndex((choice) => choice.selected);
    popup.selectItemAtIndex(current >= 0 ? current : 0);
    const alert = $.NSAlert.alloc.init;
    alert.messageText = $("Local Dev einstellen");
    alert.informativeText = $("Das ist die Vorauswahl beim Start von Local Dev: Anbieter (MLX oder Ollama), Modell und CLI " +
        "(OpenCode, Codex, Claude). Nicht installierte Einträge lassen sich einstellen und starten, sobald sie installiert sind. " +
        "Für einen einzelnen Workspace wählst du Local Dev im Dialog des Workspaces.");
    alert.accessoryView = popup;
    alert.addButtonWithTitle($("Speichern"));
    alert.addButtonWithTitle($("Abbrechen"));
    return { alert, popup, choices };
}

function buildPresetEditor(repo, draft, custom, note) {
    const count = Math.max(PRESET_ROWS.min, Math.min(PRESET_ROWS.max, draft.terminals.length));
    const rowHeight = 28;
    const total = 20 + count * rowHeight + 12 + 18 + 4 + 24;
    const view = $.NSView.alloc.initWithFrame($.NSMakeRect(0, 0, PRESET_WIDTH, total));
    const columns = [[0, 130, "Terminal"], [140, 110, "Name"], [260, 250, "Startprompt oder Befehl"], [520, 120, "Unterordner"]];
    columns.forEach(([x, width, title]) => view.addSubview(label(title, $.NSMakeRect(x, total - 18, width, 16), true)));
    const rows = [];
    for (let index = 0; index < count; index += 1) {
        const terminal = draft.terminals[index];
        const y = total - 20 - (index + 1) * rowHeight + 2;
        const popup = $.NSPopUpButton.alloc.initWithFramePullsDown($.NSMakeRect(0, y, 130, 24), false);
        ["–"].concat(PRESET_TYPES).forEach((type) => popup.addItemWithTitle($(type)));
        if (terminal) popup.selectItemWithTitle($(terminal.type));
        const field = (x, width, value, placeholder) => {
            const input = $.NSTextField.alloc.initWithFrame($.NSMakeRect(x, y, width, 24));
            input.stringValue = $(value || "");
            input.placeholderString = $(placeholder);
            view.addSubview(input);
            return input;
        };
        view.addSubview(popup);
        rows.push({ popup, name: field(140, 110, terminal && terminal.name, "Name"),
            prompt: field(260, 250, terminal && terminal.prompt, "leer = ohne Vorgabe"),
            cwd: field(520, 120, terminal && terminal.cwd, "z. B. frontend") });
    }
    const tabsY = 0;
    view.addSubview(label("Browser-Tabs (mit Komma trennen, mit http:// oder https://)", $.NSMakeRect(0, tabsY + 28, PRESET_WIDTH, 16), true));
    const urls = $.NSTextField.alloc.initWithFrame($.NSMakeRect(0, tabsY, PRESET_WIDTH, 24));
    urls.stringValue = $(draft.urls.join(", "));
    view.addSubview(urls);
    const alert = $.NSAlert.alloc.init;
    alert.messageText = $(`Preset · ${repo.name}`);
    const scope = repo.general
        ? "Welche Terminals und Browser-Tabs starten für jedes Repository, das kein eigenes Preset hat? Ein Unterordner, den ein Repository nicht hat, wird dort übersprungen (Start im Repository-Ordner). "
        : "Welche Terminals und Browser-Tabs starten für dieses Repository? ";
    alert.informativeText = $(note || `${scope}Typ „–“ lässt die Zeile aus. ` +
        "Claude Code und Antigravity starten ohne Sicherheitsabfragen, beide Codex-Profile mit vollem Zugriff ohne Sandbox.");
    alert.accessoryView = view;
    alert.addButtonWithTitle($("Speichern"));
    alert.addButtonWithTitle($("Abbrechen"));
    if (custom) alert.addButtonWithTitle($("Standard wiederherstellen"));
    return { alert, rows, urls };
}

function collectPreset(built) {
    return {
        terminals: built.rows.filter((row) => ObjC.unwrap(row.popup.titleOfSelectedItem) !== "–").map((row) => ({
            type: ObjC.unwrap(row.popup.titleOfSelectedItem), name: ObjC.unwrap(row.name.stringValue).trim(),
            prompt: ObjC.unwrap(row.prompt.stringValue), cwd: ObjC.unwrap(row.cwd.stringValue).trim(),
        })),
        urls: ObjC.unwrap(built.urls.stringValue).split(",").map((url) => url.trim()).filter(Boolean),
    };
}

function buildRemoteFolder(note, draft) {
    const view = $.NSView.alloc.initWithFrame($.NSMakeRect(0, 0, WIDTH, 118));
    view.addSubview(label("SSH-Host (Alias aus ~/.ssh/config oder benutzer@host)", $.NSMakeRect(0, 100, WIDTH, 18), true));
    const host = $.NSTextField.alloc.initWithFrame($.NSMakeRect(0, 70, WIDTH, 24));
    host.stringValue = $(draft.host);
    view.addSubview(host);
    view.addSubview(label("Ordner auf dem Server (leer = Home-Verzeichnis)", $.NSMakeRect(0, 44, WIDTH, 18), true));
    const root = $.NSTextField.alloc.initWithFrame($.NSMakeRect(0, 14, WIDTH, 24));
    root.stringValue = $(draft.root);
    view.addSubview(root);
    const alert = $.NSAlert.alloc.init;
    alert.messageText = $("Remote-Ordner hinzufügen");
    alert.informativeText = $(note || "VibeCode sucht auf dem Server in diesem Ordner nach Git-Repositories, auch in Unterordnern. Die Anmeldung muss ohne Passwortabfrage möglich sein.");
    alert.accessoryView = view;
    alert.addButtonWithTitle($("Hinzufügen"));
    alert.addButtonWithTitle($("Abbrechen"));
    return { alert, host, root };
}

const KIND_TITLES = {
    guided: "Geführte Einrichtung im Terminal (Host, Schlüssel, Repository-Suche)",
    line: "Mit der Zeile eines anderen Macs verbinden (ohne Passwort)",
};

// Die Freigabe-Maske: kurz und je nach Zustand. Aus: nur das Eine, was fehlt. An: Status, die Zeile für den anderen Mac in einem
// eigenen, markierbaren Feld und die zwei Schritte. Keine Terminal-Befehle: die gehören in die Doku, nicht in diese Maske.
function wrappingText(text, frame, mono) {
    const field = $.NSTextField.wrappingLabelWithString($(text));
    field.frame = frame;
    if (mono) field.font = $.NSFont.monospacedSystemFontOfSizeWeight(11, 0);
    return field;
}

function buildShare(share) {
    const alert = $.NSAlert.alloc.init;
    alert.messageText = $("Diesen Mac freigeben");
    let actions;
    let line = null;
    if (!share.remoteLogin) {
        alert.informativeText = $("Noch nicht bereit: „Entfernte Anmeldung“ ist ausgeschaltet.\n\n" +
            "Schalte sie in den Systemeinstellungen ein (Allgemein → Teilen → Entfernte Anmeldung). Die Einstellungen sind geöffnet. " +
            "Danach hier auf „Erneut prüfen“ klicken.");
        actions = ["recheck", "done"];
    } else {
        const status = ["Bereit: Dieser Mac nimmt SSH-Verbindungen an. ✓",
            share.awake ? "Wachhalten: an ✓" : "Wachhalten: aus. Der Mac kann einschlafen, dann ist er per SSH nicht erreichbar."];
        if (!share.fingerprint) status.push("⚠︎ Der Host-Schlüssel ist nicht lesbar: der andere Mac kann den Fingerprint nicht prüfen.");
        alert.informativeText = $(`${status.join("\n")}\n\n1. Auf dem anderen Mac: VibeCode → SSH → Neue Verbindung… → ` +
            `„Mit der Zeile eines anderen Macs verbinden“ und diese Zeile einfügen ` +
            `${share.copied ? "(sie liegt in der Zwischenablage):" : "(das Kopieren hat nicht geklappt, markiere sie und kopiere sie selbst):"}`);
        const view = $.NSView.alloc.initWithFrame($.NSMakeRect(0, 0, WIDTH, 102));
        line = wrappingText(share.line, $.NSMakeRect(0, 52, WIDTH, 50), true);
        line.selectable = true;
        view.addSubview(line);
        view.addSubview(wrappingText("2. Der andere Mac zeigt dann eine Zeile. Klicke hier auf „Schlüssel eintragen…“ und füge sie ein.",
            $.NSMakeRect(0, 0, WIDTH, 40), false));
        alert.accessoryView = view;
        actions = ["allow"].concat(share.awake ? [] : ["wake"], ["done"]);
    }
    const titles = { allow: "Schlüssel eintragen…", wake: "Wach halten", recheck: "Erneut prüfen", done: "Fertig" };
    actions.forEach((action) => alert.addButtonWithTitle($(titles[action])));
    return { alert, actions, line };
}

// ---------------------------------------------------------------- Übersicht (Widgets)

const PANEL = 640;
const PAD = 20;
const BUTTON_WIDTH = 112;
const BAR = 52;

// So hoch, wie der Bildschirm es zulässt: die Knöpfe am Ende eines Bereichs sollen nicht erst hinter dem Scrollen liegen.
function maxContent() {
    const screen = $.NSScreen.mainScreen;
    const available = screen ? Number(screen.visibleFrame.size.height) : 800;
    return Math.max(420, Math.min(780, Math.floor(available - 140)));
}
const HEIGHTS = { title: 64, section: 38, item: 52, note: 26, footer: 42 };

// Knöpfe im Fenster brauchen ein Ziel für ihre Aktion. Das Ergebnis wandert in dashboardAction;
// danach beendet das Fenster seine modale Schleife.
let dashboardActions = [];
let dashboardAction = null;
ObjC.registerSubclass({
    name: "VibeWorkspaceHandler",
    superclass: "NSObject",
    methods: {
        "act:": {
            types: ["void", ["id"]],
            implementation: function (sender) {
                dashboardAction = dashboardActions[Number(sender.tag)] || { action: "close" };
                $.NSApp.stopModalWithCode(1);
            },
        },
        "windowWillClose:": {
            types: ["void", ["id"]],
            implementation: function () {
                if (!dashboardAction) dashboardAction = { action: "close" };
                $.NSApp.stopModalWithCode(0);
            },
        },
    },
});

function levelColor(level) {
    if (level === "ok") return $.NSColor.systemGreenColor;
    if (level === "warn") return $.NSColor.systemOrangeColor;
    return $.NSColor.tertiaryLabelColor;
}

function styled(text, frame, options) {
    const { bold = false, size = 12, color = null, truncate = false, middle = false } = options || {};
    const field = label(text, frame, false);
    field.font = bold ? $.NSFont.boldSystemFontOfSize(size) : $.NSFont.systemFontOfSize(size);
    field.textColor = color || $.NSColor.labelColor;
    if (truncate) {
        // Pfade in der Mitte kürzen: das Ende (der Ordnername) ist das Wichtige.
        field.lineBreakMode = middle ? $.NSLineBreakByTruncatingMiddle : $.NSLineBreakByTruncatingTail;
        field.toolTip = $(text);
    }
    return field;
}

function buildDashboard(rows) {
    const handler = $.VibeWorkspaceHandler.alloc.init;
    dashboardActions = [];
    dashboardAction = null;
    const buttons = [];
    const total = rows.reduce((sum, row) => sum + HEIGHTS[row.type], 12);
    const document = $.NSView.alloc.initWithFrame($.NSMakeRect(0, 0, PANEL, total));
    const makeButton = (title, x, y, width, action, checkbox) => {
        const view = $.NSButton.alloc.initWithFrame($.NSMakeRect(x, y, width, 26));
        view.title = $(title);
        if (checkbox) {
            view.setButtonType($.NSSwitchButton);
            view.state = checkbox.checked ? $.NSControlStateValueOn : $.NSControlStateValueOff;
        } else {
            view.bezelStyle = $.NSBezelStyleRounded;
        }
        view.tag = dashboardActions.length;
        view.target = handler;
        view.action = "act:";
        dashboardActions.push(action);
        buttons.push({ view, title, action });
        return view;
    };

    let y = total;
    rows.forEach((row) => {
        const height = HEIGHTS[row.type];
        y -= height;
        const inner = PANEL - 2 * PAD;
        if (row.type === "title") {
            document.addSubview(styled(row.text, $.NSMakeRect(PAD, y + height - 38, inner, 28), { bold: true, size: 20 }));
            document.addSubview(styled(row.sub, $.NSMakeRect(PAD, y + height - 60, inner, 18),
                { color: $.NSColor.secondaryLabelColor }));
        } else if (row.type === "section") {
            document.addSubview(styled(row.text, $.NSMakeRect(PAD, y + 12, inner, 18), { bold: true, size: 13 }));
            const line = $.NSBox.alloc.initWithFrame($.NSMakeRect(PAD, y + 6, inner, 1));
            line.boxType = $.NSBoxSeparator;
            document.addSubview(line);
        } else if (row.type === "item") {
            const count = row.buttons.length;
            const textWidth = Math.max(120, PANEL - 2 * PAD - 20 - count * (BUTTON_WIDTH + 8));
            // Mit Detailzeile oben, ohne Detailzeile mittig neben den Knöpfen.
            const titleY = row.detail ? y + height - 28 : y + (height - 16) / 2;
            const dotY = row.detail ? y + height - 30 : y + (height - 18) / 2;
            if (row.level !== "none") {
                document.addSubview(styled("●", $.NSMakeRect(PAD, dotY, 14, 18), { size: 12, color: levelColor(row.level) }));
            }
            document.addSubview(styled(row.title, $.NSMakeRect(PAD + 20, titleY, textWidth, 16),
                { bold: true, truncate: true, middle: Boolean(row.middle) }));
            if (row.detail) {
                document.addSubview(styled(row.detail, $.NSMakeRect(PAD + 20, y + height - 46, textWidth, 15),
                    { size: 11, color: $.NSColor.secondaryLabelColor, truncate: true }));
            }
            row.buttons.forEach((button, index) => {
                const x = PANEL - PAD - BUTTON_WIDTH - (count - 1 - index) * (BUTTON_WIDTH + 8);
                document.addSubview(makeButton(button.label, x, y + (height - 26) / 2, BUTTON_WIDTH, button.action,
                    button.checkbox ? button : null));
            });
        } else if (row.type === "note") {
            document.addSubview(styled(row.text, $.NSMakeRect(PAD + 20, y + 4, inner - 20, 18),
                { color: row.level === "warn" ? $.NSColor.systemOrangeColor : $.NSColor.secondaryLabelColor, truncate: true }));
        } else if (row.type === "footer") {
            let x = PAD + 20;
            row.buttons.forEach((button) => {
                const width = Math.max(BUTTON_WIDTH, button.label.length * 8 + 28);
                document.addSubview(makeButton(button.label, x, y + 8, width, button.action));
                x += width + 8;
            });
        }
    });

    const visible = Math.min(total, maxContent());
    const window = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer(
        $.NSMakeRect(0, 0, PANEL, visible + BAR), $.NSWindowStyleMaskTitled | $.NSWindowStyleMaskClosable,
        $.NSBackingStoreBuffered, false);
    window.title = $("VibeCode Workspace");
    window.releasedWhenClosed = false;
    window.delegate = handler;
    const scroll = $.NSScrollView.alloc.initWithFrame($.NSMakeRect(0, BAR, PANEL, visible));
    scroll.hasVerticalScroller = true;
    scroll.drawsBackground = false;
    scroll.borderType = $.NSNoBorder;
    scroll.documentView = document;
    scroll.contentView.scrollToPoint($.NSMakePoint(0, Math.max(0, total - visible)));
    window.contentView.addSubview(scroll);
    const bar = $.NSBox.alloc.initWithFrame($.NSMakeRect(0, BAR - 1, PANEL, 1));
    bar.boxType = $.NSBoxSeparator;
    window.contentView.addSubview(bar);
    const close = makeButton("Schließen", PANEL - PAD - BUTTON_WIDTH, 13, BUTTON_WIDTH, { action: "close" });
    close.keyEquivalent = $("\u001b");
    window.contentView.addSubview(close);
    return { window, buttons, total };
}

// Einziger Ort, an dem die Übersicht wirklich angezeigt wird; Tests ersetzen ihn.
function presentDashboard(built) {
    dashboardAction = null;
    const application = $.NSApplication.sharedApplication;
    application.activateIgnoringOtherApps(true);
    built.window.center;
    application.runModalForWindow(built.window);
    built.window.orderOut(null);
    return dashboardAction || { action: "close" };
}

function nativeUi(app) {
    return {
        dashboard(state) {
            return presentDashboard(buildDashboard(dashboardModel(state)));
        },
        edit(state, draft, existing, message, local) {
            let note = message;
            let current = draft;
            for (;;) {
                const built = buildEdit(state, current, existing, note, local);
                const response = present(built.alert, built);
                if (isButton(response, $.NSAlertSecondButtonReturn)) return null;
                if (isButton(response, $.NSAlertThirdButtonReturn) && existing) return { remove: true };
                current = collectEdit(built);
                if (!current.name) note = "Gib dem Workspace einen Namen.";
                else if (!current.projects.length) note = "Wähle mindestens ein Projekt aus.";
                else return current;
            }
        },
        pickLocalDev(choices) {
            const built = buildLocalDevSetting(choices);
            const response = present(built.alert, built);
            if (!isButton(response, $.NSAlertFirstButtonReturn)) return null;
            return built.choices[Number(built.popup.indexOfSelectedItem)].value;
        },
        newKind(kinds) {
            const chosen = app.chooseFromList(kinds.map((kind) => KIND_TITLES[kind]), {
                withTitle: "Neue Verbindung", withPrompt: "Wie möchtest du verbinden?",
                okButtonName: "Weiter", cancelButtonName: "Zurück",
            });
            if (chosen === false) return null;
            return kinds.find((kind) => KIND_TITLES[kind] === chosen[0]) || null;
        },
        askLine(title, prompt) {
            try {
                return app.displayDialog(prompt, {
                    withTitle: title, defaultAnswer: "", buttons: ["Abbrechen", "Weiter"],
                    defaultButton: "Weiter", cancelButton: "Abbrechen",
                }).textReturned;
            } catch (error) {
                if (error.errorNumber === -128) return null;
                throw error;
            }
        },
        share(output) {
            const built = buildShare(output);
            const response = present(built.alert, built);
            return built.actions[Number(response) - Number($.NSAlertFirstButtonReturn)] || "done";
        },
        confirmAllow(name, fingerprint) {
            const alert = $.NSAlert.alloc.init;
            alert.messageText = $("Diesem Schlüssel Zugriff geben?");
            alert.informativeText = $(`Name: ${name}\nFingerprint: ${fingerprint}\n\nNur freigeben, wenn der Schlüssel von deinem eigenen Mac stammt.`);
            alert.addButtonWithTitle($("Freigeben"));
            alert.addButtonWithTitle($("Abbrechen"));
            return isButton(present(alert, null), $.NSAlertFirstButtonReturn);
        },
        editPreset(repo, draft, custom, note) {
            const built = buildPresetEditor(repo, draft, custom, note);
            const response = present(built.alert, built);
            if (isButton(response, $.NSAlertSecondButtonReturn)) return null;
            if (isButton(response, $.NSAlertThirdButtonReturn) && custom) return { reset: true };
            return collectPreset(built);
        },
        pickRepo(repos) {
            const titles = repos.map((repo) => `${repo.name}${repo.custom ? "   ✓ hat ein Preset" : ""}`);
            const chosen = app.chooseFromList(titles, {
                withTitle: "Preset anlegen", withPrompt: "Für welches Repository?", okButtonName: "Weiter", cancelButtonName: "Zurück",
            });
            return chosen === false ? null : repos[titles.indexOf(chosen[0])] || null;
        },
        confirmResetPreset(label, effect) {
            const alert = $.NSAlert.alloc.init;
            alert.messageText = $(`Preset von „${label}“ zurücksetzen?`);
            alert.informativeText = $(effect || "Danach starten wieder die Standard-Terminals. Das Repository selbst bleibt unberührt.");
            alert.addButtonWithTitle($("Zurücksetzen"));
            alert.addButtonWithTitle($("Abbrechen"));
            return isButton(present(alert, null), $.NSAlertFirstButtonReturn);
        },
        confirmMovePreset(label, target) {
            const alert = $.NSAlert.alloc.init;
            alert.messageText = $(`Preset von „${label}“ übernehmen?`);
            alert.informativeText = $(`Das Preset wird auf das Repository unter\n${target}\nübertragen und beim alten Pfad entfernt.`);
            alert.addButtonWithTitle($("Übernehmen"));
            alert.addButtonWithTitle($("Abbrechen"));
            return isButton(present(alert, null), $.NSAlertFirstButtonReturn);
        },
        pickFolders() {
            try {
                const chosen = app.chooseFolder({
                    withPrompt: "Ordner wählen, in dem Repositories gesucht werden sollen", multipleSelectionsAllowed: true,
                });
                return (Array.isArray(chosen) ? chosen : [chosen]).map((item) => String(item));
            } catch (error) {
                if (error.errorNumber === -128) return null;
                throw error;
            }
        },
        askRemoteFolder(note) {
            let message = note;
            let draft = { host: "", root: "" };
            for (;;) {
                const built = buildRemoteFolder(message, draft);
                const response = present(built.alert, built);
                if (!isButton(response, $.NSAlertFirstButtonReturn)) return null;
                draft = { host: ObjC.unwrap(built.host.stringValue).trim(), root: ObjC.unwrap(built.root.stringValue).trim() };
                if (draft.host) return draft;
                message = "Gib den SSH-Host an, zum Beispiel spark oder benutzer@server.";
            }
        },
        confirmRemoveFolder(label) {
            const alert = $.NSAlert.alloc.init;
            alert.messageText = $(`Suchordner „${label}“ entfernen?`);
            alert.informativeText = $("Nur die Suche wird beendet. Die Repositories und alles auf der Platte oder dem Server bleiben unberührt. Workspaces, die Projekte daraus enthalten, zeigen danach eine Warnung.");
            alert.addButtonWithTitle($("Entfernen"));
            alert.addButtonWithTitle($("Abbrechen"));
            return isButton(present(alert, null), $.NSAlertFirstButtonReturn);
        },
        confirmDelete(name) {
            const alert = $.NSAlert.alloc.init;
            alert.messageText = $(`Workspace „${name}“ löschen?`);
            alert.informativeText = $("Ein vorhandener Schreibtisch-Shortcut wird mit entfernt. Die Projekte selbst bleiben unberührt.");
            alert.addButtonWithTitle($("Löschen"));
            alert.addButtonWithTitle($("Abbrechen"));
            return isButton(present(alert, null), $.NSAlertFirstButtonReturn);
        },
        info(text) {
            const alert = $.NSAlert.alloc.init;
            alert.messageText = $("VibeCode Workspace");
            alert.informativeText = $(String(text));
            alert.addButtonWithTitle($("OK"));
            present(alert, null);
        },
        error(text) {
            const alert = $.NSAlert.alloc.init;
            alert.messageText = $("VibeCode Workspace");
            alert.informativeText = $(String(text));
            alert.alertStyle = $.NSAlertStyleWarning;
            alert.addButtonWithTitle($("OK"));
            present(alert, null);
        },
    };
}

function run(argv) {
    const [python, core] = argv;
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    const application = $.NSApplication.sharedApplication;
    application.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
    application.activateIgnoringOtherApps(true);
    flow(nativeUi(app), makeBackend(app, python, core));
    return "";
}
