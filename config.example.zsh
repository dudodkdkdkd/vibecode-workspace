# Beispielkonfiguration für VibeCode Workspace
#
# Diese Datei kopieren und die Kopie config.local.zsh nennen:
#   cp config.example.zsh config.local.zsh
#
# config.local.zsh ist in .gitignore eingetragen und bleibt privat.

# Format: "Anzeigename|absoluter Pfad"
PROJECTS=(
  "Mein Projekt|$HOME/Documents/GitHub/mein-projekt"
  "Zweites Projekt|$HOME/Projects/zweites-projekt"
)

# Diese Terminals gelten für Projekte OHNE eigene Terminal-Auswahl im Setup.
# Zeilen entfernen, ergänzen oder den Befehl frei anpassen.
# Format: "Terminalname|Befehl|relatives Arbeitsverzeichnis"
# Claude Code: YOLO. Codex: Workspace-Sandbox ohne Sicherheitsabfragen.
AUTO_TERMINALS=(
  "Shell|exec zsh -l|"
  "Claude Code|if command -v claude >/dev/null 2>&1; then exec claude --dangerously-skip-permissions; else echo 'Claude Code ist nicht installiert.'; exec zsh -l; fi|"
  "Codex|if command -v codex >/dev/null 2>&1; then exec codex --sandbox workspace-write --ask-for-approval never; else echo 'Codex ist nicht installiert.'; exec zsh -l; fi|"
)

# Zusätzliche Tasks nur für ein bestimmtes Projekt OHNE Setup-Terminal-Auswahl.
# Format: "Projektname|Terminalname|Befehl|relatives Arbeitsverzeichnis"
TERMINALS=(
  "Mein Projekt|Frontend|npm run dev|frontend"
)

# "code" für Visual Studio Code oder "cursor" für Cursor.
# Installierte macOS-Apps werden auch ohne CLI-Befehl automatisch erkannt.
EDITOR_CMD="code"

# true startet die definierten Terminals automatisch beim Öffnen.
AUTO_START_TERMINALS=true

# true schließt den Terminal-Tab des Starters nur nach erfolgreichem Durchlauf.
# Bei einem Fehler bleibt er zur Diagnose geöffnet.
CLOSE_LAUNCHER_TERMINAL=true
