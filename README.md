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

Format:

```text
Projektname|Terminalname|Befehl|relatives Arbeitsverzeichnis
```

Beispiele:

```zsh
TERMINALS=(
  "Mein Projekt|Shell|exec zsh -l|"
  "Mein Projekt|Frontend|npm run dev|frontend"
)
```

Beim Öffnen kann VS Code fragen, ob automatische Tasks erlaubt werden. Diese
Freigabe ist nötig, wenn die konfigurierten Terminals automatisch starten sollen.
Ohne eigene Terminal-Konfiguration wird für jedes ausgewählte Repository eine
Shell angelegt.

## Artwork und Finder-Symbol

Am Anfang des Starters befindet sich ein vollständig auskommentiertes
ASCII-Artwork. Es beeinflusst die Ausführung nicht. Das Symbol einer
`.command`-Datei legt macOS selbst fest; ein dauerhaft eigenes Finder-Symbol
würde stattdessen ein separates `.app`-Bundle erfordern.
