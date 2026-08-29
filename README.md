# VibeCode Workspace

Ein portabler macOS-Launcher für Multi-Repository-Workspaces in Visual Studio
Code oder Cursor. Du wählst die gewünschten Projekte aus; der Launcher erzeugt
einen gemeinsamen Workspace und startet pro Projekt Shell, Claude Code und
Codex in eigenen Terminal-Gruppen.

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

Im Setup gibt es zwei Möglichkeiten:

- **Hinzufügen** behält alle vorhandenen Ordner und ergänzt neue.
- **Ersetzen** erstellt eine komplett neue Ordnerliste.

Danach die gewünschten Repository-Ordner auswählen. Für mehrere einzelne
Ordner beim Anklicken `⌘` gedrückt halten.

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

Der Schreibtisch-Starter muss danach nicht neu erstellt werden. Er liest die
aktuelle Konfiguration bei jedem Start ein.

Optional funktioniert das Setup auch ohne Dialog:

```zsh
./Setup\ VibeCode\ Workspace.command --add "$HOME/Projects/projekt-a"
./Setup\ VibeCode\ Workspace.command --replace "$HOME/Projects/projekt-a" "$HOME/Projects/projekt-b"
```

## Automatisch gestartete Terminals

Für jedes ausgewählte Repository legt der Workspace standardmäßig diese Tasks
an:

- Shell
- Claude Code
- Codex

Beim ersten Öffnen kann VS Code fragen, ob automatische Workspace-Tasks erlaubt
werden. Diese Freigabe ist nötig, damit die Terminals automatisch starten.

### Terminals und Commands frei festlegen

In `config.local.zsh` bestimmt `AUTO_TERMINALS`, welche Terminals für jedes
ausgewählte Repository geöffnet werden. Jede Zeile enthält Anzeigename, Command
und optional ein relatives Arbeitsverzeichnis:

```zsh
AUTO_TERMINALS=(
  "Shell|exec zsh -l|"
  "Claude Code|claude|"
  "Codex|codex|"
  "Tests|npm test|frontend"
)
```

Eine Zeile entfernen deaktiviert dieses Terminal. Mit
`AUTO_TERMINALS=()` werden keine allgemeinen Terminals angelegt. Commands dürfen
beliebige Optionen enthalten, aber kein `|`, weil dieses Zeichen als
Feldtrenner dient.

Optionen wie `codex --yolo` oder
`claude --dangerously-skip-permissions` können ebenfalls eingetragen werden,
deaktivieren aber die Sicherheitsabfragen der jeweiligen Agenten. Solche
Einstellungen gehören ausschließlich in die von Git ignorierte
`config.local.zsh`, nicht in die öffentliche Beispielkonfiguration.

Zusätzliche projektspezifische Tasks können in `config.local.zsh` definiert
werden:

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
```

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
`projects.tsv`, `last-selection.txt`, `.code-workspace`-Dateien sowie übliche
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
- `Setup VibeCode Workspace.command` – Ordner hinzufügen oder ersetzen
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

## Artwork

Das Artwork am Anfang des Starters ist vollständig auskommentiert und verändert
die Ausführung nicht. Finder kann es als Vorschau der `.command`-Datei anzeigen.
