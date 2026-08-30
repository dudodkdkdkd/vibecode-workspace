#!/bin/zsh
#
# ╔══════════════════════════════════════════════════════════════╗
# ║                                                              ║
# ║          V I B E C O D E   W O R K S P A C E                 ║
# ║                         S E T U P                              ║
# ║                                                              ║
# ║            Repository-Ordner und Terminals einrichten          ║
# ║                                                              ║
# ╚══════════════════════════════════════════════════════════════╝
#
set -euo pipefail

# .command-Dateien können von Finder mit eingeschränktem PATH gestartet werden.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

CONFIG_DIR="$HOME/.config/vibecode-workspace"
PROJECTS_FILE="$CONFIG_DIR/projects.tsv"
TERMINALS_FILE="$CONFIG_DIR/terminals.json"
SCRIPT_DIR="${0:A:h}"
CLOSE_SETUP_TERMINAL=true

TMP_PROJECTS="$(mktemp)"
TMP_CHOSEN_PATHS="$(mktemp)"
TMP_TERMINAL_CONFIG="$(mktemp)"
SETUP_TTY="$(tty 2>/dev/null || true)"
SETUP_COMPLETED=false

finish_setup() {
  local exit_code=$?
  trap - EXIT

  /bin/rm -f "$TMP_PROJECTS" "$TMP_CHOSEN_PATHS" "$TMP_TERMINAL_CONFIG"

  if (( exit_code != 0 )); then
    /usr/bin/osascript - "$exit_code" <<'ERROR_APPLESCRIPT' >/dev/null 2>&1 || true
on run argv
    set errorCode to item 1 of argv
    display alert "VibeCode Workspace Setup fehlgeschlagen" message "Fehlercode: " & errorCode & return & return & "Das Terminal bleibt geöffnet. Dort stehen die technischen Details." as critical
end run
ERROR_APPLESCRIPT
  elif [[ "$SETUP_COMPLETED" == "true" \
       && "$CLOSE_SETUP_TERMINAL" == "true" \
       && "${TERM_PROGRAM:-}" == "Apple_Terminal" \
       && "$SETUP_TTY" == /dev/tty* ]]; then
    /usr/bin/nohup /usr/bin/osascript \
      -e 'on run argv' \
      -e 'set targetTTY to item 1 of argv' \
      -e 'delay 0.7' \
      -e 'tell application "Terminal"' \
      -e 'repeat with terminalWindow in windows' \
      -e 'repeat with terminalTab in tabs of terminalWindow' \
      -e 'if (tty of terminalTab) is targetTTY then' \
      -e 'if (count of tabs of terminalWindow) is 1 then close terminalWindow' \
      -e 'return' \
      -e 'end if' \
      -e 'end repeat' \
      -e 'end repeat' \
      -e 'end tell' \
      -e 'end run' \
      "$SETUP_TTY" </dev/null >> "$CONFIG_DIR/terminal-close.log" 2>&1 &!
  fi

  return "$exit_code"
}

trap finish_setup EXIT

mkdir -p "$CONFIG_DIR"

existing_count=0
if [[ -f "$PROJECTS_FILE" ]]; then
  while IFS=$'\t' read -r existing_name existing_path; do
    [[ -n "$existing_name" && -d "$existing_path" ]] || continue
    (( existing_count += 1 ))
  done < "$PROJECTS_FILE"
fi

if [[ "${1:-}" == "--check" ]]; then
  printf 'OK: VibeCode Workspace Setup ist startbereit.\n'
  printf 'Konfigurationsdatei: %s\n' "$PROJECTS_FILE"
  printf 'Terminal-Konfiguration: %s\n' "$TERMINALS_FILE"
  printf 'Gültige gespeicherte Ordner: %s\n' "$existing_count"
  exit 0
fi

SETUP_NONINTERACTIVE=false

if [[ "${1:-}" == "--terminals" ]]; then
  setup_mode="Terminals ändern"
elif [[ "${1:-}" == "--add" || "${1:-}" == "--replace" ]]; then
  if [[ "$1" == "--add" ]]; then
    setup_mode="Hinzufügen"
  else
    setup_mode="Ersetzen"
  fi
  shift
  (( $# > 0 )) || {
    printf 'Mindestens einen Ordnerpfad angeben.\n' >&2
    exit 1
  }
  printf '%s\n' "$@" > "$TMP_CHOSEN_PATHS"
  SETUP_NONINTERACTIVE=true
  CLOSE_SETUP_TERMINAL=false
else
  if ! setup_mode="$(osascript - "$existing_count" <<'MODE_APPLESCRIPT'
on run argv
    set existingCount to item 1 of argv
    set dialogText to "Aktuell sind " & existingCount & " gültige Ordner eingerichtet." & return & return & "Ordner hinzufügen, die Liste ersetzen oder nur die Terminals ändern?"
    set chosenMode to choose from list {"Hinzufügen", "Ersetzen", "Terminals ändern"} with title "VibeCode Workspace Setup" with prompt dialogText default items {"Hinzufügen"}
    if chosenMode is false then return ""
    return item 1 of chosenMode
end run
MODE_APPLESCRIPT
)"; then
    SETUP_COMPLETED=true
    exit 0
  fi

fi

[[ -n "$setup_mode" ]] || {
  SETUP_COMPLETED=true
  exit 0
}

if [[ "$SETUP_NONINTERACTIVE" == "false" && "$setup_mode" != "Terminals ändern" ]]; then
  if ! osascript <<'FOLDER_APPLESCRIPT' > "$TMP_CHOSEN_PATHS"
set chosenFolders to choose folder with prompt "Wähle die Repository-Ordner aus. Für mehrere einzelne Ordner beim Anklicken ⌘ gedrückt halten." with multiple selections allowed
set oldDelims to AppleScript's text item delimiters
set AppleScript's text item delimiters to linefeed
set outputPaths to {}
repeat with chosenFolder in chosenFolders
    set end of outputPaths to POSIX path of chosenFolder
end repeat
set outputText to outputPaths as text
set AppleScript's text item delimiters to oldDelims
return outputText
FOLDER_APPLESCRIPT
  then
    SETUP_COMPLETED=true
    exit 0
  fi
fi

[[ "$setup_mode" == "Terminals ändern" || -s "$TMP_CHOSEN_PATHS" ]] || {
  SETUP_COMPLETED=true
  exit 0
}

typeset -A SEEN_PROJECT_PATHS
typeset -A SEEN_PROJECT_NAMES

add_project() {
  local project_name="$1"
  local input_path="$2"
  local real_path base_name suffix

  [[ -d "$input_path" ]] || return 0
  real_path="$(cd "$input_path" 2>/dev/null && pwd -P)" || return 0
  [[ -n "${SEEN_PROJECT_PATHS[$real_path]-}" ]] && return 0

  base_name="$project_name"
  suffix=2
  while [[ -n "${SEEN_PROJECT_NAMES[$project_name]-}" ]]; do
    project_name="$base_name ($suffix)"
    (( suffix += 1 ))
  done

  SEEN_PROJECT_PATHS[$real_path]=1
  SEEN_PROJECT_NAMES[$project_name]=1
  printf '%s\t%s\n' "$project_name" "$real_path" >> "$TMP_PROJECTS"
}

if [[ "$setup_mode" != "Ersetzen" && -f "$PROJECTS_FILE" ]]; then
  while IFS=$'\t' read -r existing_name existing_path; do
    [[ -n "$existing_name" && -n "$existing_path" ]] || continue
    add_project "$existing_name" "$existing_path"
  done < "$PROJECTS_FILE"
fi

while IFS= read -r chosen_path; do
  [[ -n "$chosen_path" ]] || continue
  chosen_path="${chosen_path%/}"
  chosen_name="${chosen_path:t}"
  add_project "$chosen_name" "$chosen_path"
done < "$TMP_CHOSEN_PATHS"

[[ -s "$TMP_PROJECTS" ]] || {
  printf 'Keine gültigen Ordner ausgewählt.\n' >&2
  exit 1
}

configured_count="${#SEEN_PROJECT_PATHS}"

if [[ "$SETUP_NONINTERACTIVE" == "false" ]]; then
  # Erst nach allen Dialogen speichern. Abbrechen lässt die alte Einrichtung stehen.
  setup_result="$(osascript -l JavaScript "$SCRIPT_DIR/terminal-setup.js" \
    "$TMP_PROJECTS" "$TERMINALS_FILE" "$TMP_TERMINAL_CONFIG")"
  if [[ "$setup_result" == "cancelled" ]]; then
    SETUP_COMPLETED=true
    exit 0
  fi
  [[ "$setup_result" == "saved" && -s "$TMP_TERMINAL_CONFIG" ]] || exit 1
  /bin/mv "$TMP_TERMINAL_CONFIG" "$TERMINALS_FILE"
fi

/bin/mv "$TMP_PROJECTS" "$PROJECTS_FILE"

if [[ "$SETUP_NONINTERACTIVE" == "false" ]]; then
  osascript - "$configured_count" <<'SUCCESS_APPLESCRIPT'
on run argv
    set configuredCount to item 1 of argv
    display notification configuredCount & " Ordner und ihre Terminals sind jetzt eingerichtet." with title "VibeCode Workspace Setup abgeschlossen"
end run
SUCCESS_APPLESCRIPT
fi

printf 'Setup abgeschlossen: %s Ordner eingerichtet.\n' "$configured_count"
SETUP_COMPLETED=true
