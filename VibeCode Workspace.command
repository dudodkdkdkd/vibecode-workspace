#!/bin/zsh
# VibeCode Workspace (die App): öffnet das Hauptfenster. Mit Argumenten arbeitet es als
# Kommandozeile (z. B. ./VibeCode\ Workspace.command run Demo).
# Nicht zu verwechseln mit workspaces/VibeCode Workspace.command, dem Launcher darunter.
# Absichtlich nur eine Weiterleitung: die Logik steht einmal in core/, damit es keine
# zweite Kopie gibt, die auseinanderlaufen kann. ${0:A} löst auch einen Finder-Alias auf.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
command -v python3 >/dev/null || { print -u2 'VibeCode benötigt Python 3 (z. B. brew install python).'; exit 1; }
exec python3 "${0:A:h}/core/vibecode.py" "$@"
