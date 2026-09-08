// Native settings and quick actions. Persistence and validation live in remote.py.
function run(argv) {
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    const c = JSON.parse(argv[0]);
    try {
        const actions = ['Jetzt 1h', 'Jetzt 3h', 'Jetzt 6h', 'Bis Mitternacht',
            'Sitzung beenden', 'Remote deaktivieren', 'Einstellungen', 'Zeitplan anwenden'];
        const action = app.chooseFromList(actions, {
            withTitle: 'Remote Codex',
            withPrompt: 'Zeitplan nach Änderungen mit „Zeitplan anwenden“ registrieren.',
            defaultItems: ['Einstellungen']
        });
        if (action === false) return '';
        const commands = ['1h', '3h', '6h', 'until-midnight', 'off', 'disable', 'settings', 'install'];
        const command = commands[actions.indexOf(action[0])];
        if (command !== 'settings') return JSON.stringify({ command });
        const flags = {
            'Zeitplan aktiviert': 'enabled',
            'Mac automatisch aufwecken': 'wake_mac',
            'Während Sitzung wachhalten': 'keep_awake',
            'App(s) bei Absturz neu starten': 'restart_if_crashed',
            'App(s) nach Sitzung automatisch schließen': 'close_apps_after',
            'Letzten Workspace öffnen': 'open_workspace',
            'Workspace-Terminals starten': 'open_terminals',
            'Remote-Steuerterminal mitöffnen': 'open_control_terminal',
            'Nach Sitzung sofort schlafen (sonst normaler Ruhezustand)': 'force_sleep'
        };
        const selected = app.chooseFromList(Object.keys(flags), {
            withTitle: 'Remote · Optionen',
            withPrompt: 'Mit ⌘ Optionen auswählen oder abwählen.',
            defaultItems: Object.keys(flags).filter(label => c[flags[label]]),
            multipleSelectionsAllowed: true, emptySelectionAllowed: true
        });
        if (selected === false) return '';
        Object.keys(flags).forEach(label => { c[flags[label]] = selected.includes(label); });
        const appsAnswer = app.displayDialog('Apps öffnen & wachhalten (Komma-getrennt, exakter App-Name, z. B. Codex, Claude)', {
            defaultAnswer: (c.apps || []).join(', '), withTitle: 'Remote · Apps'
        }).textReturned;
        c.apps = appsAnswer.split(',').map(s => s.trim()).filter(Boolean);
        const labels = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
        const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        const chosenDays = app.chooseFromList(labels, {
            withTitle: 'Remote · Wochentage', multipleSelectionsAllowed: true,
            defaultItems: labels.filter((label, i) => c.days.includes(days[i]))
        });
        if (chosenDays === false) return '';
        c.days = chosenDays.map(label => days[labels.indexOf(label)]);
        c.start = app.displayDialog('Startzeit (lokale Mac-Zeit, HH:MM)', {
            defaultAnswer: c.start, withTitle: 'Remote · Start'
        }).textReturned;
        c.duration = app.displayDialog('Dauer (z. B. 5h oder 90m, maximal 24h)', {
            defaultAnswer: c.duration, withTitle: 'Remote · Dauer'
        }).textReturned;
        return JSON.stringify({ config: c });
    } catch (error) {
        if (error.errorNumber === -128) return '';
        throw error;
    }
}
