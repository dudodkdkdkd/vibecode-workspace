#!/bin/zsh
#
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║                                                                              ║
# ║   ██╗   ██╗██╗██████╗ ███████╗    ██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗      ║
# ║   ██║   ██║██║██╔══██╗██╔════╝    ██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝      ║
# ║   ██║   ██║██║██████╔╝█████╗      ██║ █╗ ██║██║   ██║██████╔╝█████╔╝       ║
# ║   ╚██╗ ██╔╝██║██╔══██╗██╔══╝      ██║███╗██║██║   ██║██╔══██╗██╔═██╗       ║
# ║    ╚████╔╝ ██║██████╔╝███████╗    ╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗      ║
# ║     ╚═══╝  ╚═╝╚═════╝ ╚══════╝     ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝      ║
# ║                                                                              ║
# ║                    ┌─────────────────────────────┐                           ║
# ║                    │  ◉  ◉  ◉    VIBE WORKSPACE │                           ║
# ║                    ├─────────────────────────────┤                           ║
# ║                    │                             │                           ║
# ║                    │   ~/project-a    git:main   │                           ║
# ║                    │      ├─ >_ terminal         │                           ║
# ║                    │      ├─ >_ claude           │                           ║
# ║                    │      └─ ⎇  git              │                           ║
# ║                    │                             │                           ║
# ║                    │   ~/project-b    git:dev    │                           ║
# ║                    │      ├─ >_ terminal         │                           ║
# ║                    │      ├─ >_ codex            │                           ║
# ║                    │      └─ ⎇  git              │                           ║
# ║                    │                             │                           ║
# ║                    └─────────────────────────────┘                           ║
# ║                                                                              ║
# ║                 MULTI-REPO  •  TERMINALS  •  GIT  •  AI                     ║
# ║                                                                              ║
# ╚══════════════════════════════════════════════════════════════════════════════╝
#
# V I B E   W O R K S P A C E
# ───────────────────────────
#
# Select repositories. Launch workspace. Start building.
#
# [✓] Multi-Repository Workspace       [✓] Git Source Control
# [✓] Project Terminal Groups          [✓] Claude / Codex
# [✓] Automatic Workspace Setup        [✓] One-Click Launch
#
# ===============================================================================
#
set -euo pipefail

# Finder/Terminal können .command-Dateien mit einem stark eingeschränkten PATH
# starten. Die macOS-Systemprogramme und übliche Homebrew-Installationen müssen
# deshalb ausdrücklich verfügbar gemacht werden.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

# ${0:A} erzeugt einen absoluten Pfad und löst auch einen Schreibtisch-Alias auf.
SCRIPT_FILE="${0:A}"
SCRIPT_DIR="${SCRIPT_FILE:h}"

# ============================================================
# VIBE WORKSPACE LAUNCHER
# macOS + Visual Studio Code
#
# 1) Optional Repos unten im CONFIG-Bereich eintragen.
# 2) Optional pro Repo beliebig viele integrierte Terminals definieren.
# 3) Beim ersten Start können Repos bequem im Finder ausgewählt werden.
# 4) Datei doppelklicken -> Projekte auswählen -> VS Code öffnet alles.
# ============================================================

# ---------------------------- CONFIG ----------------------------
# Format pro Repo:
#   "Anzeigename|/absoluter/pfad/zum/repo"
#
# $HOME darf verwendet werden. Leer lassen = portable Ersteinrichtung per Finder.
PROJECTS=()
# Beispiele:
# PROJECTS=(
#   "Mein Projekt|$HOME/Documents/GitHub/mein-projekt"
#   "Zweites Projekt|$HOME/Projects/zweites-projekt"
# )

# Optionale Terminals/Tasks.
# Format:
#   "Projektname|Terminalname|Befehl|relatives Arbeitsverzeichnis"
#
# Das letzte Feld darf leer sein; dann wird im Repo-Root gestartet.
# Diese Tasks werden beim Öffnen des Workspace automatisch gestartet.
TERMINALS=()
# Beispiele:
# TERMINALS=(
#   "Mein Projekt|Shell|exec zsh -l|"
#   "Mein Projekt|Frontend|npm run dev|frontend"
# )

# Diese Standard-Terminals werden für jedes ausgewählte Projekt angelegt.
# Falls Claude Code oder Codex fehlen, bleibt eine Shell mit Installationshinweis
# geöffnet, statt dass der Task sofort verschwindet.
AUTO_TERMINALS=(
  "Shell|exec zsh -l|"
  "Claude Code|if command -v claude >/dev/null 2>&1; then exec claude; else echo 'Claude Code ist nicht installiert.'; exec zsh -l; fi|"
  "Codex|if command -v codex >/dev/null 2>&1; then exec codex; else echo 'Codex ist nicht installiert.'; exec zsh -l; fi|"
)

# Bevorzugter VS-Code-Befehl. Wenn er nicht im PATH liegt, wird die
# installierte VS-Code-App automatisch verwendet.
EDITOR_CMD="code"

# Workspace-Datei wird hier abgelegt:
WORKSPACE_DIR="$HOME/.vibe-workspaces"
WORKSPACE_NAME="Vibe-Session.code-workspace"

# Auf einem neuen Mac gewählte Repositories werden benutzerspezifisch hier
# gespeichert. Dadurch enthält der Starter keine fremden absoluten Pfade.
CONFIG_DIR="$HOME/.config/vibecode-workspace"
SAVED_PROJECTS="$CONFIG_DIR/projects.tsv"
LAST_SELECTION="$CONFIG_DIR/last-selection.txt"

# true = definierte Terminals automatisch beim Öffnen starten.
# false = Tasks werden angelegt, aber nicht automatisch gestartet.
AUTO_START_TERMINALS=true
# ---------------------------------------------------------------

# Persönliche Konfiguration neben dem Starter laden. Diese Datei ist absichtlich
# nicht Teil von Git; eine Vorlage liegt als config.example.zsh im Repository.
LOCAL_CONFIG="$SCRIPT_DIR/config.local.zsh"
if [[ -f "$LOCAL_CONFIG" ]]; then
  source "$LOCAL_CONFIG"
fi

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

# Temporäre Dateien vorbereiten.
TMP_NAMES="$(mktemp)"
TMP_SELECTED="$(mktemp)"
TMP_CONFIG="$(mktemp)"
TMP_TERMINALS="$(mktemp)"
TMP_CHOSEN_PATHS="$(mktemp)"
TMP_DEFAULTS="$(mktemp)"
trap 'rm -f "$TMP_NAMES" "$TMP_SELECTED" "$TMP_CONFIG" "$TMP_TERMINALS" "$TMP_CHOSEN_PATHS" "$TMP_DEFAULTS"' EXIT

# Doppelte und nicht mehr vorhandene Projektpfade ausfiltern.
typeset -A SEEN_PROJECT_PATHS
typeset -A SEEN_PROJECT_NAMES

add_project() {
  local name="$1"
  local input_path="$2"
  local real_path base_name suffix

  input_path="${input_path/#\~/$HOME}"
  [[ -d "$input_path" ]] || return 0
  real_path="$(cd "$input_path" 2>/dev/null && pwd -P)" || return 0
  [[ -n "${SEEN_PROJECT_PATHS[$real_path]-}" ]] && return 0

  base_name="$name"
  suffix=2
  while [[ -n "${SEEN_PROJECT_NAMES[$name]-}" ]]; do
    name="$base_name ($suffix)"
    (( suffix += 1 ))
  done

  SEEN_PROJECT_PATHS[$real_path]=1
  SEEN_PROJECT_NAMES[$name]=1
  printf '%s\n' "$name" >> "$TMP_NAMES"
  printf '%s\t%s\n' "$name" "$real_path" >> "$TMP_CONFIG"
}

# Manuell im Starter konfigurierte Projekte einlesen.
for entry in "${PROJECTS[@]}"; do
  name="${entry%%|*}"
  repo_path="${entry#*|}"
  add_project "$name" "$repo_path"
done

# Wenn der Starter im geklonten Repository liegt oder über einen Alias darauf
# zeigt, das Repository selbst automatisch anbieten.
if [[ -d "$SCRIPT_DIR/.git" ]]; then
  add_project "VibeCode Workspace" "$SCRIPT_DIR"
fi

# Auf diesem Benutzerkonto bei der Ersteinrichtung gespeicherte Projekte laden.
if [[ -f "$SAVED_PROJECTS" ]]; then
  while IFS=$'\t' read -r saved_name saved_path; do
    [[ -n "$saved_name" && -n "$saved_path" ]] || continue
    add_project "$saved_name" "$saved_path"
  done < "$SAVED_PROJECTS"
fi

# Diagnosemodus für Installation und Konfiguration, ohne Fenster zu öffnen.
if [[ "${1:-}" == "--check" ]]; then
  for required_command in osascript rm mktemp; do
    command -v "$required_command" >/dev/null 2>&1 || {
      printf 'FEHLER: %s wurde nicht gefunden.\n' "$required_command" >&2
      exit 1
    }
  done
  printf 'OK: VibeCode Workspace ist startbereit.\n'
  printf 'Editor: %s\n' "$EDITOR_CMD"
  printf 'Lokale Konfiguration: %s\n' "$LOCAL_CONFIG"
  printf 'Gültige Projekte: %s\n' "${#SEEN_PROJECT_PATHS}"
  exit 0
fi

# Frische Installation oder verschobene Repositories: native Ordnerauswahl
# anzeigen und die Auswahl für zukünftige Starts speichern.
if [[ ! -s "$TMP_NAMES" ]]; then
  if ! osascript <<'APPLESCRIPT' > "$TMP_CHOSEN_PATHS"
set chosenFolders to choose folder with prompt "VibeCode Workspace einrichten: Wähle die Repositories aus, die im Workspace angeboten werden sollen." with multiple selections allowed
set oldDelims to AppleScript's text item delimiters
set AppleScript's text item delimiters to linefeed
set outputPaths to {}
repeat with chosenFolder in chosenFolders
    set end of outputPaths to POSIX path of chosenFolder
end repeat
set outputText to outputPaths as text
set AppleScript's text item delimiters to oldDelims
return outputText
APPLESCRIPT
  then
    exit 0
  fi

  [[ -s "$TMP_CHOSEN_PATHS" ]] || exit 0
  mkdir -p "$CONFIG_DIR"
  : > "$SAVED_PROJECTS"

  while IFS= read -r chosen_path; do
    [[ -n "$chosen_path" ]] || continue
    chosen_path="${chosen_path%/}"
    chosen_name="${chosen_path:t}"
    printf '%s\t%s\n' "$chosen_name" "$chosen_path" >> "$SAVED_PROJECTS"
    add_project "$chosen_name" "$chosen_path"
  done < "$TMP_CHOSEN_PATHS"
fi

[[ -s "$TMP_NAMES" ]] || exit 0

# Die zuletzt verwendete Auswahl erneut vorselektieren. Beim allerersten Start
# sind alle vorhandenen Projekte markiert.
if [[ -f "$LAST_SELECTION" ]]; then
  while IFS= read -r selected_name; do
    [[ -n "${SEEN_PROJECT_NAMES[$selected_name]-}" ]] || continue
    printf '%s\n' "$selected_name" >> "$TMP_DEFAULTS"
  done < "$LAST_SELECTION"
fi

if [[ ! -s "$TMP_DEFAULTS" ]]; then
  cp "$TMP_NAMES" "$TMP_DEFAULTS"
fi

# Standardmäßiger macOS-Mehrfachauswahldialog. Zum Ändern mehrerer Einträge
# verlangt macOS die Cmd-Taste; die gespeicherte Auswahl kann direkt bestätigt werden.
osascript <<APPLESCRIPT > "$TMP_SELECTED"
set namesFile to POSIX file "$TMP_NAMES"
set defaultsFile to POSIX file "$TMP_DEFAULTS"
set projectNames to paragraphs of (read namesFile as «class utf8»)
set defaultNames to paragraphs of (read defaultsFile as «class utf8»)
set chosen to choose from list projectNames with title "Vibe Workspace" with prompt "Welche Repositories sollen geöffnet werden? Zum Ändern mehrerer Einträge ⌘ gedrückt halten." default items defaultNames with multiple selections allowed
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

mkdir -p "$CONFIG_DIR"
cp "$TMP_SELECTED" "$LAST_SELECTION"

WORKSPACE_PATH="$WORKSPACE_DIR/$WORKSPACE_NAME"

# Automatische Standard-Terminals für jedes konfigurierte Projekt vorbereiten.
while IFS=$'\t' read -r project repo_path; do
  for automatic_terminal in "${AUTO_TERMINALS[@]}"; do
    terminal_name="${automatic_terminal%%|*}"
    rest="${automatic_terminal#*|}"
    command="${rest%%|*}"
    cwd="${rest#*|}"
    printf '%s\t%s\t%s\t%s\n' "$project" "$terminal_name" "$command" "$cwd" >> "$TMP_TERMINALS"
  done
done < "$TMP_CONFIG"

# Zusätzliche projektspezifische Terminal-Konfiguration ergänzen.
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
osascript -l JavaScript - "$TMP_SELECTED" "$TMP_CONFIG" "$TMP_TERMINALS" "$WORKSPACE_PATH" <<'JXA'
ObjC.import("Foundation");

function readText(path) {
    const value = $.NSString.stringWithContentsOfFileEncodingError(
        $(path),
        $.NSUTF8StringEncoding,
        null
    );
    if (!value) {
        throw new Error(`Datei konnte nicht gelesen werden: ${path}`);
    }
    return ObjC.unwrap(value);
}

function nonEmptyLines(path) {
    return readText(path)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
}

function run(argv) {
    const [selectedFile, configFile, terminalsFile, outputFile] = argv;
    const selected = nonEmptyLines(selectedFile);

    const projects = {};
    for (const line of nonEmptyLines(configFile)) {
        const separator = line.indexOf("\t");
        if (separator === -1) continue;
        const name = line.slice(0, separator);
        const path = line.slice(separator + 1);
        projects[name] = path;
    }

    const missing = selected.filter((name) => !projects[name]);
    if (missing.length) {
        throw new Error(`Unbekannte Projekte: ${missing.join(", ")}`);
    }

    const folders = selected.map((name) => ({
        name,
        path: projects[name],
    }));

    const environment = $.NSProcessInfo.processInfo.environment;
    const autoStartValue = ObjC.unwrap(
        environment.objectForKey("AUTO_START_VALUE") || $("true")
    );
    const autoStart = String(autoStartValue).toLowerCase() === "true";

    const tasks = [];
    for (const raw of nonEmptyLines(terminalsFile)) {
        const parts = raw.split("\t");
        while (parts.length < 4) parts.push("");
        const [project, terminalName, command, relativeCwd] = parts;
        if (!selected.includes(project)) continue;

        const repoPath = projects[project].replace(/\/$/, "");
        const cwd = relativeCwd ? `${repoPath}/${relativeCwd}` : repoPath;
        const task = {
            label: `${project} · ${terminalName}`,
            type: "shell",
            command,
            options: { cwd },
            problemMatcher: [],
            presentation: {
                echo: true,
                reveal: "always",
                focus: false,
                panel: "dedicated",
                showReuseMessage: false,
                clear: false,
                group: project,
            },
        };

        if (autoStart) {
            task.runOptions = { runOn: "folderOpen" };
        }
        tasks.push(task);
    }

    const workspace = {
        folders,
        settings: {
            "git.autofetch": true,
            "git.openRepositoryInParentFolders": "always",
            "terminal.integrated.tabs.enabled": true,
            "terminal.integrated.enableMultiLinePasteWarning": "auto",
        },
        tasks: {
            version: "2.0.0",
            tasks,
        },
    };

    const output = `${JSON.stringify(workspace, null, 2)}\n`;
    const written = $(output).writeToFileAtomicallyEncodingError(
        $(outputFile),
        true,
        $.NSUTF8StringEncoding,
        null
    );
    if (!written) {
        throw new Error(`Workspace konnte nicht geschrieben werden: ${outputFile}`);
    }
    return outputFile;
}
JXA

# Workspace öffnen.
"$EDITOR_CMD" "$WORKSPACE_PATH"

# Kurzer Hinweis beim ersten Start automatischer Tasks.
if [[ "$AUTO_START_TERMINALS" == "true" ]]; then
  osascript -e 'display notification "Falls VS Code fragt: automatische Tasks für diesen Workspace erlauben." with title "Vibe Workspace gestartet"'
fi
