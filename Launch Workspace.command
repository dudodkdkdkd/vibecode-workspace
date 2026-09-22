#!/bin/zsh
# Schreibtisch-Starter für das Workspaces-Modul.
# Absichtlich nur eine Weiterleitung: die eigentliche Logik steht einmal in
# workspaces/, damit es keine zweite Kopie gibt, die auseinanderlaufen kann.
# ${0:A} löst dabei auch einen Finder-Alias auf.
exec "${0:A:h}/workspaces/VibeCode Workspace.command" "$@"
