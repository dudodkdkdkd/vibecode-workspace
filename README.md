# VibeCode Workspace

Ein macOS-Launcher, der ein oder mehrere lokale Git-Repositories als gemeinsamen
Visual-Studio-Code-Workspace öffnet. Pro Projekt lassen sich integrierte Terminals
und Entwicklungsbefehle definieren.

## Inhalt des Repositories

- `VibeWorkspace.command` – der ausführbare Starter
- `README.md` – Einrichtung und Konfiguration

## Starter auf den Schreibtisch ziehen

Damit der Starter im Repository bleibt und spätere Änderungen automatisch auch
für den Schreibtisch-Starter gelten, sollte auf dem Schreibtisch ein Alias liegen:

1. Das Repository im Finder öffnen:
   `Dokumente/GitHub/vibecode-workspace`.
2. `VibeWorkspace.command` mit der rechten Maustaste anklicken und
   **Alias erzeugen** wählen.
3. Den erzeugten Alias auf den Schreibtisch ziehen.
4. Den Alias bei Bedarf in `VibeCode Workspace` umbenennen.

Alternativ kann direkt beim Ziehen auf den Schreibtisch `⌥` + `⌘` gedrückt
gehalten werden. Dadurch erzeugt der Finder ebenfalls einen Alias, statt die
Originaldatei aus dem Repository zu verschieben.

## Starten

Auf dem Schreibtisch `VibeCode Workspace` doppelklicken. Beim ersten Start kann
macOS eine Sicherheitsabfrage anzeigen. In diesem Fall den Starter mit der
rechten Maustaste anklicken, **Öffnen** wählen und den Start bestätigen.

Der Launcher erkennt die installierte Visual-Studio-Code-App automatisch, auch
wenn der `code`-Befehl nicht im `PATH` liegt.

## Projekte konfigurieren

In `VibeWorkspace.command` den Bereich `PROJECTS` bearbeiten:

```zsh
PROJECTS=(
  "VibeCode Workspace|$HOME/Documents/GitHub/vibecode-workspace"
  "Mein Projekt|$HOME/Projects/mein-projekt"
)
```

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
