# VibeCode Workspace

Ein macOS-Launcher, der ein oder mehrere lokale Git-Repositories als gemeinsamen
Visual-Studio-Code-Workspace öffnet. Pro Projekt lassen sich integrierte Terminals
und Entwicklungsbefehle definieren.

## Inhalt des Repositories

- `VibeCode Workspace.command` – der portable, ausführbare Starter
- `config.example.zsh` – committed Beispielkonfiguration
- `config.local.zsh` – persönliche, von Git ignorierte Konfiguration
- `README.md` – Einrichtung und Konfiguration

## Starter auf den Schreibtisch ziehen

Der Starter enthält keine Pfade eines bestimmten Benutzers. Nach einem frischen
Download oder `git clone` kann er auf jedem Mac verwendet werden.

### Empfohlen: Alias mit automatischen Updates

Damit der Starter im Repository bleibt und spätere Git-Updates automatisch auch
auf dem Schreibtisch gelten:

1. Das heruntergeladene Repository im Finder öffnen.
2. `VibeCode Workspace.command` mit der rechten Maustaste anklicken und
   **Alias erzeugen** wählen.
3. Den erzeugten Alias auf den Schreibtisch ziehen.
4. Den Alias bei Bedarf wieder in `VibeCode Workspace` umbenennen.

Alternativ kann direkt beim Ziehen auf den Schreibtisch `⌥` + `⌘` gedrückt
gehalten werden. Dadurch erzeugt der Finder ebenfalls einen Alias, statt die
Originaldatei aus dem Repository zu verschieben.

### Portable Einzeldatei

Die Datei kann auch eigenständig auf den Schreibtisch kopiert werden. Beim
Ziehen dafür `⌥` gedrückt halten, damit der Finder eine Kopie erstellt und die
Originaldatei im Repository erhalten bleibt. Die kopierte Datei funktioniert
ohne das Repository, erhält aber keine späteren Git-Updates.

## Starten

Auf dem Schreibtisch `VibeCode Workspace` doppelklicken. Beim ersten Start kann
macOS eine Sicherheitsabfrage anzeigen. In diesem Fall den Starter mit der
rechten Maustaste anklicken, **Öffnen** wählen und den Start bestätigen.

Der Launcher erkennt die installierte Visual-Studio-Code-App automatisch, auch
wenn der `code`-Befehl nicht im `PATH` liegt. Alternativ wird Cursor erkannt.

Wenn noch keine gültigen Projekte konfiguriert sind, erscheint beim ersten Start
eine Finder-Ordnerauswahl. Die ausgewählten Repositories werden nur für das
jeweilige Benutzerkonto gespeichert:

```text
~/.config/vibecode-workspace/projects.tsv
```

Wenn der Starter als Alias direkt aus dem geklonten Repository gestartet wird,
erkennt und ergänzt er dieses Repository automatisch.

### Terminalfenster des Starters

Nach einem vollständig erfolgreichen Start schließt der Launcher nur den eigenen
Apple-Terminal-Tab automatisch. Andere Terminalfenster und Tabs bleiben offen.
Tritt ein Fehler auf, bleibt der Starter-Tab zur Diagnose geöffnet und macOS
zeigt zusätzlich einen Fehlerdialog an.

Das automatische Schließen kann in `config.local.zsh` deaktiviert werden:

```zsh
CLOSE_LAUNCHER_TERMINAL=false
```

### Repository-Auswahl

Der macOS-Standarddialog unterstützt Mehrfachauswahl. Um die markierte
Kombination zu ändern, beim Anklicken mehrerer Einträge `⌘` gedrückt halten.
Die Auswahl wird nach dem Öffnen gespeichert und beim nächsten Start bereits
markiert. Dann genügt normalerweise ein Klick auf **OK**.

Die zuletzt verwendete Auswahl liegt benutzerspezifisch unter:

```text
~/.config/vibecode-workspace/last-selection.txt
```

## Projekte konfigurieren

Die Finder-Ersteinrichtung genügt normalerweise. Für eine dateibasierte
Konfiguration die Vorlage kopieren:

```zsh
cp config.example.zsh config.local.zsh
```

Anschließend nur `config.local.zsh` bearbeiten:

```zsh
PROJECTS=(
  "Mein Projekt|$HOME/Documents/GitHub/mein-projekt"
  "Zweites Projekt|$HOME/Projects/zweites-projekt"
)
```

`config.local.zsh` wird vom Starter automatisch geladen und steht in
`.gitignore`. Persönliche Pfade und Befehle gelangen daher nicht versehentlich
ins Repository. Änderungen am Starter oder an `config.example.zsh` können normal
committed werden.

Nicht mehr vorhandene Pfade werden ignoriert. Sind alle gespeicherten Pfade
ungültig, startet die Einrichtung automatisch erneut.

## Terminals konfigurieren

Für jedes ausgewählte Repository öffnet der Starter automatisch drei
VS-Code-Terminals:

- Shell
- Claude Code
- Codex

Ist Claude Code oder Codex auf einem neuen Mac noch nicht installiert, bleibt
das jeweilige Terminal mit einem verständlichen Hinweis als normale Shell offen.

Zusätzliche projektspezifische Tasks verwenden dieses Format:

```text
Projektname|Terminalname|Befehl|relatives Arbeitsverzeichnis
```

Beispiele:

```zsh
TERMINALS=(
  "Mein Projekt|Frontend|npm run dev|frontend"
)
```

Beim Öffnen kann VS Code fragen, ob automatische Tasks erlaubt werden. Diese
Freigabe ist nötig, damit Shell, Claude Code, Codex und weitere konfigurierte
Terminals automatisch starten können.

## Artwork und Finder-Symbol

Am Anfang des Starters befindet sich ein vollständig auskommentiertes
ASCII-Artwork. Es beeinflusst die Ausführung nicht. Das Symbol einer
`.command`-Datei legt macOS selbst fest; ein dauerhaft eigenes Finder-Symbol
würde stattdessen ein separates `.app`-Bundle erfordern.
