// VibeCode Hauptfenster (JXA/AppKit). Aufruf (macht core/vibecode.py):
//   osascript -l JavaScript window.js <python> <vibecode.py>
// Die Logik liegt in vibecode.py; dieses Fenster zeigt sie nur an und ruft sie auf.
ObjC.import("AppKit");

const WIDTH = 460;
const ROW = 26;
// Muss zu terminal-setup.js passen; die Prüfung und der Befehlsaufbau liegen dort, nicht hier.
const PRESET_TYPES = ["Shell", "Claude Code", "Codex", "Codex 2", "Antigravity", "Eigener Befehl"];
const PRESET_PLACEMENTS = [
    { label: "Standard" },
    { value: "panel", label: "Unteres Panel" },
    { value: "tabs", label: "Editor-Tab" },
    { value: "grid", label: "Editor-Raster" },
];
const PRESET_ROWS = { min: 6, max: 12 };
// Anzeigenamen für die Kombinationen; ein unbekannter Anbieter oder eine unbekannte CLI erscheint unter ihrer ID.
const PROVIDER_NAMES = { mlx: "MLX", ollama: "Ollama" };
const FRAMEWORK_NAMES = { opencode: "OpenCode", codex: "Codex", claude: "Claude Code" };
// Wie in terminal-setup.js (localDevParts): drei Wörter ohne Leerzeichen und Anführungszeichen, sie reisen im Prompt des Terminals.
const COMBO_PART = /^[A-Za-z0-9][A-Za-z0-9._:\/@+-]{0,150}$/;
const comboValid = (combo) => ["provider", "model", "framework"].every((key) => COMBO_PART.test(String(combo[key])));
const comboLabel = (combo) => `${combo.model} → ${FRAMEWORK_NAMES[combo.framework] || combo.framework}`;
const comboPrompt = (combo) => `${combo.provider} ${combo.model} ${combo.framework}`;
const sameCombo = (a, b) => a.provider === b.provider && a.model === b.model && a.framework === b.framework;
const PRESET_WIDTH = 780;

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
        // Agenten: {sessions, error}; "local" liest diesen Mac, "remote" fragt den gespeicherten Mac per SSH (nur auf Klick).
        agents: (scope) => JSON.parse(call("agents", scope)),
        // Tailscale: eine feste Aktion (up, down, login, logout, auto-on, auto-off, setup); die Antwort ist Text, bei "login" JSON {url}.
        tailscale: (action) => call("tailscale", action),
        // Ollama-Modelle: "pull" öffnet ein Terminal (der Fortschritt gehört dorthin), "remove" läuft sofort. Antwort ist Text.
        model: (action, name) => call("models", action, name),
        // Gespeicherte Kombinationen (Anbieter, Modell, CLI): "add" oder "remove"; Antwort ist die neue Liste.
        combo: (action, value) => JSON.parse(call("combos", action, `--provider=${value.provider}`, `--model=${value.model}`,
            `--framework=${value.framework}`)),
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

// Die Kombinationen, die der Preset-Editor als Terminal anbietet. Local Dev läuft nur auf diesem Mac: für ein SSH-Repository
// gibt es keine (ein schon eingetragenes Terminal bleibt sichtbar, der Editor behandelt es getrennt).
function localDevCombos(state, repo) {
    return repo.remote ? [] : ((state.combos && state.combos.items) || []);
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
        const result = ui.editPreset(repo, draft, Boolean(existing), note, localDevCombos(state, repo));
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
        detail: "SSH-Host",
    }));
    if (ssh.mac) {
        const who = ssh.mac.user ? `${ssh.mac.user}@${ssh.mac.host}` : ssh.mac.host;
        items.push({ kind: "mac", name: ssh.mac.host, title: who, detail: "Mac · direkter Zugang" });
    }
    return items;
}

function allowLine(output) {
    const match = /^\s*(workspace remote ssh allow .+)$/m.exec(output);
    return match ? match[1] : "";
}

// Die Zeile des anderen Macs, wenn der Text wie genau eine solche aussieht, sonst "". Nur dann wird sie vorausgefüllt: der
// Inhalt der Zwischenablage kommt von außen und wird nie ungeprüft übernommen (und der Nutzer bestätigt ihn trotzdem).
function joinLineFrom(text) {
    if (typeof text !== "string") return "";
    const line = text.trim();
    return line.length <= 300 && /^workspace remote ssh join \S+( \S+){0,2}$/.test(line) ? line : "";
}

// Neue Verbindung: ein einziger Dialog statt erst einer Auswahl und dann dem Einfügen. Die geführte Einrichtung bleibt als Knopf.
function newConnection(ui, backend, ssh) {
    if (!ssh.share) {
        // Ohne das Remote-Modul gibt es kein Verbinden per Zeile.
        if (!ssh.guided) {
            ui.error("Für eine neue Verbindung fehlt ein Modul (Remote oder Setup).");
            return false;
        }
        backend.sshOpen("guided");
        return true;
    }
    const prefill = ui.clipboardJoinLine();
    let note = "";
    let answer;
    for (;;) {
        answer = ui.askConnection(ssh.guided, prefill, note);
        if (answer === null) return false;
        if (answer.guided) {
            backend.sshOpen("guided");
            return true;
        }
        if (answer.line.trim()) break;
        note = "Bitte die Zeile einfügen.";
    }
    // Das Prüfen kann bis zu 30 Sekunden dauern, und währenddessen ist kein Fenster zu sehen: ohne Hinweis wirkt es, als passiere nichts.
    const target = /join\s+(\S+)/.exec(answer.line);
    ui.notify(`Verbinde${target ? ` mit ${target[1]}` : ""} … das kann bis zu 30 Sekunden dauern.`);
    const result = backend.ssh("join", answer.line);
    if (result.code === 0) {
        const connected = /Verbunden mit (.+?)\. Befehle/.exec(result.out);
        ui.info(connected ? `Verbunden mit ${connected[1]} ✓\n\nIm Bereich Remote kannst du jetzt auf „Verbinden“ klicken.` : result.out);
    } else if (result.code === 2) {
        const allow = allowLine(result.out);
        ui.infoWithCopy("Noch nicht freigegeben: Der andere Mac muss dich noch freigeben.\n\n" +
            "1. Dort: VibeCode Workspace → Bereich Remote → Diesen Mac freigeben… → Schlüssel eintragen… und diese Zeile einfügen " +
            "(sie liegt in der Zwischenablage):\n\n" + allow +
            "\n\n2. Danach hier im Bereich Remote auf „Verbinden“ klicken.", allow);
    } else {
        ui.error(result.err || result.out);
    }
    return false;
}

// Wie joinLineFrom: nur genau eine allow-Zeile mit einem öffentlichen Schlüssel in Anführungszeichen wird vorausgefüllt. Freigegeben
// wird trotzdem erst nach der Bestätigung mit Name und Fingerprint.
function allowLineFrom(text) {
    if (typeof text !== "string") return "";
    const line = text.trim();
    return line.length <= 2000 &&
        /^workspace remote ssh allow '(?:ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp\d+) [A-Za-z0-9+\/=]+(?: [^'\r\n]{0,200})?'$/.test(line) ? line : "";
}

function allowFlow(ui, backend) {
    const prefill = ui.clipboardAllowLine();
    const line = ui.askLine("Schlüssel eintragen",
        "Füge die Zeile ein, die der andere Mac anzeigt. Sie beginnt mit „workspace remote ssh allow“." +
        (prefill ? "\n\nDie Zeile aus der Zwischenablage ist schon eingetragen. Freigegeben wird erst nach deiner Bestätigung des Fingerprints." : ""),
        prefill);
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
    if (done.code === 0) ui.info(`Freigegeben: ${key.name}.\n\nAuf dem anderen Mac jetzt im Bereich Remote auf Verbinden klicken.`);
    else ui.error(done.err || done.out);
}

// Das freigebende Gerät wählt aus, wer Zugriff bekommen soll: Einladung per Taildrop, der andere Mac nimmt sie an und schickt seinen
// öffentlichen Schlüssel zurück, hier wird er nach der Bestätigung mit Fingerprint eingetragen. Keine Zeilen, kein Passwort.
function inviteFlow(ui, backend, tailscale) {
    const devices = sshDevices(tailscale);
    if (!devices.length) {
        ui.info("Gerade ist kein anderes Gerät deines Tailnets online. Schalte es ein, dann hier noch einmal.");
        return;
    }
    const pick = ui.pickTailscaleDevice(devices);
    if (!pick) return;
    ui.notify(`Lade ${pick.name} ein …`);
    const result = backend.ssh("invite", pick.ip);
    if (result.code === 0) ui.info(`${result.out}\n\nDie Einladung gilt eine Stunde.`);
    else ui.error(result.err || result.out);
}

// „Einladungen abholen“: leert den Taildrop-Posteingang (nur Dateien mit unserem Namen werden gelesen, alles andere kommt unverändert
// nach ~/Downloads) und arbeitet ab, was wartet: Einladungen annehmen, Antworten bestätigen. Nur auf diesen Klick, nie beim Öffnen.
function inboxFlow(ui, backend) {
    ui.notify("Hole Einladungen und Antworten …");
    const fetched = backend.ssh("inbox");
    if (fetched.code !== 0) {
        ui.error(fetched.err || fetched.out);
        return;
    }
    let inbox;
    try {
        inbox = JSON.parse(fetched.out);
    } catch (error) {
        ui.error("Die Antwort des Remote-Moduls war nicht lesbar.");
        return;
    }
    const notes = [];
    if (inbox.foreign) notes.push(`${inbox.foreign} weitere Taildrop-Datei${inbox.foreign === 1 ? "" : "en"} lag${inbox.foreign === 1 ? "" : "en"} im Posteingang: unverändert nach ~/Downloads verschoben.`);
    if (inbox.invalid) notes.push(`${inbox.invalid} Datei${inbox.invalid === 1 ? "" : "en"} mit unserem Namen waren ungültig oder abgelaufen und liegen in ~/Downloads.`);
    if (inbox.rejected) notes.push(`${inbox.rejected} Einladung${inbox.rejected === 1 ? "" : "en"} von einem Gerät, das nicht zu deinem Tailscale-Konto gehört, ${inbox.rejected === 1 ? "wurde" : "wurden"} verworfen.`);
    if (inbox.unknown) notes.push(`${inbox.unknown} Antwort${inbox.unknown === 1 ? "" : "en"} ohne Einladung ${inbox.unknown === 1 ? "wurde" : "wurden"} verworfen.`);
    if (!inbox.invites.length && !inbox.answers.length) {
        // Die Tailscale-App empfängt Taildrop-Dateien selbst (die Kommandozeilen-Variante legt sie in den Posteingang): dann ist hier nichts zu holen.
        const hint = inbox.variant === "app"
            ? ["Bei der Tailscale-App muss Taildrop in den Systemeinstellungen eingeschaltet sein, und empfangene Dateien können direkt in ~/Downloads landen. " +
                "„Gerät per SSH verbinden…“ funktioniert immer."] : [];
        ui.info(["Keine Einladungen oder Antworten gefunden."].concat(hint, notes).join("\n\n"));
        return;
    }
    inbox.invites.forEach((invite) => {
        if (!ui.confirmInvite(invite)) return;                  // „Später“: die Einladung bleibt eine Stunde gespeichert
        const done = backend.ssh("accept", invite.nonce);
        if (done.code === 0) ui.info(done.out);
        else if (done.code === 4) {
            if (ui.confirmTailscale("keygen")) backend.sshOpen("keygen");
        } else ui.error(done.err || done.out);
    });
    inbox.answers.forEach((answer) => {
        const check = backend.ssh("grant-check", answer.nonce);
        if (check.code !== 0) {
            ui.error(check.err || check.out);
            return;
        }
        let key;
        try {
            key = JSON.parse(check.out);
        } catch (error) {
            ui.error("Die Antwort des Remote-Moduls war nicht lesbar.");
            return;
        }
        if (key.known) {
            backend.ssh("grant", answer.nonce);                 // verbraucht die Einladung, der Schlüssel steht schon drin
            ui.info(`„${key.name}“ war schon freigegeben.`);
            return;
        }
        if (!ui.confirmAllow(key.name, key.fingerprint)) return;
        const done = backend.ssh("grant", answer.nonce);
        if (done.code === 0) ui.info(`${done.out}\n\nAuf dem anderen Mac jetzt im Bereich Remote auf Verbinden klicken.`);
        else ui.error(done.err || done.out);
    });
    if (notes.length) ui.info(notes.join("\n\n"));
}

function shareFlow(ui, backend, tailscale) {
    let result = backend.ssh("share");
    let share = null;
    let notice = "";
    for (;;) {
        if (result) {
            if (result.code !== 0) {
                ui.error(result.err || result.out);
                return;
            }
            // Das Modul liefert den Zustand als JSON; die Maske zeigt daraus nur, was gerade zu tun ist.
            try {
                share = JSON.parse(result.out);
            } catch (error) {
                ui.error("Die Antwort des Remote-Moduls war nicht lesbar.");
                return;
            }
            result = null;
        }
        // „Gerät aus Tailscale freigeben…“ nur, wenn dieser Mac bereit ist (Entfernte Anmeldung an) und ein eigenes Gerät online ist.
        const canInvite = Boolean(share.remoteLogin && tailscale && tailscale.state === "running" && sshDevices(tailscale).length);
        const choice = ui.share(share, notice, canInvite);
        notice = "";
        if (choice === "wake") {
            result = backend.ssh("share-wake");
        } else if (choice === "recheck") {
            result = backend.ssh("share-recheck");           // ohne die Systemeinstellungen noch einmal zu öffnen
        } else if (choice === "copy") {
            ui.copy(share.line);                             // die Zwischenablage wird gern überschrieben: noch einmal in Ruhe kopieren
            notice = "Zeile kopiert ✓";
        } else if (choice === "allow") {
            allowFlow(ui, backend);
            return;
        } else if (choice === "invite") {
            inviteFlow(ui, backend, tailscale);
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
            ui.error("Der Launcher kennt noch keine Projekte. Füge im Reiter „Projekte“ einen Suchordner hinzu.");
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
        // Der Host des verbundenen Macs ist vorbelegt (derselbe Text wie im SSH-Ziel, also auch ein Tailscale-Name): so steht er überall
        // gleich geschrieben, und Remote-Projekte heißen „… [SSH: host]“. Nur bei Port 22, denn ein Port passt nicht in den Host-Text.
        const mac = state.ssh && state.ssh.mac;
        const entry = ui.askRemoteFolder("", mac && (mac.port || 22) === 22 ? `${mac.user ? mac.user + "@" : ""}${mac.host}` : undefined,
            knownRemoteHosts(state));
        if (!entry) return false;
        const result = backend.folder("add-remote", { host: entry.host, root: entry.root });
        ui.info(result.message + (result.warning
            ? `\n\n⚠︎ ${result.warning}\n\nDie Anmeldung ohne Passwort richtest du über „Remote“ → „Geführte Einrichtung…“ ein.`
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
    case "agents":
        agentsFlow(ui, backend, state);
        return false;
    case "refresh":
        return false;                                   // die Übersicht liest den Stand ohnehin neu
    case "comboAdd": {
        const found = backend.localSettings();
        if (found.error) {
            ui.error(found.error);
            return false;
        }
        const saved = (state.combos && state.combos.items) || [];
        const options = found.options.filter((option) => comboValid(option) && !saved.some((combo) => sameCombo(combo, option)));
        if (!options.length) {
            ui.info(found.options.length ? "Alle passenden Kombinationen sind schon gespeichert."
                : "Local Dev kennt keine passende Kombination aus Anbieter, Modell und CLI. Prüfe die Einrichtung unter „Öffnen“.");
            return false;
        }
        const chosen = ui.pickLocalDev(localDevChoices(options, null, false), "combo");
        if (chosen) backend.combo("add", chosen);
        return false;
    }
    case "comboRemove":
        backend.combo("remove", choice.combo);
        return false;
    case "modelPull":
        if (ui.confirmModelPull(choice.name)) ui.info(backend.model("pull", choice.name));
        return false;
    case "modelPullAsk": {
        const name = ui.askModelName();
        if (name) ui.info(backend.model("pull", name));
        return false;
    }
    case "modelRemove":
        if (ui.confirmModelRemove(choice.name)) ui.info(backend.model("remove", choice.name));
        return false;
    case "tailscaleSetup":
        if (ui.confirmTailscale("setup")) ui.info(backend.tailscale("setup"));
        return false;
    case "tailscaleUp":
    case "tailscaleDown":
        backend.tailscale(choice.action === "tailscaleUp" ? "up" : "down");
        return false;
    case "tailscaleAuto":
        backend.tailscale(choice.enabled ? "auto-on" : "auto-off");
        return false;
    case "tailscaleLogin": {
        // Der Anmelde-Link kann bis zu 15 Sekunden brauchen und während der Aktion ist das Fenster weg: erst ein Hinweis.
        ui.notify("Hole den Anmelde-Link von Tailscale …");
        let result;
        try {
            result = JSON.parse(backend.tailscale("login"));
        } catch (error) {
            if (error instanceof SyntaxError) throw new Error("Die Antwort von Tailscale war nicht lesbar.");
            throw error;
        }
        ui.info(result.url
            ? "Der Anmelde-Link wurde im Browser geöffnet. Melde dich dort an und klicke danach im Bereich Remote auf „Aktualisieren“.\n\n" + result.url
            : "Dieser Mac ist schon bei Tailscale angemeldet und verbunden.");
        return false;
    }
    case "tailscaleLogout":
        if (ui.confirmTailscale("logout")) backend.tailscale("logout");
        return false;
    case "tailscaleInbox":
        inboxFlow(ui, backend);
        return false;
    case "tailscaleDevices":
        ui.info(tailscaleDevicesText(state.tailscale));
        return false;
    case "tailscaleConnectDevice": {
        // Ein Gerät aus dem eigenen Tailnet als SSH-Ziel: ohne Zeilen zwischen den Macs; Tailscale bestätigt, dass es dein Gerät ist.
        const devices = sshDevices(state.tailscale);
        if (!devices.length) {
            ui.info("Gerade ist kein anderes Gerät deines Tailnets online. Schalte es ein (und dort „Wachhalten“), dann hier auf „Aktualisieren“ klicken.");
            return false;
        }
        const pick = ui.askTailscaleDevice(devices, state.tailscale.localUser || "");
        if (!pick) return false;
        ui.notify(`Verbinde mit ${pick.name} … das kann bis zu 30 Sekunden dauern.`);
        const result = backend.ssh("tailnet", `${pick.user}@${pick.ip}`);
        if (result.code === 0) {
            const connected = /Verbunden mit (.+?)\. Befehle/.exec(result.out);
            ui.info(`Verbunden${connected ? ` mit ${connected[1]}` : ""} ✓\n\nIm Bereich Remote kannst du jetzt auf „Verbinden“ klicken oder ` +
                "im Reiter Projekte „Remote-Ordner hinzufügen…“ wählen. Der Host ist dort vorbelegt.");
        } else if (result.code === 2) {
            if (ui.confirmTailscale("pair")) backend.sshOpen("pair");
        } else {
            ui.error(result.err || result.out);
        }
        return false;
    }
    case "tailscaleRefresh":
        return false;                                   // die Übersicht liest den Stand ohnehin neu
    case "sshNew":
        return newConnection(ui, backend, state.ssh);
    case "sshGuide":
        backend.sshOpen("guided");
        return true;
    case "sshShare":
        shareFlow(ui, backend, state.tailscale);
        return false;
    case "sshRevoke": {
        const grant = choice.grant;
        if (!ui.confirmRevoke(grant.name, grant.fingerprint)) return false;
        const result = backend.ssh("revoke", grant.fingerprint);
        if (result.code === 0) ui.info(result.out);
        else ui.error(result.err || result.out);
        return false;
    }
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

// ---------------------------------------------------------------- Agenten (Modell, ohne Widgets)

// Was die Agenten gerade tun, geschätzt aus den Verlaufsdateien von Claude Code und Codex (core/agent_scan.py): ein Schnappschuss mit
// „Aktualisieren“, kein Live-Monitor. Die Übersicht fragt nie einen anderen Mac; das geschieht nur auf einen Klick im Dialog.
const AGENT_LABEL = { working: "arbeitet", ready: "fertig, wartet auf dich", tool_wait: "Befehl läuft oder wartet auf Freigabe",
    stalled: "unklar, seit längerem still", unknown: "unbekannt" };
const AGENT_MARK = { working: "●", ready: "○", tool_wait: "◐", stalled: "◌", unknown: "·" };
const AGENT_NAME = { claude: "Claude", codex: "Codex" };
const AGENT_LINES = 12;

function agentAge(seconds) {
    if (seconds < 90) return `vor ${seconds} s`;
    if (seconds < 5400) return `vor ${Math.round(seconds / 60)} min`;
    return `vor ${Math.round(seconds / 3600)} h`;
}

function agentCounts(sessions) {
    const counts = { working: 0, ready: 0, tool_wait: 0, stalled: 0, unknown: 0 };
    (sessions || []).forEach((session) => { if (session.state in counts) counts[session.state] += 1; });
    return counts;
}

function agentsSummary(sessions) {
    const counts = agentCounts(sessions);
    const parts = [];
    if (counts.working) parts.push(counts.working === 1 ? "1 arbeitet" : `${counts.working} arbeiten`);
    if (counts.tool_wait) parts.push(`${counts.tool_wait} mit laufendem Befehl oder Freigabe`);
    if (counts.ready) parts.push(counts.ready === 1 ? "1 wartet auf dich" : `${counts.ready} warten auf dich`);
    if (counts.stalled) parts.push(`${counts.stalled} unklar`);
    return parts.length ? parts.join(" · ") : "Keine Sitzung in den letzten 3 Stunden";
}

function agentRows(agents) {
    const rows = [{ type: "section", text: "Agenten" }];
    if (agents.error) {
        rows.push({ type: "note", text: `⚠︎ ${agents.error}`, level: "warn" });
        return rows;
    }
    const counts = agentCounts(agents.sessions);
    rows.push({ type: "item", title: "Claude Code und Codex", detail: `${agentsSummary(agents.sessions)} · Schätzung`,
        level: counts.working ? "ok" : counts.tool_wait ? "warn" : "off",
        buttons: [{ label: "Agenten…", action: { action: "agents" } }] });
    return rows;
}

function agentSection(title, sessions, error) {
    const lines = [`${title}${error ? "" : ` (${(sessions || []).length})`}`];
    if (error) {
        lines.push(`⚠︎ ${error}`);
        return lines;
    }
    if (!(sessions || []).length) lines.push("Keine Sitzung in den letzten 3 Stunden.");
    (sessions || []).slice(0, AGENT_LINES).forEach((session) => lines.push([`${AGENT_MARK[session.state]} ${AGENT_LABEL[session.state]}`,
        session.project, AGENT_NAME[session.agent] || session.agent, session.branch, agentAge(session.age)].filter(Boolean).join(" · ")));
    if ((sessions || []).length > AGENT_LINES) lines.push(`… und ${sessions.length - AGENT_LINES} weitere`);
    return lines;
}

function agentsText(model) {
    const lines = agentSection("Dieser Mac", model.local, model.localError);
    if (model.remote) lines.push("", ...agentSection(model.mac, model.remote.sessions, model.remote.error));
    lines.push("", "Eine Schätzung aus den Verlaufsdateien von Claude Code und Codex, kein Live-Monitor. „Aktualisieren“ liest neu.");
    return lines.join("\n");
}

// Der Dialog läuft in einer Schleife, bis er geschlossen wird. Den anderen Mac fragt nur der ausdrückliche Klick (und dann jede
// Aktualisierung mit): die Übersicht selbst darf nie auf SSH warten.
function agentsFlow(ui, backend, state) {
    let local = state.agents.sessions || [];
    let localError = state.agents.error || null;
    let remote = null;
    const mac = state.ssh && state.ssh.mac ? state.ssh.mac.host : "";
    const askRemote = () => {
        ui.notify(`Prüfe ${mac} … das kann einen Moment dauern.`);
        remote = backend.agents("remote");
    };
    for (;;) {
        const choice = ui.showAgents({ text: agentsText({ local, localError, remote, mac }), remoteLabel: mac ? `Auf ${mac} prüfen` : "" });
        if (choice === "remote" && mac) {
            askRemote();
        } else if (choice === "refresh") {
            const fresh = backend.agents("local");
            local = fresh.sessions || [];
            localError = fresh.error || null;
            if (remote) askRemote();
        } else {
            return;
        }
    }
}

// ---------------------------------------------------------------- Tailscale (Modell, ohne Widgets)

// Je Zustand: Punkt, Text, Knöpfe. Ohne Zustand zu raten: ein unbekannter Zustand bietet nur „Aktualisieren“ an.
const TAILSCALE_STATES = {
    missing: { level: "off", text: "nicht installiert", buttons: ["setup"],
        note: "„Einrichten…“ öffnet ein Terminal: Homebrew, einmal dein Admin-Passwort." },
    "daemon-down": { level: "warn", text: "Dienst antwortet nicht", buttons: ["setup"],
        note: "„Einrichten…“ startet den Dienst (Kommandozeile), oder die Tailscale-App öffnen." },
    denied: { level: "warn", text: "Zugriff verweigert", buttons: ["setup"],
        note: "„Einrichten…“ erlaubt diesem Konto die Steuerung (einmal sudo im Terminal)." },
    "needs-login": { level: "warn", text: "nicht angemeldet", buttons: ["login"] },
    "needs-approval": { level: "warn", text: "wartet auf Freigabe im Tailnet", buttons: [],
        note: "Ein Administrator deines Tailnets muss dieses Gerät erst freigeben." },
    starting: { level: "warn", text: "verbindet …", buttons: [] },
    stopped: { level: "off", text: "getrennt", buttons: ["up", "logout"] },
    running: { level: "ok", text: "verbunden", buttons: ["down", "devices", "logout"] },
    unknown: { level: "warn", text: "Status unbekannt", buttons: [] },
};

const TAILSCALE_BUTTONS = {
    setup: { label: "Einrichten…", action: { action: "tailscaleSetup" } },
    login: { label: "Anmelden…", action: { action: "tailscaleLogin" } },
    up: { label: "Verbinden", action: { action: "tailscaleUp" } },
    down: { label: "Trennen", action: { action: "tailscaleDown" } },
    devices: { label: "Geräte…", action: { action: "tailscaleDevices" } },
    logout: { label: "Abmelden…", action: { action: "tailscaleLogout" } },
};

// Die Übersicht liest den Stand nur beim Aufbau. Nach dem Einrichten im Terminal oder der Anmeldung im Browser zeigt sie ihn erst
// nach einem Klick hierauf; darum gibt es den Knopf in jedem Zustand (auch bei einem Lesefehler).
const TAILSCALE_REFRESH = { type: "footer", buttons: [{ label: "Aktualisieren", action: { action: "tailscaleRefresh" } }] };
const MOBILE_OS = ["ios", "android", "tvos", "watchos", "ipados"];

// Geräte, auf die man per SSH kommen kann: online und kein Telefon. Ob es wirklich ein eigenes Gerät ist, prüft das Modul.
function sshDevices(tailscale) {
    return (tailscale.devices || []).filter((device) => device.online && device.ip && !MOBILE_OS.includes(String(device.os).toLowerCase()));
}

// Hosts, die das Dropdown bei „Remote-Ordner hinzufügen…“ anbietet: erst die schon verbundenen (der direkte Mac, gespeicherte Hosts),
// dann die Macs, die im Tailnet gerade online sind (als benutzer@name, wie bei „Gerät per SSH verbinden…“). Dieselbe Schreibweise wie
// in den Zielen, damit ein Host überall gleich heißt; doppelte fallen weg. Ein Port passt nicht in den Host-Text.
function knownRemoteHosts(state) {
    const ssh = state.ssh;
    const tailscale = state.tailscale;
    const found = [];
    const add = (host) => {
        if (host && !found.some((known) => known.toLowerCase() === host.toLowerCase())) found.push(host);
    };
    const mac = ssh && ssh.mac;
    if (mac && mac.host && (mac.port || 22) === 22) add(`${mac.user ? mac.user + "@" : ""}${mac.host}`);
    ((ssh && ssh.hosts) || []).forEach((entry) => add(entry.host));
    const user = tailscale && tailscale.available && tailscale.state === "running" && tailscale.localUser ? `${tailscale.localUser}@` : "";
    if (tailscale && tailscale.available && tailscale.state === "running") {
        sshDevices(tailscale).forEach((device) => add(`${user}${String(device.dns || "").replace(/\.$/, "") || device.ip}`));
    }
    return found.slice(0, 40);
}

function tailscaleRows(tailscale) {
    const rows = [{ type: "section", text: "Tailscale" }];
    if (tailscale.error) {
        rows.push({ type: "note", text: `⚠︎ ${tailscale.error}`, level: "warn" }, TAILSCALE_REFRESH);
        return rows;
    }
    const known = TAILSCALE_STATES[tailscale.state] || TAILSCALE_STATES.unknown;
    const detail = [known.text];
    if (tailscale.variant === "app" || tailscale.variant === "cli") detail.push(tailscale.variant === "app" ? "App" : "Kommandozeile");
    if (tailscale.ours) detail.push("von VibeCode gestartet");
    rows.push({ type: "item", title: "Verbindung", detail: detail.join(" · "), level: known.level,
        buttons: known.buttons.map((name) => TAILSCALE_BUTTONS[name]) });
    if (known.note) rows.push({ type: "note", text: known.note });
    // Der Schalter: Tailscale startet mit einem Workspace und endet, wenn dessen letztes Editor-Fenster zu ist.
    // Eine Einstellung, kein Zustand: das Kästchen zeigt, ob sie an ist; ein Punkt daneben wäre doppelt.
    rows.push({ type: "item", title: "Mit VibeCode starten und beenden", level: "none",
        detail: tailscale.auto
            ? "Startet mit jedem Workspace, endet nach dem letzten VibeCode-Editor-Fenster."
            : "Aus. Tailscale bleibt, wie du es eingestellt hast.",
        buttons: [{ label: "Aktiv", checkbox: true, checked: Boolean(tailscale.auto),
            action: { action: "tailscaleAuto", enabled: !tailscale.auto } }] });
    if (tailscale.autoError) rows.push({ type: "note", text: `⚠︎ ${tailscale.autoError}`, level: "warn" });
    rows.push(TAILSCALE_REFRESH);
    return rows;
}

function tailscaleDevicesText(tailscale) {
    const lines = [`Dieser Mac: ${[tailscale.name, tailscale.ip].filter(Boolean).join(" · ") || "unbekannt"}`];
    const devices = tailscale.devices || [];
    lines.push("", devices.length ? `Weitere Geräte${tailscale.tailnet ? ` in ${tailscale.tailnet}` : ""} (${devices.length}):`
        : "Keine weiteren Geräte im Tailnet gefunden.");
    devices.forEach((device) => lines.push([`${device.online ? "●" : "○"} ${device.name}`, device.ip, device.os,
        device.online || !device.lastSeen ? "" : `zuletzt ${device.lastSeen.slice(0, 10)}`].filter(Boolean).join(" · ")));
    return lines.join("\n");
}

// ---------------------------------------------------------------- Übersicht (Modell, ohne Widgets)

function workspaceRows(state) {
    const rows = [{ type: "section", text: "Workspaces" }];
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
                { label: "Starten", primary: true, action: { action: "start", name: workspace.name } },
                { label: "Bearbeiten…", action: { action: "edit", name: workspace.name } }],
        });
    });
    rows.push({
        type: "footer",
        buttons: [{ label: "Workspace anlegen…", primary: !state.workspaces.length, action: { action: "new" } }].concat(
            state.canLaunch ? [{ label: "Einmaliger Workspace…", action: { action: "open", id: "launch" } }] : [],
            // Auch ein Suchordner mit Quick-Öffnen hat einen Schreibtisch-Shortcut, den „erneuern“ neu anlegt (z. B. unter dem Namen dieses Macs).
            state.workspaces.some((workspace) => workspace.shortcut || workspace.quickOpen)
                || (state.folders && state.folders.local.some((folder) => folder.quickOpen))
                ? [{ label: "Shortcuts erneuern", action: { action: "sync" } }] : []),
    });

    if (state.agents && state.agents.available) agentRows(state.agents).forEach((row) => rows.push(row));
    const wake = state.settings && state.settings.wake;
    if (wake) {
        rows.push({ type: "section", text: "Wachhalten & Apps" }, ...wakeRows(wake));
    }
    return rows;
}

function projectRows(state) {
    const rows = [];
    const folders = state.folders;
    const repositories = (count) => `${count} ${count === 1 ? "Repository" : "Repositories"}`;
    if (folders && (folders.canAddLocal || folders.local.length)) {
        rows.push({ type: "section", text: "Lokale Suchordner" });
        if (!folders.local.length) rows.push({ type: "note", text: "Noch kein lokaler Suchordner eingerichtet." });
        folders.local.forEach((folder) => {
            let detail = repositories(folder.repos);
            let level = "ok";
            if (!folder.exists) { detail = "⚠︎ Ordner nicht gefunden"; level = "warn"; }
            else if (folder.truncated) { detail += " · ⚠︎ Ordner sehr groß, Suche abgebrochen"; level = "warn"; }
            else if (!folder.repos) { detail = "⚠︎ keine Repositories gefunden"; level = "warn"; }
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
        if (folders.canAddLocal) {
            rows.push({ type: "footer", buttons: [{ label: "Ordner hinzufügen…", action: { action: "addFolder" } }] });
        }
    }
    if (folders && (folders.canAddRemote || folders.remote.length)) {
        rows.push({ type: "section", text: "Remote-Suchordner" });
        if (!folders.remote.length) rows.push({ type: "note", text: "Noch kein Suchordner auf einem SSH-Host eingerichtet." });
        folders.remote.forEach((folder) => rows.push({
            type: "item", title: `${folder.host}:${folder.root}`, middle: true,
            detail: folder.repos ? `${repositories(folder.repos)} (zuletzt gefunden)` : "⚠︎ noch keine Repositories gefunden",
            level: folder.repos ? "ok" : "warn",
            buttons: [{ label: "Entfernen", action: { action: "removeFolder", kind: "remote", host: folder.host,
                label: `${folder.host}:${folder.root}` } }],
        }));
        if (folders.canAddRemote) {
            rows.push({ type: "footer", buttons: [{ label: "Remote-Ordner hinzufügen…", action: { action: "addRemoteFolder" } }] });
        }
    }
    ((folders && folders.errors) || []).forEach((text) => rows.push({ type: "note", text: `⚠︎ ${text}`, level: "warn" }));

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
    const other = state.entries.filter((entry) => entry.id !== "local");
    if (other.length) rows.push({ type: "section", text: "Weitere Werkzeuge" }, ...other.map(moduleRow));
    if (!rows.length) rows.push({ type: "note", text: "Die Module für Suchordner und Presets sind nicht verfügbar." });
    return rows;
}

// Gehört dieser Host (Name, MagicDNS-Name oder Adresse) zu einem Gerät aus Tailscale? Das gibt den Punkt eines Ziels her, ohne dass das
// Fenster einen SSH-Host kontaktiert: online/offline kommt aus dem Tailnet. Ohne laufendes Tailscale oder ohne Treffer: kein Gerät.
function tailnetDevice(tailscale, host) {
    const wanted = String(host || "").trim().toLowerCase().replace(/\.$/, "");
    if (!wanted || !tailscale || !tailscale.available || tailscale.state !== "running") return null;
    const bare = wanted.replace(/\.local$/, "");
    return (tailscale.devices || []).find((device) => {
        const dns = String(device.dns || "").toLowerCase().replace(/\.$/, "");
        return wanted === dns || wanted === device.ip || bare === String(device.name || "").toLowerCase();
    }) || null;
}

// Punkt = Zustand jetzt: grün online, grau offline (beides aus dem Tailnet), keiner, wenn das Ziel nicht im Tailnet steht.
// Wer erreichbar ist, steht oben; sonst bleibt die Reihenfolge, in der die Ziele eingerichtet wurden.
function targetRows(ssh, tailscale) {
    const entries = sshItems(ssh).map((item, index) => {
        const device = tailnetDevice(tailscale, item.name);
        return { item, index, device, rank: device ? (device.online ? 0 : 2) : 1 };
    });
    entries.sort((a, b) => a.rank - b.rank || a.index - b.index);
    return entries.map(({ item, device }) => ({
        type: "item", title: item.title, level: device ? (device.online ? "ok" : "off") : "none",
        detail: [item.detail, device ? `${device.online ? "online" : "offline"} im Tailnet` : ""].filter(Boolean).join(" · "),
        buttons: [{ label: "Verbinden", primary: true, action: { action: "connect", item } }],
    }));
}

// Remote nach Richtung: erst das Netz (Tailscale), dann „von hier zu anderen“, dann „von anderen auf diesen Mac“. Ein Punkt steht nur
// für einen Zustand, der gerade stimmt (verbunden, online, wachgehalten). Einstellungen, Freigaben und Aktionen haben keinen Punkt.
function remoteRows(state) {
    const ssh = state.ssh;
    const tailscale = state.tailscale;
    const hasSsh = Boolean(ssh && ssh.available);
    const running = tailscale && tailscale.available && tailscale.state === "running";
    const hasDevices = running && (tailscale.devices || []).length;
    const rows = tailscale && tailscale.available ? tailscaleRows(tailscale) : [];

    const setup = [];
    if (hasDevices) setup.push({ label: "Gerät per SSH verbinden…", action: { action: "tailscaleConnectDevice" } });
    if (ssh && ssh.share) setup.push({ label: "Neue Verbindung…", action: { action: "sshNew" } });
    if (ssh && ssh.guided) setup.push({ label: "Geführte Einrichtung…", action: { action: "sshGuide" } });
    if (hasSsh || setup.length) {
        rows.push({ type: "section", text: "Verbindungen von diesem Mac" });
        const targets = hasSsh ? targetRows(ssh, tailscale) : [];
        if (targets.length) rows.push(...targets);
        else rows.push({ type: "note", text: "Noch keine Verbindung zu einem anderen Mac oder Server eingerichtet." });
        if (setup.length) rows.push({ type: "footer", buttons: setup });
    }

    if ((ssh && ssh.share) || running) {
        rows.push({ type: "section", text: "Zugriff auf diesen Mac" });
        const grants = (ssh && ssh.grants) || [];
        if (!grants.length && ssh && ssh.share) rows.push({ type: "note", text: "Keine SSH-Schlüssel freigegeben." });
        grants.forEach((grant) => rows.push({
            type: "item", title: grant.name, detail: "SSH-Schlüssel freigegeben", level: "none",
            buttons: [{ label: "Widerrufen…", action: { action: "sshRevoke", grant } }],
        }));
        const buttons = [];
        if (ssh && ssh.share) buttons.push({ label: "Diesen Mac freigeben…", action: { action: "sshShare" } });
        if (running) buttons.push({ label: "Einladungen abholen", action: { action: "tailscaleInbox" } });
        rows.push({ type: "footer", buttons });
    }
    ((ssh && ssh.errors) || []).forEach((text) => rows.push({ type: "note", text: `⚠︎ ${text}`, level: "warn" }));
    if (!rows.length) rows.push({ type: "note", text: "Für Remote steht kein Modul zur Verfügung." });
    return rows;
}

function wakeButton(wake, name, enabled) {
    return typeof wake.enabled === "boolean"
        ? [{ label: enabled ? "Ausschalten" : "Einschalten", action: { action: "setting", name, enabled: !enabled } }]
        : [];
}

function wakeRows(wake) {
    const withApps = wake.withApps !== false;
    const wakeOnly = wake.enabled && !withApps;
    const appsRunning = wake.enabled && withApps;
    const apps = (wake.apps || []).join(" · ");
    return [
        { type: "item", title: "Nur wachhalten", level: wakeOnly || wake.enabled === null ? wake.level : "off",
            detail: wake.level === "warn" && !appsRunning ? wake.text : wakeOnly ? "Aktiv" : "",
            buttons: wakeButton(wake, "keep-awake", wakeOnly) },
        { type: "item", title: "Wachhalten mit Apps", level: appsRunning ? wake.level : "off",
            detail: appsRunning && wake.level === "warn" ? wake.text : apps || "Keine Apps ausgewählt",
            buttons: wakeButton(wake, "keep-awake-apps", appsRunning)
                .concat([{ label: "Apps wählen…", action: { action: "open", id: "remote" } }]) },
    ];
}

function moduleRow(entry) {
    return {
        type: "item", title: entry.title, detail: entry.status ? entry.status.text : "",
        level: entry.status ? entry.status.level : "none",
        buttons: (entry.id === "local" ? [{ label: "Einstellen…", action: { action: "localSetup" } }] : [])
            .concat([{ label: "Öffnen", action: { action: "open", id: entry.id } }]),
    };
}

// Ollama nennt Größen dezimal (GB = 10^9 Byte).
function modelSize(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "";
    return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1).replace(".", ",")} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

// Installierte und noch nicht geladene Modelle. Laden und Entfernen gehen nur mit gefundenem Ollama. Ein Punkt gäbe hier nichts her:
// „installiert“ ist kein Zustand, der sich ändert, während man hinsieht.
function modelRows(models) {
    if (!models || !models.available) return [];
    const rows = [{ type: "section", text: "Ollama-Modelle" }];
    if (models.error) rows.push({ type: "note", text: `⚠︎ ${models.error}`, level: "warn" });
    else if (!models.cli) rows.push({ type: "note", text: "Ollama wurde nicht gefunden. Laden und Entfernen gehen, sobald es installiert ist (ollama.com).", level: "warn" });
    else if (!models.models.length) rows.push({ type: "note", text: "Noch kein Ollama-Modell geladen." });
    models.models.forEach((model) => rows.push({
        type: "item", title: model.name, level: "none", middle: true,
        detail: [modelSize(model.size), model.modified ? `geladen ${String(model.modified).slice(0, 10)}` : ""].filter(Boolean).join(" · "),
        buttons: models.cli ? [{ label: "Entfernen…", action: { action: "modelRemove", name: model.name } }] : [],
    }));
    rows.push({ type: "footer", buttons: (models.cli ? [{ label: "Modell laden…", action: { action: "modelPullAsk" } }] : [])
        .concat([{ label: "Aktualisieren", action: { action: "refresh" } }]) });
    if (models.missing.length) {
        rows.push({ type: "section", text: "Noch nicht geladen" });
        models.missing.forEach((model) => rows.push({
            type: "item", title: model.name, level: "none", middle: true,
            detail: model.why === "eingestellt" ? "In Local Dev eingestellt, aber nicht geladen" : ["Vorschlag", model.note].filter(Boolean).join(" · "),
            buttons: models.cli ? [{ label: "Laden…", action: { action: "modelPull", name: model.name } }] : [],
        }));
    }
    return rows;
}

// Gespeicherte Paare aus Modell und CLI. Der Preset-Editor (Projekte) bietet sie als Terminal an. Ein Ollama-Modell, das noch nicht
// geladen ist, wird beim ersten Start geladen (mehrere GB im Terminal): das zeigt die Zeile vorher.
function comboRows(state) {
    const combos = state.combos;
    if (!combos) return [];
    const rows = [{ type: "section", text: "Kombinationen aus Modell und CLI" }];
    if (combos.error) rows.push({ type: "note", text: `⚠︎ ${combos.error}`, level: "warn" });
    else if (!combos.items.length) rows.push({ type: "note", text: "Noch keine Kombination. Gespeicherte erscheinen unter Projekte im Preset-Editor als Terminal." });
    const installed = state.models && state.models.available && !state.models.error ? state.models.models.map((model) => model.name) : null;
    combos.items.forEach((combo) => {
        const missing = combo.provider === "ollama" && installed !== null && !installed.includes(combo.model);
        rows.push({
            type: "item", title: comboLabel(combo), middle: true, level: missing ? "warn" : "none",
            detail: [PROVIDER_NAMES[combo.provider] || combo.provider, missing ? "Modell noch nicht geladen (wird beim ersten Start geladen)" : ""].filter(Boolean).join(" · "),
            buttons: [{ label: "Entfernen", action: { action: "comboRemove", combo } }],
        });
    });
    if (!combos.error) rows.push({ type: "footer", buttons: [{ label: "Kombination anlegen…", action: { action: "comboAdd" } }] });
    return rows;
}

function localDevRows(state) {
    const local = state.entries.find((entry) => entry.id === "local");
    return local
        ? [{ type: "section", text: "Anbieter, Modell und CLI" }, moduleRow(local), ...modelRows(state.models), ...comboRows(state)]
        : [{ type: "note", text: "Das Local-Dev-Modul ist nicht verfügbar." }];
}

function dashboardModel(state) {
    return [
        { id: "workspaces", label: "Workspaces", rows: workspaceRows(state) },
        { id: "projects", label: "Projekte", rows: projectRows(state) },
        { id: "remote", label: "Remote", rows: remoteRows(state) },
        { id: "localDev", label: "Local Dev", rows: localDevRows(state) },
    ];
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

function buildLocalDevSetting(choices, kind) {
    const popup = $.NSPopUpButton.alloc.initWithFramePullsDown($.NSMakeRect(0, 0, 540, 26), false);   // breit: die Hinweise stehen am Ende
    choices.forEach((choice) => popup.addItemWithTitle($(choice.label)));
    const current = choices.findIndex((choice) => choice.selected);
    popup.selectItemAtIndex(current >= 0 ? current : 0);
    const alert = $.NSAlert.alloc.init;
    alert.messageText = $(kind === "combo" ? "Kombination anlegen" : "Local Dev einstellen");
    alert.informativeText = $(kind === "combo"
        ? "Eine Kombination aus Anbieter, Modell und CLI. Der Preset-Editor unter Projekte bietet sie danach als Terminal an; " +
          "das Terminal startet den lokalen Modellserver und darauf die CLI im Repository."
        : "Das ist die Vorauswahl beim Start von Local Dev: Anbieter (MLX oder Ollama), Modell und CLI " +
          "(OpenCode, Codex, Claude). Nicht installierte Einträge lassen sich einstellen und starten, sobald sie installiert sind. " +
          "Für einen einzelnen Workspace wählst du Local Dev im Dialog des Workspaces.");
    alert.accessoryView = popup;
    alert.addButtonWithTitle($(kind === "combo" ? "Anlegen" : "Speichern"));
    alert.addButtonWithTitle($("Abbrechen"));
    return { alert, popup, choices };
}

// Die Auswahl „Terminal“: „–“, die festen Typen, dann die gespeicherten Kombinationen als „Local Dev · Modell → CLI“. Ein Local-Dev-
// Terminal im Preset, dessen Kombination nicht (mehr) gespeichert ist, bleibt als eigener Eintrag stehen: Speichern löscht es nie still.
function localDevItems(draft, combos) {
    const used = new Set(PRESET_TYPES.concat(["–"]));
    const unique = (text) => {
        let result = text;
        for (let n = 2; used.has(result); n += 1) result = `${text} (${n})`;   // NSPopUpButton ersetzt gleiche Titel
        used.add(result);
        return result;
    };
    const items = (combos || []).map((combo) => ({ prompt: comboPrompt(combo),
        title: unique(`Local Dev · ${comboLabel(combo)} · ${PROVIDER_NAMES[combo.provider] || combo.provider}`) }));
    draft.terminals.filter((terminal) => terminal.type === "Local Dev").forEach((terminal) => {
        if (!items.some((item) => item.prompt === terminal.prompt)) {
            const [provider, model, framework] = terminal.prompt.split(" ");
            items.push({ prompt: terminal.prompt,
                title: unique(`Local Dev · ${comboLabel({ model, framework })} · ${PROVIDER_NAMES[provider] || provider} (nicht gespeichert)`) });
        }
    });
    return items;
}

function buildPresetEditor(repo, draft, custom, note, combos) {
    const localItems = localDevItems(draft, combos);
    const count = Math.max(PRESET_ROWS.min, Math.min(PRESET_ROWS.max, draft.terminals.length));
    const rowHeight = 28;
    const total = 20 + count * rowHeight + 12 + 18 + 4 + 24;
    const view = $.NSView.alloc.initWithFrame($.NSMakeRect(0, 0, PRESET_WIDTH, total));
    const columns = [[0, 130, "Terminal"], [140, 110, "Name"], [260, 250, "Startprompt oder Befehl"],
        [520, 120, "Unterordner"], [650, 130, "Öffnen in"]];
    columns.forEach(([x, width, title]) => view.addSubview(label(title, $.NSMakeRect(x, total - 18, width, 16), true)));
    const rows = [];
    for (let index = 0; index < count; index += 1) {
        const terminal = draft.terminals[index];
        const y = total - 20 - (index + 1) * rowHeight + 2;
        const popup = $.NSPopUpButton.alloc.initWithFramePullsDown($.NSMakeRect(0, y, 130, 24), false);
        ["–"].concat(PRESET_TYPES, localItems.map((item) => item.title)).forEach((type) => popup.addItemWithTitle($(type)));
        if (terminal && terminal.type === "Local Dev") {
            popup.selectItemAtIndex(1 + PRESET_TYPES.length + localItems.findIndex((item) => item.prompt === terminal.prompt));
        } else if (terminal) {
            popup.selectItemWithTitle($(terminal.type));
        }
        const placement = $.NSPopUpButton.alloc.initWithFramePullsDown($.NSMakeRect(650, y, 130, 24), false);
        PRESET_PLACEMENTS.forEach(({ label: title }) => placement.addItemWithTitle($(title)));
        const selected = PRESET_PLACEMENTS.findIndex((option) => option.value === terminal?.placement);
        placement.selectItemAtIndex(Math.max(0, selected));
        const field = (x, width, value, placeholder) => {
            const input = $.NSTextField.alloc.initWithFrame($.NSMakeRect(x, y, width, 24));
            input.stringValue = $(value || "");
            input.placeholderString = $(placeholder);
            view.addSubview(input);
            return input;
        };
        view.addSubview(popup);
        view.addSubview(placement);
        rows.push({ popup, placement, name: field(140, 110, terminal && terminal.name, "Name"),
            prompt: field(260, 250, terminal && terminal.type !== "Local Dev" ? terminal.prompt : "", "leer = ohne Vorgabe (bei Local Dev: aus der Kombination)"),
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
        "Claude Code und Antigravity starten ohne Sicherheitsabfragen, beide Codex-Profile mit vollem Zugriff ohne Sandbox." +
        (localItems.length ? " „Local Dev · …“ startet den lokalen Modellserver und darauf die CLI, nur auf diesem Mac." : ""));
    alert.accessoryView = view;
    alert.addButtonWithTitle($("Speichern"));
    alert.addButtonWithTitle($("Abbrechen"));
    if (custom) alert.addButtonWithTitle($("Standard wiederherstellen"));
    return { alert, rows, urls, localItems };
}

function collectPreset(built) {
    // Eine gewählte Kombination wird zum Typ „Local Dev“ mit „Anbieter Modell CLI“ als Prompt; der Name bleibt, was dasteht.
    const chosen = (row) => built.localItems[Number(row.popup.indexOfSelectedItem) - 1 - PRESET_TYPES.length];
    return {
        terminals: built.rows.filter((row) => Number(row.popup.indexOfSelectedItem) !== 0).map((row) => ({
            type: chosen(row) ? "Local Dev" : ObjC.unwrap(row.popup.titleOfSelectedItem), name: ObjC.unwrap(row.name.stringValue).trim(),
            prompt: chosen(row) ? chosen(row).prompt : ObjC.unwrap(row.prompt.stringValue), cwd: ObjC.unwrap(row.cwd.stringValue).trim(),
            placement: PRESET_PLACEMENTS[row.placement.indexOfSelectedItem]?.value,
        })),
        urls: ObjC.unwrap(built.urls.stringValue).split(",").map((url) => url.trim()).filter(Boolean),
    };
}

function buildTailscaleDevice(note, devices, user) {
    const view = $.NSView.alloc.initWithFrame($.NSMakeRect(0, 0, WIDTH, 118));
    view.addSubview(label("Gerät in deinem Tailnet", $.NSMakeRect(0, 100, WIDTH, 18), true));
    const popup = $.NSPopUpButton.alloc.initWithFramePullsDown($.NSMakeRect(0, 70, WIDTH, 26), false);
    devices.forEach((device) => popup.addItemWithTitle($([device.name, device.ip, device.os].filter(Boolean).join(" · "))));
    view.addSubview(popup);
    view.addSubview(label("Benutzername auf diesem Gerät", $.NSMakeRect(0, 44, WIDTH, 18), true));
    const field = $.NSTextField.alloc.initWithFrame($.NSMakeRect(0, 14, WIDTH, 24));
    field.stringValue = $(user || "");
    view.addSubview(field);
    const alert = $.NSAlert.alloc.init;
    alert.messageText = $("Gerät per SSH verbinden");
    alert.informativeText = $(note || "Tailscale bestätigt, dass es dein eigenes Gerät ist, deshalb brauchst du keine Zeile vom anderen Mac. " +
        "„Entfernte Anmeldung“ muss dort an sein. Fehlt dein Schlüssel noch, richtet ein Terminal ihn einmal mit dem Passwort ein.");
    alert.accessoryView = view;
    alert.addButtonWithTitle($("Verbinden"));
    alert.addButtonWithTitle($("Abbrechen"));
    return { alert, popup, user: field };
}

// Der Host ist eine Combo-Box: ein Feld zum Tippen (Alias aus ~/.ssh/config oder benutzer@host) mit einer Liste der Geräte, die schon
// verbunden sind. Ohne bekannte Geräte ist es einfach das Feld wie vorher.
function buildRemoteFolder(note, draft, known) {
    const choices = Array.isArray(known) ? known : [];
    const view = $.NSView.alloc.initWithFrame($.NSMakeRect(0, 0, WIDTH, 118));
    view.addSubview(label(choices.length ? "SSH-Host (Liste öffnen oder Alias / benutzer@host eintippen)"
        : "SSH-Host (Alias aus ~/.ssh/config oder benutzer@host)", $.NSMakeRect(0, 100, WIDTH, 18), true));
    const host = $.NSComboBox.alloc.initWithFrame($.NSMakeRect(0, 70, WIDTH, 24));
    choices.forEach((choice) => host.addItemWithObjectValue($(choice)));
    host.numberOfVisibleItems = 8;
    host.hasVerticalScroller = true;
    host.completes = true;                                  // beim Tippen ergänzt die Liste
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

// Die Freigabe-Maske: kurz und je nach Zustand. Aus: nur das Eine, was fehlt. An: Status, die Zeile für den anderen Mac in einem
// eigenen, markierbaren Feld und die zwei Schritte. Keine Terminal-Befehle: die gehören in die Doku, nicht in diese Maske.
function wrappingText(text, frame, mono) {
    const field = $.NSTextField.wrappingLabelWithString($(text));
    field.frame = frame;
    if (mono) field.font = $.NSFont.monospacedSystemFontOfSizeWeight(11, 0);
    return field;
}

function buildShare(share, notice, canInvite) {
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
        const status = (notice ? [notice] : []).concat(["Bereit: Dieser Mac nimmt SSH-Verbindungen an. ✓",
            share.awake ? "Wachhalten: an ✓" : "Wachhalten: aus. Der Mac kann einschlafen, dann ist er per SSH nicht erreichbar."]);
        if (!share.fingerprint) status.push("⚠︎ Der Host-Schlüssel ist nicht lesbar: der andere Mac kann den Fingerprint nicht prüfen.");
        // Wie weit die Zeile reicht: über Tailscale auch unterwegs, über den .local-Namen nur im selben Netz (ältere Module melden nichts).
        const reach = { running: share.via === "tailscale"
                ? "Tailscale: verbunden ✓ Die Zeile gilt auch unterwegs. Der andere Mac braucht Tailscale im selben Konto."
                : "Tailscale: verbunden, aber ohne nutzbaren Namen. Die Zeile gilt nur im selben Netz.",
            off: "Tailscale: installiert, aber nicht verbunden. Die Zeile gilt nur im selben Netz.",
            missing: "Tailscale: nicht installiert. Die Zeile gilt nur im selben Netz. Für unterwegs Tailscale auf beiden Macs installieren." }[share.tailscale];
        if (reach) status.push(reach);
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
        actions = (canInvite ? ["invite"] : []).concat(["allow", "copy"], share.awake ? [] : ["wake"], ["done"]);
    }
    const titles = { invite: "Gerät aus Tailscale freigeben…", allow: "Schlüssel eintragen…", copy: "Zeile kopieren", wake: "Wach halten", recheck: "Erneut prüfen", done: "Fertig" };
    actions.forEach((action) => alert.addButtonWithTitle($(titles[action])));
    return { alert, actions, line };
}

// ---------------------------------------------------------------- Übersicht (Widgets)

const PANEL = 724;
const PAD = 20;
const BUTTON_WIDTH = 90;
const BAR = 52;
const TAB_BAR = 48;

// So hoch, wie der Bildschirm es zulässt: die Knöpfe am Ende eines Bereichs sollen nicht erst hinter dem Scrollen liegen.
function maxContent() {
    const screen = $.NSScreen.mainScreen;
    const available = screen ? Number(screen.visibleFrame.size.height) : 800;
    return Math.max(420, Math.min(780, Math.floor(available - 140)));
}
const HEIGHTS = { section: 43, item: 54, note: 29, footer: 44 };

// Knöpfe im Fenster brauchen ein Ziel für ihre Aktion. Das Ergebnis wandert in dashboardAction;
// danach beendet das Fenster seine modale Schleife.
let dashboardActions = [];
let dashboardAction = null;
let selectDashboardTab;
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
        "selectTab:": {
            types: ["void", ["id"]],
            implementation: function (sender) {
                selectDashboardTab(Number(sender.tag));
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

function dashboardPage(rows, total, frame, makeButton) {
    const scroll = $.NSScrollView.alloc.initWithFrame(frame);
    scroll.hasVerticalScroller = total > Number(frame.size.height);
    scroll.drawsBackground = false;
    scroll.borderType = $.NSNoBorder;
    const width = Number(scroll.contentSize.width);
    const documentHeight = Math.max(total, Number(scroll.contentSize.height));
    const document = $.NSView.alloc.initWithFrame($.NSMakeRect(0, 0, width, documentHeight));
    const inner = width - 2 * PAD;
    const buttonWidth = (button) => Math.max(BUTTON_WIDTH, button.label.length * 7 + 28);
    let y = documentHeight - 6;
    rows.forEach((row) => {
        const height = HEIGHTS[row.type];
        y -= height;
        if (row.type === "section") {
            document.addSubview(styled(row.text, $.NSMakeRect(PAD, y + 12, inner, 21), { bold: true, size: 15 }));
            const line = $.NSBox.alloc.initWithFrame($.NSMakeRect(PAD, y + 6, inner, 1));
            line.boxType = $.NSBoxSeparator;
            document.addSubview(line);
        } else if (row.type === "item") {
            const actionsWidth = row.buttons.reduce((sum, button) => sum + buttonWidth(button) + 8, 0);
            const textWidth = inner - 20 - actionsWidth;
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
            let x = width - PAD - actionsWidth + 8;
            row.buttons.forEach((button) => {
                const size = buttonWidth(button);
                document.addSubview(makeButton(button, x, y + (height - 26) / 2, size));
                x += size + 8;
            });
        } else if (row.type === "note") {
            document.addSubview(styled(row.text, $.NSMakeRect(PAD + 20, y + 4, inner - 20, 18),
                { color: row.level === "warn" ? $.NSColor.systemOrangeColor : $.NSColor.secondaryLabelColor, truncate: true }));
        } else if (row.type === "footer") {
            let x = PAD + 20;
            row.buttons.forEach((button) => {
                const size = buttonWidth(button);
                document.addSubview(makeButton(button, x, y + 8, size));
                x += size + 8;
            });
        }
    });
    scroll.documentView = document;
    scroll.contentView.scrollToPoint($.NSMakePoint(0, documentHeight - Number(scroll.contentSize.height)));
    return scroll;
}

function buildDashboard(pages, selected = "workspaces") {
    const handler = $.VibeWorkspaceHandler.alloc.init;
    dashboardActions = [];
    dashboardAction = null;
    const buttons = [];
    const makeButton = (button, x, y, width) => {
        const view = $.NSButton.alloc.initWithFrame($.NSMakeRect(x, y, width, 26));
        view.title = $(button.label);
        if (button.checkbox) {
            view.setButtonType($.NSSwitchButton);
            view.state = button.checked ? $.NSControlStateValueOn : $.NSControlStateValueOff;
        } else {
            view.bezelStyle = $.NSBezelStyleRounded;
            if (button.primary) {
                view.bezelColor = $.NSColor.controlAccentColor;
                view.font = $.NSFont.boldSystemFontOfSize(12);
            }
        }
        view.tag = dashboardActions.length;
        view.target = handler;
        view.action = "act:";
        dashboardActions.push(button.action);
        buttons.push({ view, title: button.label, action: button.action });
        return view;
    };
    const totals = pages.map((page) => page.rows.reduce((sum, row) => sum + HEIGHTS[row.type], 18));
    const total = Math.max(...totals);
    const visible = Math.min(Math.max(320, total), maxContent() - TAB_BAR);
    const window = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer(
        $.NSMakeRect(0, 0, PANEL, visible + TAB_BAR + BAR), $.NSWindowStyleMaskTitled | $.NSWindowStyleMaskClosable,
        $.NSBackingStoreBuffered, false);
    window.title = $("VibeCode Workspace");
    window.releasedWhenClosed = false;
    window.delegate = handler;
    const tabs = $.NSTabView.alloc.initWithFrame($.NSMakeRect(0, BAR, PANEL, visible));
    tabs.tabViewType = $.NSNoTabsNoBorder;
    const content = tabs.contentRect;
    const frame = $.NSMakeRect(0, 0, content.size.width, content.size.height);
    pages.forEach((page, index) => {
        const tab = $.NSTabViewItem.alloc.initWithIdentifier($(page.id));
        tab.label = $(page.label);
        tab.view = dashboardPage(page.rows, totals[index], frame, makeButton);
        tabs.addTabViewItem(tab);
    });
    window.contentView.addSubview(tabs);

    const tabY = BAR + visible;
    const rule = $.NSBox.alloc.initWithFrame($.NSMakeRect(PAD, tabY, PANEL - 2 * PAD, 1));
    rule.boxType = $.NSBoxSeparator;
    window.contentView.addSubview(rule);
    const segmentWidth = Math.floor((PANEL - 2 * PAD) / pages.length);
    const navigation = pages.map((page, index) => {
        const x = PAD + index * segmentWidth;
        const view = $.NSButton.alloc.initWithFrame($.NSMakeRect(x, tabY + 6, segmentWidth, 36));
        view.title = $(page.label);
        view.bordered = false;
        view.setButtonType($.NSPushOnPushOffButton);
        view.target = handler;
        view.action = "selectTab:";
        view.tag = index;
        const indicator = $.NSBox.alloc.initWithFrame($.NSMakeRect(x + 12, tabY, segmentWidth - 24, 3));
        indicator.boxType = $.NSBoxCustom;
        indicator.borderWidth = 0;
        indicator.fillColor = $.NSColor.controlAccentColor;
        window.contentView.addSubview(view);
        window.contentView.addSubview(indicator);
        return { view, indicator };
    });
    selectDashboardTab = (index) => {
        tabs.selectTabViewItemAtIndex(index);
        navigation.forEach(({ view, indicator }, i) => {
            const active = i === index;
            view.state = active ? $.NSControlStateValueOn : $.NSControlStateValueOff;
            view.font = active ? $.NSFont.boldSystemFontOfSize(14) : $.NSFont.systemFontOfSize(14);
            indicator.hidden = !active;
        });
    };
    selectDashboardTab(Math.max(0, pages.findIndex((page) => page.id === selected)));
    const close = makeButton({ label: "Schließen", action: { action: "close" } }, PANEL - PAD - BUTTON_WIDTH, 13, BUTTON_WIDTH);
    close.keyEquivalent = $("\u001b");
    window.contentView.addSubview(close);
    return { window, buttons, tabs, navigation, total };
}

// Einziger Ort, an dem die Übersicht wirklich angezeigt wird; Tests ersetzen ihn.
function presentDashboard(built) {
    dashboardAction = null;
    const application = $.NSApplication.sharedApplication;
    application.activateIgnoringOtherApps(true);
    built.window.center;
    // Die App-Aktivierung ist eine Anfrage. Die Übersicht soll trotzdem vor dem Startterminal liegen.
    built.window.orderFrontRegardless;
    application.runModalForWindow(built.window);
    built.window.orderOut(null);
    return dashboardAction || { action: "close" };
}

function nativeUi(app) {
    let selectedTab = "workspaces";
    return {
        dashboard(state) {
            const built = buildDashboard(dashboardModel(state), selectedTab);
            const choice = presentDashboard(built);
            selectedTab = ObjC.unwrap(built.tabs.selectedTabViewItem.identifier);
            return choice;
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
        pickLocalDev(choices, kind) {
            const built = buildLocalDevSetting(choices, kind);
            const response = present(built.alert, built);
            if (!isButton(response, $.NSAlertFirstButtonReturn)) return null;
            return built.choices[Number(built.popup.indexOfSelectedItem)].value;
        },
        // Ein Dialog für "Neue Verbindung": Zeile einfügen (ggf. aus der Zwischenablage vorausgefüllt) oder die geführte Einrichtung.
        // Ergebnis: null (Abbrechen), {guided: true} oder {line}.
        askConnection(canGuide, prefill, note) {
            const buttons = canGuide ? ["Abbrechen", "Geführte Einrichtung…", "Verbinden"] : ["Abbrechen", "Verbinden"];
            try {
                const answer = app.displayDialog(
                    `${note ? `${note}\n\n` : ""}Füge die Zeile ein, die der andere Mac unter „Diesen Mac freigeben…“ anzeigt. ` +
                    `Sie beginnt mit „workspace remote ssh join“.${prefill ? "\n\nDie Zeile aus der Zwischenablage ist schon eingetragen." : ""}` +
                    `${canGuide ? "\n\nOhne die Zeile: „Geführte Einrichtung…“ (Host und Schlüssel im Terminal)." : ""}`, {
                        withTitle: "Neue Verbindung", defaultAnswer: prefill || "", buttons,
                        defaultButton: "Verbinden", cancelButton: "Abbrechen",
                    });
                return answer.buttonReturned === "Geführte Einrichtung…" ? { guided: true } : { line: answer.textReturned };
            } catch (error) {
                if (error.errorNumber === -128) return null;
                throw error;
            }
        },
        clipboardAllowLine() {
            try {
                return allowLineFrom(app.theClipboard());
            } catch (error) {
                return "";
            }
        },
        // In die Zwischenablage kopieren (NSPasteboard): dieselbe Zwischenablage wie Cmd+C, auch für Universal Clipboard.
        copy(text) {
            copyToBoard($.NSPasteboard.generalPasteboard, text);
        },
        // Wie info, mit einem zweiten Knopf, der die Zeile kopiert (und danach schließt: der nächste Schritt ist am anderen Mac).
        infoWithCopy(text, copyText) {
            const alert = $.NSAlert.alloc.init;
            alert.messageText = $("VibeCode Workspace");
            alert.informativeText = $(String(text));
            alert.addButtonWithTitle($("OK"));
            if (copyText) alert.addButtonWithTitle($("Zeile kopieren"));
            if (isButton(present(alert, null), $.NSAlertSecondButtonReturn) && copyText) {
                this.copy(copyText);
                this.notify("Zeile kopiert.");
            }
        },
        clipboardJoinLine() {
            try {
                return joinLineFrom(app.theClipboard());
            } catch (error) {
                return "";                                   // keine Textinhalte oder kein Zugriff: dann eben nicht vorausfüllen
            }
        },
        // Kurzer Hinweis ohne Fenster; scheitert er (Mitteilungen aus), bleibt der Ablauf derselbe.
        notify(text) {
            try {
                app.displayNotification(text, { withTitle: "VibeCode Workspace" });
            } catch (error) {
                // best effort
            }
        },
        askLine(title, prompt, prefill) {
            try {
                return app.displayDialog(prompt, {
                    withTitle: title, defaultAnswer: prefill || "", buttons: ["Abbrechen", "Weiter"],
                    defaultButton: "Weiter", cancelButton: "Abbrechen",
                }).textReturned;
            } catch (error) {
                if (error.errorNumber === -128) return null;
                throw error;
            }
        },
        share(state, notice, canInvite) {
            const built = buildShare(state, notice, canInvite);
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
        confirmRevoke(name, fingerprint) {
            const alert = $.NSAlert.alloc.init;
            alert.messageText = $("SSH-Freigabe widerrufen?");
            alert.informativeText = $(`Name: ${name}\nFingerprint: ${fingerprint}\n\nNeue Anmeldungen über diese Freigabe sind danach gesperrt. Laufende SSH-Sitzungen bleiben offen.`);
            alert.alertStyle = $.NSAlertStyleWarning;
            alert.addButtonWithTitle($("Abbrechen"));
            alert.addButtonWithTitle($("Widerrufen"));
            return isButton(present(alert, null), $.NSAlertSecondButtonReturn);
        },
        editPreset(repo, draft, custom, note, combos) {
            const built = buildPresetEditor(repo, draft, custom, note, combos);
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
        askRemoteFolder(note, suggestedHost, known) {
            let message = note;
            let draft = { host: suggestedHost || "", root: "" };
            for (;;) {
                const built = buildRemoteFolder(message, draft, known);
                const response = present(built.alert, built);
                if (!isButton(response, $.NSAlertFirstButtonReturn)) return null;
                draft = { host: ObjC.unwrap(built.host.stringValue).trim(), root: ObjC.unwrap(built.root.stringValue).trim() };
                if (draft.host) return draft;
                message = "Gib den SSH-Host an, zum Beispiel spark oder benutzer@server.";
            }
        },
        // Die Agenten-Liste. Ergebnis: "refresh", "remote" (nur wenn ein anderer Mac verbunden ist) oder "close".
        showAgents(model) {
            const alert = $.NSAlert.alloc.init;
            alert.messageText = $("Agenten");
            alert.informativeText = $(model.text);
            alert.addButtonWithTitle($("Aktualisieren"));
            if (model.remoteLabel) alert.addButtonWithTitle($(model.remoteLabel));
            alert.addButtonWithTitle($("Schließen"));
            const response = present(alert, null);
            if (isButton(response, $.NSAlertFirstButtonReturn)) return "refresh";
            return model.remoteLabel && isButton(response, $.NSAlertSecondButtonReturn) ? "remote" : "close";
        },
        // Ein Gerät aus dem Tailnet wählen (für die Einladung). Ergebnis: das Gerät oder null.
        pickTailscaleDevice(devices) {
            const alert = $.NSAlert.alloc.init;
            alert.messageText = $("Gerät aus Tailscale freigeben");
            alert.informativeText = $("Das gewählte Gerät bekommt eine Einladung per Taildrop. Es nimmt sie in VibeCode an (Bereich Remote → „Einladungen abholen“) " +
                "und schickt seinen öffentlichen Schlüssel zurück; den bestätigst du hier mit dem Fingerprint. Kein Passwort, keine Zeilen zum Kopieren.");
            const popup = $.NSPopUpButton.alloc.initWithFramePullsDown($.NSMakeRect(0, 0, WIDTH, 26), false);
            devices.forEach((device) => popup.addItemWithTitle($([device.name, device.ip, device.os].filter(Boolean).join(" · "))));
            alert.accessoryView = popup;
            alert.addButtonWithTitle($("Einladen"));
            alert.addButtonWithTitle($("Abbrechen"));
            const response = present(alert, { alert, popup });
            return isButton(response, $.NSAlertFirstButtonReturn) ? devices[Number(popup.indexOfSelectedItem)] : null;
        },
        // Eine Einladung des freigebenden Geräts annehmen? Ergebnis: true/false („Später“ lässt sie eine Stunde gespeichert).
        confirmInvite(invite) {
            const alert = $.NSAlert.alloc.init;
            alert.messageText = $(`Einladung von ${invite.device} annehmen?`);
            alert.informativeText = $(`${invite.device} lässt dich als ${invite.user} per SSH zu. Der Host-Schlüssel wird mit dem der Einladung verglichen und gemerkt, ` +
                "danach schickt dieser Mac seinen öffentlichen Schlüssel dorthin. Freigegeben wird erst, wenn du dort den Fingerprint bestätigst.");
            alert.addButtonWithTitle($("Annehmen"));
            alert.addButtonWithTitle($("Später"));
            return isButton(present(alert, null), $.NSAlertFirstButtonReturn);
        },
        // Gerät und Benutzername für „Gerät per SSH verbinden…“. Ergebnis: null (Abbrechen) oder {name, ip, user}.
        askTailscaleDevice(devices, defaultUser) {
            let note = "";
            let user = defaultUser;
            for (;;) {
                const built = buildTailscaleDevice(note, devices, user);
                const response = present(built.alert, built);
                if (!isButton(response, $.NSAlertFirstButtonReturn)) return null;
                user = ObjC.unwrap(built.user.stringValue).trim();
                if (/^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(user)) return Object.assign({ user }, devices[Number(built.popup.indexOfSelectedItem)]);
                note = "Gib den Benutzernamen auf dem anderen Mac an (Buchstaben, Ziffern, Punkt, Unterstrich, Minus).";
            }
        },
        confirmTailscale(kind) {
            const texts = {
                setup: ["Tailscale einrichten?", "Ein Terminal öffnet sich und installiert Tailscale als reines Kommandozeilenprogramm " +
                    "(Homebrew) und startet den Systemdienst. Dafür fragt macOS dort einmal nach deinem Admin-Passwort; VibeCode sieht es nie. " +
                    "Die Tailscale-App wird dafür nicht gebraucht.", "Terminal öffnen"],
                pair: ["Schlüssel auf dem anderen Mac einrichten?", "Dort ist dein Schlüssel noch nicht eingetragen. Ein Terminal öffnet sich und " +
                    "installiert ihn: du gibst einmal das Passwort des Benutzers auf dem anderen Mac ein, das VibeCode nie sieht. " +
                    "Danach noch einmal „Gerät per SSH verbinden…“ wählen, das bestätigt die Verbindung.", "Terminal öffnen"],
                keygen: ["SSH-Schlüssel auf diesem Mac erzeugen?", "Dieser Mac hat noch keinen SSH-Schlüssel. Ein Terminal öffnet sich und erzeugt einen " +
                    "(ed25519); die Passphrase wählst du selbst, leer ist erlaubt. Danach „Einladungen abholen“ noch einmal wählen: die Einladung bleibt gültig.",
                    "Terminal öffnen"],
                logout: ["Von Tailscale abmelden?", "Dieser Mac verlässt dein Tailnet und ist nicht mehr erreichbar, bis du dich wieder " +
                    "anmeldest. Laufende Verbindungen, auch Remote-Sitzungen im Editor, brechen ab.", "Abmelden"],
            }[kind];
            const alert = $.NSAlert.alloc.init;
            alert.messageText = $(texts[0]);
            alert.informativeText = $(texts[1]);
            alert.addButtonWithTitle($(texts[2]));
            alert.addButtonWithTitle($("Abbrechen"));
            return isButton(present(alert, null), $.NSAlertFirstButtonReturn);
        },
        confirmModelPull(name) {
            const alert = $.NSAlert.alloc.init;
            alert.messageText = $(`Modell „${name}“ laden?`);
            alert.informativeText = $("Ein Terminal öffnet sich und lädt das Modell mit „ollama pull“. Das kann mehrere GB groß sein und " +
                "dauert, bis es fertig ist. Danach hier unter Local Dev auf „Aktualisieren“ klicken.");
            alert.addButtonWithTitle($("Laden"));
            alert.addButtonWithTitle($("Abbrechen"));
            return isButton(present(alert, null), $.NSAlertFirstButtonReturn);
        },
        confirmModelRemove(name) {
            const alert = $.NSAlert.alloc.init;
            alert.messageText = $(`Modell „${name}“ entfernen?`);
            alert.informativeText = $("Das Modell wird von dieser Platte gelöscht. Zum erneuten Verwenden muss es wieder geladen werden. " +
                "Kombinationen und Terminals, die es nennen, bleiben gespeichert und warten dann auf das Modell.");
            alert.alertStyle = $.NSAlertStyleWarning;
            alert.addButtonWithTitle($("Abbrechen"));
            alert.addButtonWithTitle($("Entfernen"));
            return isButton(present(alert, null), $.NSAlertSecondButtonReturn);
        },
        // Ein Modellname zum Laden (jeder Name aus der Ollama-Bibliothek). Ergebnis: der Name oder null.
        askModelName() {
            let note = "";
            for (;;) {
                const field = $.NSTextField.alloc.initWithFrame($.NSMakeRect(0, 0, WIDTH, 24));
                field.placeholderString = $("zum Beispiel qwen2.5-coder:7b");
                const alert = $.NSAlert.alloc.init;
                alert.messageText = $("Ollama-Modell laden");
                alert.informativeText = $(note || "Name wie bei „ollama pull“. Ein Terminal öffnet sich und lädt das Modell; das kann mehrere GB groß sein.");
                alert.accessoryView = field;
                alert.addButtonWithTitle($("Laden"));
                alert.addButtonWithTitle($("Abbrechen"));
                if (!isButton(present(alert, { field }), $.NSAlertFirstButtonReturn)) return null;
                const name = ObjC.unwrap(field.stringValue).trim();
                if (name) return name;
                note = "Bitte einen Modellnamen eingeben, zum Beispiel qwen2.5-coder:7b.";
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

// Ohne Hauptmenü kennt ein Programm im Hintergrund (Accessory) weder Cmd+V noch Cmd+C, Cmd+X oder Cmd+A: Einfügen in die Textfelder
// der Dialoge ginge nicht. Ein Bearbeiten-Menü genügt; es bleibt unsichtbar, nur die Tastenkürzel wirken (an die Antwortkette,
// target nil). Der Eintrag davor ist das Programmmenü, ohne das macOS die weiteren Menüs nicht auswertet.
const EDIT_SHORTCUTS = [["Ausschneiden", "cut:", "x"], ["Kopieren", "copy:", "c"], ["Einsetzen", "paste:", "v"], ["Alles auswählen", "selectAll:", "a"]];

// Text in ein Pasteboard schreiben. Getrennt von der Zwischenablage, damit Tests ein eigenes Pasteboard nehmen können.
function copyToBoard(board, text) {
    board.clearContents;
    return Boolean(board.setStringForType($(String(text)), $.NSPasteboardTypeString));
}

function installEditMenu(application) {
    const mainMenu = $.NSMenu.alloc.init;
    const appItem = $.NSMenuItem.alloc.init;
    appItem.submenu = $.NSMenu.alloc.initWithTitle($("VibeCode Workspace"));
    mainMenu.addItem(appItem);
    const editItem = $.NSMenuItem.alloc.init;
    const edit = $.NSMenu.alloc.initWithTitle($("Bearbeiten"));
    EDIT_SHORTCUTS.forEach(([title, action, key]) => edit.addItemWithTitleActionKeyEquivalent($(title), action, $(key)));
    editItem.submenu = edit;
    mainMenu.addItem(editItem);
    application.mainMenu = mainMenu;
    return mainMenu;
}

function run(argv) {
    const [python, core] = argv;
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    const application = $.NSApplication.sharedApplication;
    application.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
    installEditMenu(application);
    application.activateIgnoringOtherApps(true);
    flow(nativeUi(app), makeBackend(app, python, core));
    return "";
}
