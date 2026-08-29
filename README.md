# VibeCode Workspace

Ein macOS-Launcher, der ein oder mehrere lokale Git-Repositories als gemeinsamen
Visual-Studio-Code-Workspace öffnet. Pro Projekt lassen sich integrierte Terminals
und Entwicklungsbefehle definieren.

## Starten

Auf dem Schreibtisch `VibeCode Workspace` doppelklicken. Beim ersten Start kann
macOS eine Sicherheitsabfrage anzeigen; dann Rechtsklick auf den Starter und
`Öffnen` wählen.

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
