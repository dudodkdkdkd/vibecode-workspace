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

# Shell, Claude Code und Codex werden vom Starter automatisch für jedes
# ausgewählte Projekt angelegt. Hier kommen nur zusätzliche Tasks hinein.
# Format: "Projektname|Terminalname|Befehl|relatives Arbeitsverzeichnis"
TERMINALS=(
  "Mein Projekt|Frontend|npm run dev|frontend"
)

# Optional lassen sich die automatischen Terminals überschreiben oder mit
# AUTO_TERMINALS=() vollständig deaktivieren.
# Format: "Terminalname|Befehl|relatives Arbeitsverzeichnis"
# AUTO_TERMINALS=(
#   "Shell|exec zsh -l|"
#   "Claude Code|claude|"
#   "Codex|codex|"
# )

# "code" für Visual Studio Code oder "cursor" für Cursor.
# Installierte macOS-Apps werden auch ohne CLI-Befehl automatisch erkannt.
EDITOR_CMD="code"

# true startet die definierten Terminals automatisch beim Öffnen.
AUTO_START_TERMINALS=true

# true schließt den Terminal-Tab des Starters nur nach erfolgreichem Durchlauf.
# Bei einem Fehler bleibt er zur Diagnose geöffnet.
CLOSE_LAUNCHER_TERMINAL=true
