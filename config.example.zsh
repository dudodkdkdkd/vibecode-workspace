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

# Format:
# "Projektname|Terminalname|Befehl|relatives Arbeitsverzeichnis"
TERMINALS=(
  "Mein Projekt|Shell|exec zsh -l|"
  "Mein Projekt|Frontend|npm run dev|frontend"
  "Zweites Projekt|Shell|exec zsh -l|"
)

# "code" für Visual Studio Code oder "cursor" für Cursor.
# Installierte macOS-Apps werden auch ohne CLI-Befehl automatisch erkannt.
EDITOR_CMD="code"

# true startet die definierten Terminals automatisch beim Öffnen.
AUTO_START_TERMINALS=true

