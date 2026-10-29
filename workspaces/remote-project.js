// JXA: Remote-Repositories ohne lokalen Checkout im Setup eintragen.
function setupApplication() {
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    return app;
}

function remoteProject(host, path, name) {
    host = host.trim();
    path = path.trim();
    if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.@-]*$/.test(host)) {
        throw new Error("Bitte einen SSH-Hostalias (z. B. spark) oder benutzer@host angeben. Port und Schlüssel gehören in ~/.ssh/config.");
    }
    if (!path.startsWith("/") || /[\x00-\x1f\x7f]/.test(path) || path.split("/").some((part) => part === ".." || part === ".")) {
        throw new Error("Bitte den absoluten Repository-Pfad auf dem Server ohne '.' oder '..' angeben (z. B. /home/user/projects/app).");
    }
    path = path.replace(/\/+$/, "") || "/";
    name = (name || `${path.split("/").pop() || "Remote"} [SSH: ${host}]`).trim();
    if (!name || /[\x00-\x1f\x7f]/.test(name)) throw new Error("Bitte einen gültigen Projektnamen angeben.");
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    return `${name}\tvscode-remote://ssh-remote+${host}${encodedPath}`;
}

function remoteHost(host, root) {
    host = host.trim();
    root = root.trim() || "~";
    // Dieselbe Hostvalidierung wie bei einzelnen Remote-Repositories.
    remoteProject(host, "/", "Remote");
    if (!(root.startsWith("/") || root === "~" || root.startsWith("~/")) ||
        /[\x00-\x1f\x7f]/.test(root) || root.split("/").some((part) => part === "." || part === "..")) {
        throw new Error("Bitte einen absoluten Suchordner oder ~/Unterordner angeben. Leer lassen = Home-Verzeichnis auf dem Server.");
    }
    return `${host}\t${root.replace(/\/+$/, "") || "/"}`;
}

function configureHost(argv) {
    if (argv.length) {
        if (argv.length > 2) throw new Error("Aufruf: --add-remote-host SSH-Host [Suchordner]");
        return remoteHost(argv[0], argv[1] || "~");
    }
    const app = setupApplication();
    let host = "", root = "";
    function ask(text, defaultAnswer) {
        return app.displayDialog(text, { withTitle: "Remote-Host hinzufügen", defaultAnswer,
            buttons: ["Abbrechen", "Weiter"], defaultButton: "Weiter", cancelButton: "Abbrechen" }).textReturned;
    }
    try {
        while (true) {
            host = ask("SSH-Hostalias aus ~/.ssh/config oder user@host:", host);
            root = ask("In welchem Ordner sollen Git-Repositories gesucht werden?\n\nLeer = gesamtes Home-Verzeichnis auf dem Server. Alternativ z. B. ~/projects oder /srv/repos. Unterordner werden automatisch durchsucht. Neue Repositories erscheinen bei jedem Start in der Projektauswahl.", root);
            try { return remoteHost(host, root); }
            catch (error) { app.displayAlert(error.message); }
        }
    } catch (error) {
        if (error.errorNumber === -128) return "";
        throw error;
    }
}

function run(argv) {
    if (argv[0] === "--host") return configureHost(argv.slice(1));
    if (argv.length) {
        if (argv.length < 2 || argv.length > 3) throw new Error("Aufruf: --add-remote SSH-Host /absoluter/Repo-Pfad [Anzeigename]");
        return remoteProject(argv[0], argv[1], argv[2]);
    }
    const app = setupApplication();
    function ask(text, defaultAnswer) {
        return app.displayDialog(text, {
            withTitle: "Remote-Repository hinzufügen", defaultAnswer,
            buttons: ["Abbrechen", "Weiter"], defaultButton: "Weiter", cancelButton: "Abbrechen",
        }).textReturned;
    }
    let host = "", path = "", name = "";
    try {
        while (true) {
            host = ask("SSH-Hostalias aus ~/.ssh/config oder benutzer@host:\n\nVS Code verbindet sich per Remote SSH. Terminals, Agenten und Git arbeiten auf diesem Rechner.", host);
            path = ask("Absoluter Pfad des vorhandenen Repositorys auf dem Server (z. B. /home/user/projects/app):", path);
            name = ask("Anzeigename (leer = Ordnername mit SSH-Host):", name);
            try { return remoteProject(host, path, name); }
            catch (error) { app.displayAlert(error.message); }
        }
    } catch (error) {
        if (error.errorNumber === -128) return "";
        throw error;
    }
}
