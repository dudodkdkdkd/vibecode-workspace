# VibeCode Workspace

Ein portabler macOS-Launcher für Multi-Repository-Workspaces in Visual Studio
Code oder Cursor. Du wählst die gewünschten Projekte aus; der Launcher erzeugt
einen gemeinsamen Workspace und startet pro Projekt die im Setup festgelegten
Terminals. Claude Code startet standardmäßig im YOLO-Modus; Codex mit
Workspace-Sandbox ohne Sicherheitsabfragen.

## Voraussetzungen

- macOS
- Visual Studio Code oder Cursor
- optional: Claude Code und Codex CLI

Fehlt Claude Code oder Codex, bleibt das jeweilige Terminal mit einem Hinweis
als normale Shell geöffnet.

## Schnellstart

### 1. Repository herunterladen

Entweder als ZIP über GitHub herunterladen oder mit Git klonen:

```zsh
git clone https://github.com/dudodkdkdkd/vibecode-workspace.git
cd vibecode-workspace
```

### 2. Repository-Ordner einrichten

Im Finder doppelt auf **Setup VibeCode Workspace.command** klicken.

Beim ersten Start kann macOS die Datei blockieren. Dann:

1. Rechtsklick auf **Setup VibeCode Workspace.command**
2. **Öffnen** auswählen
3. Den Start bestätigen

Im Setup gibt es drei Möglichkeiten:

- **Hinzufügen** behält alle vorhandenen Ordner und ergänzt neue.
- **Ersetzen** erstellt eine komplett neue Ordnerliste.
- **Terminals ändern** passt Anzahl und Inhalt für vorhandene Ordner an.

Danach die gewünschten Repository-Ordner auswählen. Für mehrere einzelne
Ordner beim Anklicken `⌘` gedrückt halten.

Anschließend die Repositories auswählen, deren Terminals du einrichten möchtest.
Für jedes davon fragt das Setup:

1. **Anzahl der Terminals** (auch `0` ist möglich).
2. Pro Terminal: **Shell**, **Claude Code**, **Codex** oder **Eigener Befehl**.
3. Bei Agenten einen optionalen **Startprompt**, bei eigenen Befehlen den
   **Shell-Command** (z. B. `npm run dev`).
4. **Terminalname** und optional einen **Unterordner** als Arbeitsverzeichnis.

So sind beispielsweise zwei Claude-Terminals mit unterschiedlichen Aufgaben,
ein Codex-Terminal und ein Dev-Server für dasselbe Repository möglich.
Nicht ausgewählte Repositories behalten ihre Terminal-Einstellungen; ohne
eigene Einstellungen gelten die drei Standard-Terminals. Abbrechen in einem
Dialog verwirft die Änderungen des gesamten Setup-Durchlaufs.

### 3. Starter auf den Schreibtisch legen

Empfohlen ist ein Finder-Alias. Dadurch bleibt die Originaldatei im Repository
und spätere Git-Updates gelten automatisch auch für den Schreibtisch-Starter:

1. Rechtsklick auf **VibeCode Workspace.command**
2. **Alias erzeugen** auswählen
3. Den Alias auf den Schreibtisch ziehen
4. Den Alias bei Bedarf in `VibeCode Workspace` umbenennen

Alternativ beim Ziehen auf den Schreibtisch `⌥` + `⌘` gedrückt halten. Eine
eigenständige Kopie entsteht beim Ziehen mit `⌥`; sie erhält jedoch keine
späteren Updates aus dem Repository.

### 4. Workspace starten

Den Starter auf dem Schreibtisch doppelt anklicken, Repositories auswählen und
**OK** drücken. Die zuletzt verwendete Auswahl wird beim nächsten Start wieder
vorselektiert.

## Später Ordner hinzufügen oder ändern

Einfach jederzeit erneut **Setup VibeCode Workspace.command** im geklonten
Repository ausführen:

- **Hinzufügen** für weitere Repository-Ordner
- **Ersetzen** zum vollständigen Neuaufbau der Liste
- **Terminals ändern** zum Anpassen der Terminals ohne neue Ordnerauswahl

Der Schreibtisch-Starter muss danach nicht neu erstellt werden. Er liest die
aktuelle Konfiguration bei jedem Start ein.

Die Ordnerliste lässt sich auch ohne Dialog ändern. Bestehende
Terminal-Einstellungen bleiben dabei erhalten; neue Repositories verwenden die
Standard-Terminals:

```zsh
./Setup\ VibeCode\ Workspace.command --add "$HOME/Projects/projekt-a"
./Setup\ VibeCode\ Workspace.command --replace "$HOME/Projects/projekt-a" "$HOME/Projects/projekt-b"
```

Direkt die Terminal-Dialoge öffnen:

```zsh
./Setup\ VibeCode\ Workspace.command --terminals
```

## Automatisch gestartete Terminals

Für Repositories ohne eigene Terminal-Auswahl legt der Workspace diese Tasks an:

- Shell
- Claude Code mit `--dangerously-skip-permissions`
- Codex mit `--sandbox workspace-write --ask-for-approval never`

Bei Codex bleibt die Sandbox aktiv. Aktionen, die sie verbietet, scheitern,
statt eine Freigabe anzufordern. Auch zuvor über das Setup gespeicherte
Codex-Terminals mit YOLO verwenden beim nächsten Workspace-Start diesen neuen
Standard; ihre Anzahl, Namen, Prompts und Arbeitsverzeichnisse bleiben erhalten.

**Achtung:** Claude Code läuft weiterhin im YOLO-Modus ohne Sicherheitsabfragen.
Verwende diese Starts nur in vertrauenswürdigen Projekten und vorzugsweise in
einer isolierten Umgebung. Login, erste
Einrichtung und Workspace-Vertrauen können weiterhin eine Bestätigung erfordern.

Beim ersten Öffnen kann VS Code fragen, ob automatische Workspace-Tasks erlaubt
werden. Diese Freigabe ist nötig, damit die Terminals automatisch starten.

### Terminalfarben pro Ordner

Alle vom Launcher gestarteten Terminals eines ausgewählten Repository-Ordners
bekommen dieselbe Symbolfarbe in der Terminal-Liste. Die Farben werden in der
Reihenfolge der ausgewählten Ordner vergeben: Blau, Grün, Magenta, Cyan, Gelb
und Rot; danach wiederholt sich die Palette. Drei ausgewählte Ordner haben also
drei unterschiedliche Farben, unabhängig von der Anzahl ihrer Terminals.

Die Farbtöne folgen dem Editor-Theme. Hintergrund und Warnfarben bleiben
unverändert. Die Farben gelten für neu gestartete Workspace-Tasks; bereits
laufende oder manuell geöffnete Terminals werden nicht nachträglich umgefärbt.

### Terminals und Commands frei festlegen

Am einfachsten über **Terminals ändern** im Setup. Diese Auswahl gilt pro
Repository und ersetzt dort sowohl `AUTO_TERMINALS` als auch `TERMINALS` aus
`config.local.zsh`, damit genau die eingestellte Anzahl geöffnet wird. `0`
unterdrückt auch lokale Zusatz-Terminals. Die Zuordnung erfolgt über den
absoluten Repository-Pfad, unabhängig vom Anzeigenamen.

Alternativ bestimmt `AUTO_TERMINALS` in `config.local.zsh` die Standard-Terminals
für Repositories ohne Setup-Auswahl. Jede Zeile enthält Anzeigename, Command
und optional ein relatives Arbeitsverzeichnis:

```zsh
AUTO_TERMINALS=(
  "Shell|exec zsh -l|"
  "Claude Code|claude --dangerously-skip-permissions|"
  "Codex|codex --sandbox workspace-write --ask-for-approval never|"
  "Tests|npm test|frontend"
)
```

Eine Zeile entfernen deaktiviert dieses Terminal. Mit
`AUTO_TERMINALS=()` werden keine allgemeinen Terminals angelegt. Commands dürfen
beliebige Optionen enthalten, aber kein `|`, weil dieses Zeichen als
Feldtrenner dient.

Eigene Befehle im Setup dürfen auch Pipes (`|`) und Anführungszeichen enthalten.
Startprompts werden als einzelnes Argument übergeben; enthaltene Shell-Zeichen
werden dabei nicht als Befehle ausgeführt.

Für einen Agentenstart mit den persönlichen CLI-Standardeinstellungen im Setup
**Eigener Befehl** wählen und `claude` oder `codex` eintragen. Eigene Befehle und
manuell angepasste Befehle in `config.local.zsh` werden nicht automatisch
umgeschrieben.

Zusätzliche projektspezifische Tasks für Repositories ohne Setup-Auswahl können
in `config.local.zsh` definiert werden:

```zsh
TERMINALS=(
  "Mein Projekt|Frontend|npm run dev|frontend"
  "Mein Projekt|Backend|npm run dev|backend"
)
```

Format:

```text
Projektname|Terminalname|Befehl|relatives Arbeitsverzeichnis
```

## Konfiguration und Datenschutz

Das Setup speichert persönliche Ordnerpfade außerhalb des Repositories:

```text
~/.config/vibecode-workspace/projects.tsv
~/.config/vibecode-workspace/terminals.json
```

`terminals.json` enthält die Terminal-Anzahl, Typen, Namen, Startprompts, Befehle
und Arbeitsverzeichnisse pro Repository. Diese Datei wird als JSON gelesen,
nicht als Shell-Konfiguration ausgeführt. Befehle laufen erst mit den
Workspace-Tasks. Auch diese Datei kann persönliche Aufgaben enthalten und
gehört nicht in Git.

Die zuletzt verwendete Auswahl liegt ebenfalls nur im Benutzerprofil:

```text
~/.config/vibecode-workspace/last-selection.txt
```

Für erweiterte Einstellungen kann `config.example.zsh` kopiert werden:

```zsh
cp config.example.zsh config.local.zsh
```

`config.local.zsh` ist in `.gitignore` eingetragen. Persönliche Pfade und lokale
Befehle werden daher nicht committed. Zusätzlich ignoriert Git vorsorglich
`projects.tsv`, `terminals.json`, `last-selection.txt`, `.code-workspace`-Dateien sowie übliche
Editor-Metadaten.

## Terminalfenster des Starters

Nach einem erfolgreichen Durchlauf schließt der Launcher sein eigenes
Apple-Terminal-Fenster, sofern darin nur der Starter läuft. Enthält das Fenster
weitere Tabs, bleibt es zum Schutz dieser Sitzungen offen. Andere Fenster werden
nicht verändert. Bei einem Fehler bleibt das Starterfenster geöffnet und macOS
zeigt zusätzlich einen Fehlerdialog an.

Das automatische Schließen lässt sich in `config.local.zsh` deaktivieren:

```zsh
CLOSE_LAUNCHER_TERMINAL=false
```

## Dateien im Repository

- `VibeCode Workspace.command` – Schreibtisch-Launcher
- `Setup VibeCode Workspace.command` – Ordner und Terminals einrichten
- `terminal-setup.js` – macOS-Dialoge für die Terminal-Konfiguration
- `config.example.zsh` – öffentliche Konfigurationsvorlage
- `config.local.zsh` – optionale lokale Konfiguration, von Git ignoriert
- `.gitignore` – Schutz für lokale und generierte Dateien

## Fehlerbehebung

### Starter öffnet sich nur als Text

Die `.command`-Datei im Finder öffnen, nicht im VS-Code-Dateibaum. Beim ersten
Start Rechtsklick → **Öffnen** verwenden.

### Keine Repositories eingerichtet

**Setup VibeCode Workspace.command** ausführen und mindestens einen Ordner
hinzufügen.

### VS Code oder Cursor wird nicht gefunden

Eine der beiden Apps in `/Applications` installieren. Der Launcher findet die
App auch dann, wenn `code` oder `cursor` nicht im Terminal-PATH liegen.

### Diagnose ohne Fenster

```zsh
./VibeCode\ Workspace.command --check
```

Das prüft Editor, Systembefehle und die Anzahl gültiger Projekte, ohne einen
Workspace zu öffnen.

### Änderungen testen

Auf macOS mit installiertem Node.js:

```zsh
node --test tests/terminals.test.js
```

Die Tests prüfen Setup-Speicherung, Abbrechen, Startprompts und die erzeugten
Workspace-Tasks in temporären Ordnern. Dialogantworten werden simuliert; es
werden weder ein Editor noch echte Agentensitzungen geöffnet.

## Artwork

Das Artwork am Anfang des Starters ist vollständig auskommentiert und verändert
die Ausführung nicht. Finder kann es als Vorschau der `.command`-Datei anzeigen.
