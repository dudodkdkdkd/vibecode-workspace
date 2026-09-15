#!/bin/zsh

# Kompatibler Einstiegspunkt fuer vorhandene Aliase auf diese Datei.
set -u

SCRIPT_FILE="${0:A}"
SCRIPT_DIR="${SCRIPT_FILE:h}"

exec /bin/zsh "$SCRIPT_DIR/../Local Dev.command" "$@"
