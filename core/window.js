// VibeCode Hauptfenster (JXA/AppKit). Aufruf (macht core/vibecode.py):
//   osascript -l JavaScript window.js <python> <vibecode.py>
// Die Logik liegt in vibecode.py; dieses Fenster zeigt sie nur an und ruft sie auf.
ObjC.import("AppKit");

const WIDTH = 460;
const ROW = 26;

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
            ...(workspace.renameFrom ? [`--rename-from=${workspace.renameFrom}`] : [])),
        remove: (name) => call("delete", `--name=${name}`),
        start: (name) => call("start", `--name=${name}`),
        open: (id) => call("open", id),
        syncShortcuts: () => call("shortcuts", "sync"),
    };
}

// ---------------------------------------------------------------- Ablauf (ohne Widgets)

function editLoop(ui, backend, state, existing) {
    let draft = existing
        ? { name: existing.name, projects: existing.projects.slice(), shortcut: existing.shortcut }
        : { name: "", projects: [], shortcut: false };
    let message = "";
    for (;;) {
        const result = ui.edit(state, draft, existing, message);
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
            backend.save({
                name: result.name, projects: result.projects, shortcut: result.shortcut,
                renameFrom: existing ? existing.name : null,
            });
            return result.name;
        } catch (error) {
            // Eingaben behalten: wer einen doppelten Namen tippt, soll nicht alles neu anklicken.
            draft = result;
            message = cleanMessage(error);
        }
    }
}

function flow(ui, backend) {
    let selected = null;
    for (;;) {
        let state;
        try {
            state = backend.state();
        } catch (error) {
            ui.error(cleanMessage(error));
            return;
        }
        const choice = ui.main(state, selected);
        if (!choice || choice.action === "close") return;
        if (choice.name) selected = choice.name;
        try {
            if (choice.action === "start") {
                backend.start(choice.name);
                return;
            }
            if (choice.action === "new" || choice.action === "edit") {
                if (!state.projects.length) {
                    ui.error("Der Launcher kennt noch keine Projekte. Öffne „Mehr…“ und richte zuerst die Repository-Ordner ein.");
                    continue;
                }
                const existing = choice.action === "edit"
                    ? state.workspaces.find((workspace) => workspace.name === choice.name) : null;
                const saved = editLoop(ui, backend, state, existing);
                if (saved) selected = saved;
            } else if (choice.action === "more") {
                const pick = ui.more(state.entries);
                if (pick === "sync") ui.info(backend.syncShortcuts());
                else if (pick) backend.open(pick);
            }
        } catch (error) {
            ui.error(cleanMessage(error));
        }
    }
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

function summary(state) {
    if (!state.workspaces.length) {
        return "Noch kein Workspace. Lege mit „Neuer Workspace…“ einen an: Name, Projekte und auf Wunsch ein Shortcut auf dem Schreibtisch.";
    }
    return state.workspaces.map((workspace) => {
        const parts = [`${workspace.name}: ${workspace.projects.join(", ")}`,
            workspace.shortcut ? "Schreibtisch ✓" : "kein Shortcut"];
        if (workspace.missing.length) parts.push(`⚠︎ nicht gefunden: ${workspace.missing.join(", ")}`);
        return parts.join(" · ");
    }).join("\n");
}

const MAIN_BUTTONS = {
    start: "Starten", edit: "Bearbeiten…", new: "Neuer Workspace…", more: "Mehr…", close: "Schließen",
};

function buildMain(state, selected) {
    const alert = $.NSAlert.alloc.init;
    alert.messageText = $("VibeCode");
    alert.informativeText = $(summary(state));
    let popup = null;
    if (state.workspaces.length) {
        popup = $.NSPopUpButton.alloc.initWithFramePullsDown($.NSMakeRect(0, 0, WIDTH, 26), false);
        state.workspaces.forEach((workspace) => popup.addItemWithTitle($(workspace.name)));
        if (selected && state.workspaces.some((workspace) => workspace.name === selected)) {
            popup.selectItemWithTitle($(selected));
        }
        alert.accessoryView = popup;
    }
    const actions = state.workspaces.length ? ["start", "edit", "new", "more", "close"] : ["new", "more", "close"];
    actions.forEach((action) => alert.addButtonWithTitle($(MAIN_BUTTONS[action])));
    return { alert, popup, actions };
}

function collectMain(built, response) {
    const action = built.actions[Number(response) - Number($.NSAlertFirstButtonReturn)];
    if (!action) return null;
    return { action, name: built.popup ? ObjC.unwrap(built.popup.titleOfSelectedItem) : null };
}

function buildEdit(state, draft, existing, message) {
    const names = state.projects.concat(draft.projects.filter((name) => !state.projects.includes(name)));
    const listHeight = Math.min(Math.max(names.length, 1) * ROW, 220);
    const total = 18 + 8 + 24 + 14 + 18 + 6 + listHeight + 14 + 24;
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

    const alert = $.NSAlert.alloc.init;
    alert.messageText = $(existing ? `Workspace „${existing.name}“ bearbeiten` : "Neuer Workspace");
    alert.informativeText = $(message || "Ein Workspace ist eine benannte Auswahl von Projekten. Mit Shortcut startet er per Doppelklick vom Schreibtisch, ohne Auswahldialog.");
    alert.accessoryView = view;
    alert.addButtonWithTitle($("Speichern"));
    alert.addButtonWithTitle($("Abbrechen"));
    if (existing) alert.addButtonWithTitle($("Löschen…"));
    return { alert, field, boxes, names, shortcut };
}

function collectEdit(built) {
    return {
        name: ObjC.unwrap(built.field.stringValue).trim(),
        projects: built.names.filter((_, index) => built.boxes[index].state === $.NSControlStateValueOn),
        shortcut: built.shortcut.state === $.NSControlStateValueOn,
    };
}

function nativeUi(app) {
    return {
        main(state, selected) {
            const built = buildMain(state, selected);
            return collectMain(built, present(built.alert, built));
        },
        edit(state, draft, existing, message) {
            let note = message;
            let current = draft;
            for (;;) {
                const built = buildEdit(state, current, existing, note);
                const response = present(built.alert, built);
                if (isButton(response, $.NSAlertSecondButtonReturn)) return null;
                if (isButton(response, $.NSAlertThirdButtonReturn) && existing) return { remove: true };
                current = collectEdit(built);
                if (!current.name) note = "Gib dem Workspace einen Namen.";
                else if (!current.projects.length) note = "Wähle mindestens ein Projekt aus.";
                else return current;
            }
        },
        more(entries) {
            const items = entries.map((entry) => entry.title).concat(["Schreibtisch-Shortcuts erneuern"]);
            const chosen = app.chooseFromList(items, {
                withTitle: "VibeCode", withPrompt: "Was möchtest du öffnen?",
                okButtonName: "Öffnen", cancelButtonName: "Zurück",
            });
            if (chosen === false) return null;
            const entry = entries.find((candidate) => candidate.title === chosen[0]);
            return entry ? entry.id : "sync";
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
            alert.messageText = $("VibeCode");
            alert.informativeText = $(String(text));
            alert.addButtonWithTitle($("OK"));
            present(alert, null);
        },
        error(text) {
            const alert = $.NSAlert.alloc.init;
            alert.messageText = $("VibeCode");
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
