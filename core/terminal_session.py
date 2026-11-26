#!/usr/bin/env python3
"""Close VibeCode's finished Apple Terminal windows; preserve failures for inspection."""
import os
import subprocess
import sys


SESSION_TTY = 'VIBECODE_TERMINAL_SESSION_TTY'
MINIMIZE_SCRIPT = '''on run argv
    if application "Terminal" is not running then return false
    set targetTTY to item 1 of argv
    set minimizeWindow to (item 2 of argv is "minimize")
    tell application "Terminal"
        repeat with terminalWindow in windows
            set terminalTabs to tabs of terminalWindow
            if (count of terminalTabs) is 1 then
                if (tty of item 1 of terminalTabs) is targetTTY then
                    if (miniaturized of terminalWindow) is minimizeWindow then return false
                    set miniaturized of terminalWindow to minimizeWindow
                    return true
                end if
            end if
        end repeat
    end tell
    return false
end run
'''
CLOSE_SCRIPT = '''on run argv
    set targetTTY to item 1 of argv
    set restoreWindow to ((count of argv) > 1)
    delay 0.7
    repeat with attempt from 1 to 30
        if application "Terminal" is not running then return
        set foundTab to false
        tell application "Terminal"
            repeat with terminalWindow in windows
                repeat with terminalTab in tabs of terminalWindow
                    if (tty of terminalTab) is targetTTY then
                        set foundTab to true
                        -- A manual caller's shell or a new command must stay open.
                        if (count of (get processes of terminalTab)) is 0 then
                            -- Terminal only exposes close for windows, not individual tabs.
                            -- Never close a shared window containing another tab.
                            if (count of (get tabs of terminalWindow)) is 1 then
                                close terminalWindow saving no
                            end if
                            return
                        end if
                        -- If a manual shell is still open, undo our temporary minimization.
                        if restoreWindow and attempt is 30 and (count of (get tabs of terminalWindow)) is 1 then
                            set miniaturized of terminalWindow to false
                        end if
                    end if
                end repeat
            end repeat
        end tell
        if not foundTab then return
        delay 0.1
    end repeat
end run
'''


def terminal_tty():
    if os.environ.get('TERM_PROGRAM') != 'Apple_Terminal':
        return None
    try:
        return os.ttyname(sys.stdin.fileno()) if sys.stdin.isatty() else None
    except (OSError, ValueError):
        return None


def minimize_terminal_window(tty, minimize):
    action = 'minimize' if minimize else 'restore'
    try:
        result = subprocess.run(['/usr/bin/osascript', '-e', MINIMIZE_SCRIPT, tty, action],
                                stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=2)
        return result.returncode == 0 and result.stdout.strip() == 'true'
    except (OSError, subprocess.SubprocessError):
        return False


def schedule_close(tty, restore=False):
    """Wait for our wrapper and Finder's shell to exit; leave shared windows alone."""
    argv = ['/usr/bin/osascript', '-e', CLOSE_SCRIPT, tty]
    if restore:
        argv.append('restore')
    subprocess.Popen(argv,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     start_new_session=True)


def run_command(argv, minimize_window=False):
    tty = terminal_tty()
    env = dict(os.environ)
    if tty:
        env[SESSION_TTY] = tty
    minimized = bool(tty and minimize_window and minimize_terminal_window(tty, True))
    try:
        code = subprocess.call(argv, env=env)
    except KeyboardInterrupt:
        code = 130
    except OSError as exc:
        print(f'VibeCode: {exc}', file=sys.stderr)
        code = 127
    if code < 0:
        code = 128 - code
    if tty:
        if code == 0:
            try:
                schedule_close(tty, restore=minimized)
            except OSError as exc:
                if minimized:
                    minimize_terminal_window(tty, False)
                print(f'VibeCode: Terminal konnte nicht geschlossen werden: {exc}', file=sys.stderr)
        else:
            if minimized:
                minimize_terminal_window(tty, False)
            # Keep a process alive even for Terminal profiles that close on every exit.
            print(f'\nVibeCode: Fehler (Exit-Code {code}). Das Terminal bleibt zur Diagnose geöffnet.', file=sys.stderr)
            try:
                input('Zum Beenden Enter drücken … ')
            except (EOFError, KeyboardInterrupt):
                pass
    return code


def wrap_if_needed(argv, minimize_window=False):
    """Also covers existing generated Desktop starters, which call vibecode.py directly."""
    tty = terminal_tty()
    if tty and os.environ.get(SESSION_TTY) != tty:
        raise SystemExit(run_command(argv, minimize_window=minimize_window))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        raise SystemExit('Aufruf: terminal_session.py BEFEHL [ARGUMENTE …]')
    raise SystemExit(run_command(sys.argv[1:]))
