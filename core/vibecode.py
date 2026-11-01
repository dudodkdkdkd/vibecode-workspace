#!/usr/bin/env python3
"""VibeCode Grundapp: Hauptfenster, gespeicherte Workspaces, Schreibtisch-Shortcuts.

Nur Standardbibliothek (das Python der Xcode-Befehlszeilentools, 3.9, genügt).
Die Module (workspaces/, remote/, local-dev/) melden sich über eine module.json an.
"""
import argparse
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import tempfile
from pathlib import Path

CORE = Path(__file__).resolve().parent
REPO = CORE.parent
LAUNCHER = REPO / 'workspaces' / 'VibeCode Workspace.command'
NAME_MAX = 60
ENTRY_ID = re.compile(r'[a-z][a-z0-9-]*')
RESERVED = {'run', 'start', 'list', 'save', 'delete', 'open', 'shortcuts', 'projects',
            'window', 'help', '_state'}


def config_dir():
    return Path(os.environ.get('VIBECODE_CONFIG_DIR') or Path.home() / '.config/vibecode-workspace')


def desktop_dir():
    return Path(os.environ.get('VIBECODE_DESKTOP_DIR') or Path.home() / 'Desktop')


def atomic_write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            f.write(text)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def refresh_home():
    """Remember where this checkout lives, so Desktop shortcuts survive a moved repository."""
    home = config_dir() / 'home'
    if not home.exists() or home.read_text(encoding='utf-8').strip() != str(REPO):
        atomic_write(home, str(REPO) + '\n')


# --- gespeicherte Workspaces ----------------------------------------------------------

def clean_name(value):
    if not isinstance(value, str):
        raise ValueError('Der Name muss Text sein.')
    name = ' '.join(value.split())
    if not name or len(name) > NAME_MAX:
        raise ValueError(f'Der Name braucht 1 bis {NAME_MAX} Zeichen.')
    if any(ord(c) < 32 or ord(c) == 127 for c in name) or re.search(r'[/\\:]', name) or name[0] == '.':
        raise ValueError('Der Name darf weder / \\ : noch Steuerzeichen enthalten und nicht mit einem Punkt beginnen.')
    return name


def clean_projects(values):
    if not isinstance(values, list) or not all(isinstance(v, str) and v.strip() and '\n' not in v for v in values):
        raise ValueError('Projekte müssen eine Liste von Namen sein.')
    projects = list(dict.fromkeys(values))
    if not projects:
        raise ValueError('Wähle mindestens ein Projekt aus.')
    return projects


def read_store():
    path = config_dir() / 'workspaces.json'
    if not path.exists():
        return {'version': 1, 'workspaces': []}
    # Beschädigte Daten werden abgelehnt, nie durch eine leere Liste ersetzt.
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        ok = isinstance(data, dict) and data.get('version') == 1 and isinstance(data.get('workspaces'), list)
        if ok:
            for ws in data['workspaces']:
                clean_name(ws['name'])
                clean_projects(ws['projects'])
                ok = ok and type(ws['shortcut']) is bool
        if not ok:
            raise ValueError('falsches Format')
    except (ValueError, KeyError, TypeError) as exc:
        raise ValueError(f'{path} ist ungültig ({exc}). Datei prüfen oder umbenennen.') from exc
    return data


def write_store(data):
    atomic_write(config_dir() / 'workspaces.json', json.dumps(data, indent=2, ensure_ascii=False) + '\n')


def find(store, name):
    wanted = (name or '').casefold()
    return next((ws for ws in store['workspaces'] if ws['name'].casefold() == wanted), None)


def require(name):
    ws = find(read_store(), name)
    if not ws:
        raise ValueError(f'Den Workspace „{name}“ gibt es nicht.')
    return ws


def list_projects():
    """Same list the launcher shows, including auto-discovered sibling repositories."""
    result = subprocess.run([str(LAUNCHER), '--list-projects'], capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise ValueError('Projektliste nicht lesbar: ' + (result.stderr.strip() or result.stdout.strip()))
    return [line for line in result.stdout.splitlines() if line.strip()]


# --- Schreibtisch-Shortcuts -----------------------------------------------------------

# $() ist in JXA das nil für Objekt-Parameter; null würde als NSNull ankommen und abstürzen.
ALIAS_JS = r'''
ObjC.import("Foundation");
function inspect(path) {
  if (!$.NSFileManager.defaultManager.fileExistsAtPath($(path))) return "missing";
  const url = $.NSURL.fileURLWithPath($(path));
  const values = url.resourceValuesForKeysError($(["NSURLIsAliasFileKey"]), null);
  if (!values || values.objectForKey("NSURLIsAliasFileKey").boolValue !== true) return "other";
  const flags = $.NSURLBookmarkResolutionWithoutUI | $.NSURLBookmarkResolutionWithoutMounting;
  const resolved = $.NSURL.URLByResolvingAliasFileAtURLOptionsError(url, flags, null);
  const target = resolved ? ObjC.unwrap(resolved.path) : undefined;
  return target ? "alias " + target : "alias-broken";
}
function run(argv) {
  const [mode, first, second] = argv;
  if (mode === "inspect") return inspect(first);
  if (mode === "create") {
    const data = $.NSURL.fileURLWithPath($(first)).bookmarkDataWithOptionsIncludingResourceValuesForKeysRelativeToURLError(
      $.NSURLBookmarkCreationSuitableForBookmarkFile, $(), $(), null);
    if (!data) throw new Error("Alias konnte nicht erzeugt werden.");
    if (!$.NSURL.writeBookmarkDataToURLOptionsError(data, $.NSURL.fileURLWithPath($(second)), 0, null))
      throw new Error("Alias konnte nicht auf den Schreibtisch geschrieben werden.");
    return "ok";
  }
  throw new Error("Unbekannter Modus: " + mode);
}
'''

STARTER = '''#!/bin/zsh
# Von VibeCode erzeugt für den Workspace {label}. Wird beim Speichern neu geschrieben.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${{PATH:-}}"
CONFIG="${{VIBECODE_CONFIG_DIR:-$HOME/.config/vibecode-workspace}}"
REPO=""
[[ -r "$CONFIG/home" ]] && REPO="$(<"$CONFIG/home")"
if [[ -z "$REPO" || ! -f "$REPO/core/vibecode.py" ]]; then
  osascript -e 'display alert "VibeCode nicht gefunden" message "Starte die VibeCode-App einmal aus dem Repository-Ordner. Danach funktioniert dieser Shortcut wieder." as critical'
  exit 1
fi
exec python3 "$REPO/core/vibecode.py" run {name}
'''


def alias_js(*args):
    result = subprocess.run(['/usr/bin/osascript', '-l', 'JavaScript', '-e', ALIAS_JS] + list(args),
                            capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise ValueError(result.stderr.strip().replace('execution error: ', '') or 'Alias-Fehler')
    return result.stdout.strip()


def starter_path(name):
    slug = re.sub(r'[^A-Za-z0-9._-]+', '-', name).strip('-.') or 'workspace'
    digest = hashlib.sha1(name.casefold().encode('utf-8')).hexdigest()[:6]
    return config_dir() / 'shortcuts' / f'{slug}-{digest}.command'


def desktop_alias(name):
    return desktop_dir() / name


def alias_owner(name):
    """'free' (nothing there), 'ours', 'broken' (dead alias of that name) or 'foreign' (someone else's file)."""
    state = alias_js('inspect', str(desktop_alias(name)))
    if state == 'missing':
        return 'free'
    if state == 'alias-broken':
        return 'broken'
    if state.startswith('alias ') and Path(state[6:]).resolve() == starter_path(name).resolve():
        return 'ours'
    return 'foreign'


def add_shortcut(name):
    starter = starter_path(name)
    atomic_write(starter, STARTER.format(label=name, name=shlex.quote(name)))
    starter.chmod(0o755)
    owner = alias_owner(name)
    if owner == 'ours':
        return
    if owner == 'foreign':
        raise ValueError(f'Auf dem Schreibtisch liegt schon „{name}“, das nicht von VibeCode stammt. '
                         'Benenne es um oder wähle einen anderen Workspace-Namen.')
    if not desktop_dir().is_dir():
        raise ValueError(f'Schreibtisch-Ordner nicht gefunden: {desktop_dir()}')
    if owner == 'broken':
        desktop_alias(name).unlink()
    alias_js('create', str(starter), str(desktop_alias(name)))


def remove_shortcut(name):
    """Remove only what VibeCode created: our alias (or a dead one of that name) and our starter."""
    if alias_owner(name) in ('ours', 'broken'):
        desktop_alias(name).unlink()
    starter_path(name).unlink(missing_ok=True)


def save_workspace(name, projects, shortcut, rename_from=None):
    name, projects = clean_name(name), clean_projects(projects)
    store = read_store()
    old = find(store, rename_from) if rename_from else None
    if rename_from and not old:
        raise ValueError(f'Den Workspace „{rename_from}“ gibt es nicht mehr.')
    clash = find(store, name)
    if clash and clash is not old:
        raise ValueError(f'Es gibt schon einen Workspace „{clash["name"]}“.')
    # Zuerst der Shortcut: scheitert er, bleibt die gespeicherte Konfiguration unverändert.
    if old and old['name'] != name and old['name'].casefold() == name.casefold():
        remove_shortcut(old['name'])      # nur Groß-/Kleinschreibung: gleicher Dateiname
    if shortcut:
        add_shortcut(name)
    else:
        remove_shortcut(name)
    if old and old['name'].casefold() != name.casefold():
        remove_shortcut(old['name'])
    entry = {'name': name, 'projects': projects, 'shortcut': bool(shortcut)}
    store['workspaces'] = [entry if ws is old else ws for ws in store['workspaces']]
    if not old:
        store['workspaces'].append(entry)
    write_store(store)
    return entry


def delete_workspace(name):
    store = read_store()
    ws = find(store, name)
    if not ws:
        raise ValueError(f'Den Workspace „{name}“ gibt es nicht.')
    remove_shortcut(ws['name'])
    store['workspaces'] = [w for w in store['workspaces'] if w is not ws]
    write_store(store)


def sync_shortcuts():
    """Recreate every Desktop shortcut, e.g. after the Desktop folder was cleaned up."""
    count = 0
    for ws in read_store()['workspaces']:
        if ws['shortcut']:
            add_shortcut(ws['name'])
            count += 1
    return count


# --- Start ----------------------------------------------------------------------------

def launcher_argv(ws):
    argv = [str(LAUNCHER)]
    for project in ws['projects']:
        argv += ['--project', project]
    return argv


def run_workspace(name):
    """Replace this process with the launcher (Desktop shortcuts)."""
    argv = launcher_argv(require(name))
    refresh_home()
    os.execv(argv[0], argv)


def start_workspace(name):
    """Start the launcher detached (main window). Output goes to a log, not into the void."""
    argv = launcher_argv(require(name))
    log = config_dir() / 'last-start.log'
    log.parent.mkdir(parents=True, exist_ok=True)
    with log.open('w') as out:
        subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=out, stderr=out, start_new_session=True)


# --- Module ---------------------------------------------------------------------------

def module_entries():
    entries = []
    for manifest in sorted(REPO.glob('*/module.json')):
        try:
            data = json.loads(manifest.read_text(encoding='utf-8'))
            for entry in data['entries']:
                ok = (isinstance(entry.get('id'), str) and ENTRY_ID.fullmatch(entry['id'])
                      and entry['id'] not in RESERVED and isinstance(entry.get('title'), str)
                      and isinstance(entry.get('run'), list) and entry['run']
                      and all(isinstance(part, str) for part in entry['run']))
                if not ok:
                    raise ValueError(f'Eintrag {entry!r}')
                entries.append(dict(entry, module=manifest.parent.name, dir=str(manifest.parent)))
        except (ValueError, KeyError, TypeError, AttributeError) as exc:
            raise ValueError(f'{manifest} ist ungültig ({exc}).') from exc
    ids = [entry['id'] for entry in entries]
    if len(ids) != len(set(ids)):
        raise ValueError('Zwei Module melden denselben Befehl an.')
    return entries


def entry_argv(entry, extra=()):
    return [part.replace('{module}', entry['dir']) for part in entry['run']] + list(extra)


def open_in_terminal(argv):
    # Der Befehl läuft als Argument in AppleScript, nie als zusammengesetzter Quelltext.
    subprocess.run(['/usr/bin/osascript', '-e', 'on run argv', '-e', 'tell application "Terminal"',
                    '-e', 'activate', '-e', 'do script (item 1 of argv)', '-e', 'end tell',
                    '-e', 'end run', 'exec ' + shlex.join(argv)], check=True, timeout=30)


def state():
    store, projects = read_store(), list_projects()
    known = set(projects)
    return {
        'workspaces': [dict(ws, missing=[p for p in ws['projects'] if p not in known])
                       for ws in store['workspaces']],
        'projects': projects,
        'entries': [{'id': e['id'], 'title': e['title']} for e in module_entries() if e.get('menu')],
    }


# --- Kommandozeile --------------------------------------------------------------------

def window():
    refresh_home()
    result = subprocess.run(['/usr/bin/osascript', '-l', 'JavaScript', str(CORE / 'window.js'),
                             sys.executable, str(CORE / 'vibecode.py')])
    return result.returncode


def usage(entries):
    lines = ['VibeCode', '',
             '  vibecode                      Hauptfenster öffnen',
             '  vibecode list                 gespeicherte Workspaces',
             '  vibecode run NAME             Workspace starten',
             '  vibecode save --name N --project P [--project Q] [--shortcut]',
             '  vibecode delete --name N      Workspace samt Shortcut löschen',
             '  vibecode shortcuts sync       Schreibtisch-Shortcuts neu anlegen',
             '  vibecode projects             Projekte, die der Launcher kennt']
    lines += [f'  vibecode {e["id"]:<24}{e["title"]}' for e in entries]
    return '\n'.join(lines)


def main(argv):
    command = argv[0] if argv else 'window'
    rest = argv[1:]
    if command == 'window':
        return window()
    if command in ('help', '-h', '--help'):
        print(usage(module_entries()))
        return 0
    if command == 'list':
        for ws in read_store()['workspaces']:
            print(f'{ws["name"]}\t{", ".join(ws["projects"])}\t{"Shortcut" if ws["shortcut"] else "-"}')
        return 0
    if command == 'projects':
        print('\n'.join(list_projects()))
        return 0
    if command == '_state':
        print(json.dumps(state(), ensure_ascii=False))
        return 0
    if command in ('run', 'start', 'delete'):
        parser = argparse.ArgumentParser(prog=f'vibecode {command}', add_help=False)
        parser.add_argument('name_positional', nargs='?')
        parser.add_argument('--name')
        options = parser.parse_args(rest)
        name = options.name or options.name_positional
        if not name:
            raise ValueError(f'Aufruf: vibecode {command} NAME')
        {'run': run_workspace, 'start': start_workspace, 'delete': delete_workspace}[command](name)
        return 0
    if command == 'save':
        parser = argparse.ArgumentParser(prog='vibecode save', add_help=False)
        parser.add_argument('--name', required=True)
        parser.add_argument('--project', action='append', default=[])
        parser.add_argument('--rename-from')
        parser.add_argument('--shortcut', action='store_true')
        parser.add_argument('--no-shortcut', action='store_true')
        options = parser.parse_args(rest)
        ws = save_workspace(options.name, options.project, options.shortcut and not options.no_shortcut,
                            options.rename_from)
        print(f'Gespeichert: {ws["name"]} ({len(ws["projects"])} Projekte, Shortcut: {"ja" if ws["shortcut"] else "nein"})')
        return 0
    if command == 'shortcuts':
        if rest != ['sync']:
            raise ValueError('Aufruf: vibecode shortcuts sync')
        print(f'{sync_shortcuts()} Shortcuts erneuert.')
        return 0
    entries = {e['id']: e for e in module_entries()}
    if command == 'open':
        if len(rest) != 1 or rest[0] not in entries:
            raise ValueError('Aufruf: vibecode open MODUL-BEFEHL (' + ', '.join(sorted(entries)) + ')')
        open_in_terminal(entry_argv(entries[rest[0]]))
        return 0
    if command in entries:
        argv_to_run = entry_argv(entries[command], rest)
        os.execvp(argv_to_run[0], argv_to_run)
        return 0
    raise ValueError(f'Unbekannter Befehl „{command}“.\n\n{usage(entries.values())}')


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except (ValueError, OSError, subprocess.SubprocessError) as exc:
        print('VibeCode: ' + str(exc), file=sys.stderr)
        sys.exit(1)
