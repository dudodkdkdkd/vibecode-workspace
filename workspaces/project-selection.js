ObjC.import("AppKit");

function readLines(path) {
    const value = $.NSString.stringWithContentsOfFileEncodingError(
        $(path), $.NSUTF8StringEncoding, null
    );
    if (!value) throw new Error(`Datei konnte nicht gelesen werden: ${path}`);
    return ObjC.unwrap(value).split(/\r?\n/).filter(Boolean);
}

function createProjectDialog(names, defaults) {
    const width = 460;
    const rowHeight = 28;
    const height = names.length * rowHeight;
    const list = $.NSView.alloc.initWithFrame($.NSMakeRect(0, 0, width, height));
    const checkboxes = names.map((name, index) => {
        const checkbox = $.NSButton.alloc.initWithFrame(
            $.NSMakeRect(8, height - (index + 1) * rowHeight, width - 16, rowHeight)
        );
        checkbox.setButtonType($.NSSwitchButton);
        checkbox.title = $(name);
        checkbox.state = defaults.includes(name) ? $.NSControlStateValueOn : $.NSControlStateValueOff;
        list.addSubview(checkbox);
        return checkbox;
    });

    const scroll = $.NSScrollView.alloc.initWithFrame(
        $.NSMakeRect(0, 0, width, Math.min(height, 336))
    );
    scroll.hasVerticalScroller = true;
    scroll.documentView = list;
    scroll.contentView.scrollToPoint($.NSMakePoint(0, Math.max(0, height - 336)));

    const alert = $.NSAlert.alloc.init;
    alert.messageText = $("Vibe Workspace");
    alert.informativeText = $("Welche Repositories sollen geöffnet werden? Klicke die gewünschten Projekte an. Mehrere Häkchen sind möglich. Neue Git-Repositories in den bekannten Elternordnern werden bei jedem Start ergänzt. Weitere Ordner kannst du im Workspace-Setup hinzufügen.");
    alert.accessoryView = scroll;
    alert.addButtonWithTitle($("Öffnen"));
    alert.addButtonWithTitle($("Abbrechen"));
    return { alert, checkboxes };
}

function run(argv) {
    const [namesFile, defaultsFile] = argv;
    const names = readLines(namesFile);
    if (!names.length) return "";

    const { alert, checkboxes } = createProjectDialog(names, readLines(defaultsFile));
    const app = $.NSApplication.sharedApplication;
    app.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
    app.activateIgnoringOtherApps(true);
    while (alert.runModal === $.NSAlertFirstButtonReturn) {
        const selected = names.filter((_, index) => checkboxes[index].state === $.NSControlStateValueOn);
        if (selected.length) return selected.join("\n");
        alert.informativeText = $("Wähle mindestens ein Projekt aus oder klicke auf Abbrechen.");
    }
    return "";
}
