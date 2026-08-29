#!/bin/zsh
set -euo pipefail

# Finder/Terminal können .command-Dateien mit einem stark eingeschränkten PATH
# starten. Die macOS-Systemprogramme und übliche Homebrew-Installationen müssen
# deshalb ausdrücklich verfügbar gemacht werden.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

# ============================================================
# VIBE WORKSPACE LAUNCHER
# macOS + Visual Studio Code
#
# 1) Repos unten im CONFIG-Bereich eintragen.
# 2) Optional pro Repo beliebig viele integrierte Terminals definieren.
# 3) Datei doppelklicken -> Projekte auswählen -> VS Code öffnet alles.
# ============================================================

# ---------------------------- CONFIG ----------------------------
# Format pro Repo:
#   "Anzeigename|/absoluter/pfad/zum/repo"
#
# $HOME darf verwendet werden.
PROJECTS=(
  "VibeCode Workspace|$HOME/Documents/GitHub/vibecode-workspace"
)

# Optionale Terminals/Tasks.
# Format:
#   "Projektname|Terminalname|Befehl|relatives Arbeitsverzeichnis"
#
# Das letzte Feld darf leer sein; dann wird im Repo-Root gestartet.
# Diese Tasks werden beim Öffnen des Workspace automatisch gestartet.
TERMINALS=(
  "VibeCode Workspace|Shell|exec zsh -l|"
  # "VibeCode Workspace|Codex|codex|"
)

# Bevorzugter VS-Code-Befehl. Wenn er nicht im PATH liegt, wird die
# installierte VS-Code-App automatisch verwendet.
EDITOR_CMD="code"

# Workspace-Datei wird hier abgelegt:
WORKSPACE_DIR="$HOME/.vibe-workspaces"
WORKSPACE_NAME="Vibe-Session.code-workspace"

# true = definierte Terminals automatisch beim Öffnen starten.
# false = Tasks werden angelegt, aber nicht automatisch gestartet.
AUTO_START_TERMINALS=true
# ---------------------------------------------------------------

mkdir -p "$WORKSPACE_DIR"

# Editor finden, auch wenn der VS-Code-CLI-Befehl nicht im PATH installiert ist.
if ! command -v "$EDITOR_CMD" >/dev/null 2>&1; then
  if [[ -x "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" ]]; then
    EDITOR_CMD="/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
  elif [[ -x "$HOME/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" ]]; then
    EDITOR_CMD="$HOME/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
  elif [[ -x "/Applications/Cursor.app/Contents/Resources/app/bin/cursor" ]]; then
    EDITOR_CMD="/Applications/Cursor.app/Contents/Resources/app/bin/cursor"
  else
    osascript -e 'display alert "Code-Editor nicht gefunden" message "Bitte Visual Studio Code oder Cursor installieren. Alternativ EDITOR_CMD im Launcher anpassen." as critical'
    exit 1
  fi
fi

# Projektliste für AppleScript vorbereiten.
TMP_NAMES="$(mktemp)"
TMP_SELECTED="$(mktemp)"
TMP_CONFIG="$(mktemp)"
trap 'rm -f "$TMP_NAMES" "$TMP_SELECTED" "$TMP_CONFIG"' EXIT

for entry in "${PROJECTS[@]}"; do
  name="${entry%%|*}"
  path="${entry#*|}"
  printf '%s\n' "$name" >> "$TMP_NAMES"
  printf '%s\t%s\n' "$name" "$path" >> "$TMP_CONFIG"
done

# Mehrfachauswahl via native macOS-Dialog.
osascript <<APPLESCRIPT > "$TMP_SELECTED"
set namesFile to POSIX file "$TMP_NAMES"
set projectNames to paragraphs of (read namesFile as «class utf8»)
set chosen to choose from list projectNames with title "Vibe Workspace" with prompt "Welche Repositories sollen geöffnet werden?" with multiple selections allowed
if chosen is false then
    return ""
end if
set oldDelims to AppleScript's text item delimiters
set AppleScript's text item delimiters to linefeed
set outputText to chosen as text
set AppleScript's text item delimiters to oldDelims
return outputText
APPLESCRIPT

# Abgebrochen / nichts gewählt.
if [[ ! -s "$TMP_SELECTED" ]]; then
  exit 0
fi

WORKSPACE_PATH="$WORKSPACE_DIR/$WORKSPACE_NAME"

# Auswahl + Terminal-Konfiguration an Python übergeben und JSON erzeugen.
TMP_TERMINALS="$(mktemp)"
trap 'rm -f "$TMP_NAMES" "$TMP_SELECTED" "$TMP_CONFIG" "$TMP_TERMINALS"' EXIT

for t in "${TERMINALS[@]}"; do
  project="${t%%|*}"
  rest="${t#*|}"
  terminal_name="${rest%%|*}"
  rest="${rest#*|}"
  command="${rest%%|*}"
  cwd="${rest#*|}"
  printf '%s\t%s\t%s\t%s\n' "$project" "$terminal_name" "$command" "$cwd" >> "$TMP_TERMINALS"
done

AUTO_START_VALUE="$AUTO_START_TERMINALS" \
python3 - "$TMP_SELECTED" "$TMP_CONFIG" "$TMP_TERMINALS" "$WORKSPACE_PATH" <<'PY'
import json
import os
import sys
from pathlib import Path

selected_file, config_file, terminals_file, output_file = sys.argv[1:5]

selected = [
    line.strip()
    for line in Path(selected_file).read_text(encoding="utf-8").splitlines()
    if line.strip()
]

projects = {}
for line in Path(config_file).read_text(encoding="utf-8").splitlines():
    if not line.strip():
        continue
    name, path = line.split("\t", 1)
    projects[name] = os.path.expandvars(os.path.expanduser(path))

missing = [name for name in selected if name not in projects]
if missing:
    raise SystemExit(f"Unbekannte Projekte: {', '.join(missing)}")

folders = []
for name in selected:
    path = Path(projects[name])
    if not path.exists():
        raise SystemExit(f"Repo-Pfad existiert nicht: {name}: {path}")
    folders.append({
        "name": name,
        "path": str(path.resolve()),
    })

auto_start = os.environ.get("AUTO_START_VALUE", "true").lower() == "true"

tasks = []
if Path(terminals_file).exists():
    for raw in Path(terminals_file).read_text(encoding="utf-8").splitlines():
        if not raw.strip():
            continue
        parts = raw.split("\t")
        while len(parts) < 4:
            parts.append("")
        project, terminal_name, command, relative_cwd = parts[:4]

        if project not in selected:
            continue

        repo_path = Path(projects[project]).resolve()
        cwd = repo_path / relative_cwd if relative_cwd else repo_path

        task = {
            "label": f"{project} · {terminal_name}",
            "type": "shell",
            "command": command,
            "options": {
                "cwd": str(cwd),
            },
            "problemMatcher": [],
            "presentation": {
                "echo": True,
                "reveal": "always",
                "focus": False,
                "panel": "dedicated",
                "showReuseMessage": False,
                "clear": False,
                "group": project,
            },
        }

        if auto_start:
            task["runOptions"] = {
                "runOn": "folderOpen"
            }

        tasks.append(task)

workspace = {
    "folders": folders,
    "settings": {
        "git.autofetch": True,
        "git.openRepositoryInParentFolders": "always",
        "terminal.integrated.tabs.enabled": True,
        "terminal.integrated.enableMultiLinePasteWarning": "auto",
    },
    "tasks": {
        "version": "2.0.0",
        "tasks": tasks,
    },
}

Path(output_file).write_text(
    json.dumps(workspace, indent=2, ensure_ascii=False) + "\n",
    encoding="utf-8",
)

print(output_file)
PY

# Workspace öffnen.
"$EDITOR_CMD" "$WORKSPACE_PATH"

# Kurzer Hinweis beim ersten Start automatischer Tasks.
if [[ "$AUTO_START_TERMINALS" == "true" ]]; then
  osascript -e 'display notification "Falls VS Code fragt: automatische Tasks für diesen Workspace erlauben." with title "Vibe Workspace gestartet"'
fi
