# Beispielkonfiguration für VibeCode Workspace
#
# Diese Datei kopieren und die Kopie config.local.zsh nennen:
#   cp config.example.zsh config.local.zsh
#
# config.local.zsh ist in .gitignore eingetragen und bleibt privat.
#
# =============================================================================
# EINFACHE SKILL-AUSWAHL: Sag einfach was du brauchst!
# =============================================================================
#
# Beispiele für häufige Wünsche:
#
# 1) "Ich will Split-Screen mit Frontend und Backend Terminals"
#    → Setze: VSCODE_TERMINAL_LAYOUT="split"
#    → Und: AUTO_TERMINALS=("Frontend|npm run dev|frontend" "Backend|npm run server|backend")
#
# 2) "Ich will dass localhost:3000 und localhost:6006 automatisch geöffnet werden"
#    → Setze: AUTO_OPEN_URLS=("http://localhost:3000" "http://localhost:6006")
#
# 3) "Ich will nur die Terminals ohne Browser"
#    → Setze: AUTO_OPEN_URLS=()
#
# 4) "Ich will 4 Terminals in Grid-Layout"
#    → Setze: VSCODE_TERMINAL_LAYOUT="grid"
#    → Und: AUTO_TERMINALS mit 4 Einträgen füllen
#
# 5) "Ich will nur Frontend Terminal und Storybook URL"
#    → Setze: AUTO_TERMINALS=("Frontend|npm run dev|frontend")
#    → Und: AUTO_OPEN_URLS=("http://localhost:3000" "http://localhost:6006")
#
# =============================================================================

# Format: "Anzeigename|absoluter Pfad"
PROJECTS=(
  "Mein Projekt|$HOME/Documents/GitHub/mein-projekt"
  "Zweites Projekt|$HOME/Projects/zweites-projekt"
)

# =============================================================================
# TERMINALS
# =============================================================================

# Diese Terminals gelten für Projekte OHNE eigene Terminal-Auswahl im Setup.
# Zeilen entfernen, ergänzen oder den Befehl frei anpassen.
# Format: "Terminalname|Befehl|relatives Arbeitsverzeichnis"
#
# 💡 Split-Screen: Kombiniere mit VSCODE_TERMINAL_LAYOUT weiter unten!
#
# Claude Code und Antigravity ohne Sicherheitsabfragen; Codex mit Workspace-Sandbox.
AUTO_TERMINALS=(
  "Frontend|npm run dev|frontend"
  "Storybook|npm run storybook|frontend"
  "Codex 2|if command -v codex >/dev/null 2>&1; then CODEX_HOME="\$HOME/.codex-account2" exec codex --sandbox workspace-write --ask-for-approval never; else echo 'Codex 2 ist nicht installiert.'; exec zsh -l; fi|"
  "Codex|if command -v codex >/dev/null 2>&1; then exec codex --sandbox workspace-write --ask-for-approval never; else echo 'Codex ist nicht installiert.'; exec zsh -l; fi|"
  "Claude|if command -v claude >/dev/null 2>&1; then exec claude --dangerously-skip-permissions; else echo 'Claude Code ist nicht installiert.'; exec zsh -l; fi|"
  "agy|if command -v agy >/dev/null 2>&1; then exec agy --dangerously-skip-permissions; else echo 'Antigravity (agy) ist nicht installiert.'; exec zsh -l; fi|"
)

# Zusätzliche Tasks nur für ein bestimmtes Projekt OHNE Setup-Terminal-Auswahl.
# Format: "Projektname|Terminalname|Befehl|relatives Arbeitsverzeichnis"
TERMINALS=(
  "Mein Projekt|Frontend|npm run dev|frontend"
)

# =============================================================================
# AUTO-OPEN BROWSER URLS
# =============================================================================
# URLs, die automatisch beim Workspace-Start im Browser geöffnet werden.
# Perfekt für Dev-Server, Storybook, APIs etc.
#
# Beispiele:
#   AUTO_OPEN_URLS=("http://localhost:3000" "http://localhost:6006" "http://localhost:5173")
#
# Leer lassen, wenn keine URLs automatisch geöffnet werden sollen.
AUTO_OPEN_URLS=()

# =============================================================================
# VS CODE SPLIT-SCREEN LAYOUT
# =============================================================================
# Definiert, wie die Terminals in VS Code angeordnet werden.
#
# Optionen:
#   "tabs"    = Alle Terminals in separaten Tabs (Standard-VS-Code-Verhalten)
#   "split"   = 2 Terminals in Split-View (links/rechts)
#   "grid"    = 4 Terminals in Grid-Layout (2x2)
#   "auto"    = VS Code entscheidet automatisch basierend auf der Anzahl
#
# 💡 Tipp: Funktioniert am besten mit 2-4 Terminals in AUTO_TERMINALS
VSCODE_TERMINAL_LAYOUT="tabs"

# =============================================================================
# EDITOR & ALLGEMEIN
# =============================================================================

# "code" für Visual Studio Code oder "cursor" für Cursor.
# Installierte macOS-Apps werden auch ohne CLI-Befehl automatisch erkannt.
EDITOR_CMD="code"

# true startet die definierten Terminals automatisch beim Öffnen.
AUTO_START_TERMINALS=true

# true nutzt das Starter-Terminal anschließend als Kontrollterminal für
# Wachhalten + Apps. Dort selbst gibt es nur AN/AUS und die App-Auswahl.
OPEN_CONTROL_TERMINAL=true

# true schließt den Terminal-Tab des Starters nur nach erfolgreichem Durchlauf.
# Bei einem Fehler bleibt er zur Diagnose geöffnet.
CLOSE_LAUNCHER_TERMINAL=true
