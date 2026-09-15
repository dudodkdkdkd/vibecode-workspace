#!/bin/zsh

# Finder-/Schreibtisch-Einstiegspunkt. ${0:A} loest auch Symlinks auf.
set -u

SCRIPT_FILE="${0:A}"
SCRIPT_DIR="${SCRIPT_FILE:h}"
LAUNCHER="$SCRIPT_DIR/local-dev/launcher.zsh"

if [[ ! -f "$LAUNCHER" ]]; then
    print -u2 'Local-Dev-Modul nicht gefunden. Bitte einen Finder-Alias der Originaldatei verwenden, keine einzelne Kopie.'
    [[ -t 0 ]] && read -r '?Enter druecken, um das Fenster zu schliessen ...'
    exit 1
fi

exec /bin/zsh "$LAUNCHER" "$@"
