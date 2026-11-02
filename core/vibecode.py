#!/usr/bin/env python3
"""VibeCode Grundapp: Hauptfenster, gespeicherte Workspaces, Schreibtisch-Shortcuts.

Nur Standardbibliothek (das Python der Xcode-Befehlszeilentools, 3.9, genügt).
Die Module (workspaces/, remote/, local-dev/) melden sich über eine module.json an.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
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
            'window', 'help', '_state', '_ssh', 'ssh-open', 'folders', 'presets', 'settings', 'open-folder', 'open-workspace', 'workspace-quick', 'local-options', 'local-settings', 'local-default'}
# Everything the window may trigger over SSH. Fixed on purpose: no arbitrary commands.
SSH_ACTIONS = ('share', 'share-wake', 'share-recheck', 'join', 'allow-check', 'allow')


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


LOCAL_DEV_KEYS = ('provider', 'model', 'framework')


def clean_local_dev(value):
    """A workspace's Local Dev choice: provider, model and CLI, all three. Anything else is rejected, never repaired."""
    if (not isinstance(value, dict) or set(value) != set(LOCAL_DEV_KEYS)
            or not all(isinstance(value[key], str) and value[key].strip() and not re.search(r'[\x00-\x1f\x7f]', value[key])
                       for key in LOCAL_DEV_KEYS)):
        raise ValueError('Local Dev braucht Anbieter, Modell und CLI (alle drei, ohne Steuerzeichen).')
    return {key: value[key] for key in LOCAL_DEV_KEYS}


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
                ok = ok and type(ws['shortcut']) is bool and type(ws.get('quickOpen', False)) is bool
                if 'localDev' in ws:
                    clean_local_dev(ws['localDev'])
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
# Von VibeCode erzeugt für {label}. Wird bei Änderungen neu geschrieben.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${{PATH:-}}"
CONFIG="${{VIBECODE_CONFIG_DIR:-$HOME/.config/vibecode-workspace}}"
REPO=""
[[ -r "$CONFIG/home" ]] && REPO="$(<"$CONFIG/home")"
if [[ -z "$REPO" || ! -f "$REPO/core/vibecode.py" ]]; then
  osascript -e 'display alert "VibeCode nicht gefunden" message "Starte die VibeCode-App einmal aus dem Repository-Ordner. Danach funktioniert dieser Shortcut wieder." as critical'
  exit 1
fi
exec python3 "$REPO/core/vibecode.py" {command}
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


def alias_owner(name, target=None):
    """'free' (nothing there), 'ours', 'broken' (dead alias of that name) or 'foreign' (someone else's file)."""
    state = alias_js('inspect', str(desktop_alias(name)))
    if state == 'missing':
        return 'free'
    if state == 'alias-broken':
        return 'broken'
    if state.startswith('alias ') and Path(state[6:]).resolve() == (target or starter_path(name)).resolve():
        return 'ours'
    return 'foreign'


def add_shortcut(name):
    starter = starter_path(name)
    atomic_write(starter, STARTER.format(label=f'den Workspace {name}', command='run ' + shlex.quote(name)))
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


# Quick-Öffnen: ein zweiter Schreibtisch-Shortcut für einen Suchordner oder einen Workspace. Wie der normale Shortcut ein Finder-Alias
# auf einen Starter in shortcuts/; der Starter zeigt die Repositories zum Ankreuzen (open-folder PFAD / open-workspace NAME),
# statt sofort alles zu starten.

def quick_shortcut_name(base):
    """Desktop name of a quick-open shortcut, e.g. „GitHub öffnen“."""
    name = f'{base} öffnen'
    try:
        return clean_name(name)
    except ValueError:
        raise ValueError(f'Der Shortcut-Name „{name}“ ist ungültig oder länger als {NAME_MAX} Zeichen. Kürze den Namen.') from None


def quick_starter_path(kind, key, label):
    """Keyed by what it opens (folder path or workspace name), not by the Desktop name: two folders both called
    "Github" must never share a starter."""
    slug = re.sub(r'[^A-Za-z0-9._-]+', '-', label).strip('-.') or kind
    digest = hashlib.sha1(f'{kind}:{key}'.encode('utf-8')).hexdigest()[:6]
    return config_dir() / 'shortcuts' / f'{kind}-{slug}-{digest}.command'


def install_quick_shortcut(alias_name, starter, label, command):
    """Create (or refresh) the Desktop alias and its starter. Returns the alias name. A foreign file is never touched."""
    owner = alias_owner(alias_name, starter)
    if owner == 'foreign':
        raise ValueError(f'Auf dem Schreibtisch liegt schon „{alias_name}“, das nicht von VibeCode stammt (oder zu einem anderen '
                         'Ordner oder Workspace gehört). Benenne es um und versuche es erneut.')
    if not desktop_dir().is_dir():
        raise ValueError(f'Schreibtisch-Ordner nicht gefunden: {desktop_dir()}')
    atomic_write(starter, STARTER.format(label=label, command=command))
    starter.chmod(0o755)
    if owner == 'broken':
        desktop_alias(alias_name).unlink()
    if owner != 'ours':
        alias_js('create', str(starter), str(desktop_alias(alias_name)))
    return alias_name


def remove_quick_shortcut(alias_name, starter):
    """Remove only what VibeCode created: our alias (or a dead one of that name) and our starter."""
    if alias_owner(alias_name, starter) in ('ours', 'broken'):
        desktop_alias(alias_name).unlink()
    starter.unlink(missing_ok=True)


def folder_shortcut_name(path):
    return quick_shortcut_name(Path(path).name or path)


def folder_starter_path(path):
    return quick_starter_path('ordner', str(path), Path(path).name)


def add_folder_shortcut(path):
    return install_quick_shortcut(folder_shortcut_name(path), folder_starter_path(path), f'die Repositories in {path}',
                                  'open-folder ' + shlex.quote(str(path)))


def remove_folder_shortcut(path):
    remove_quick_shortcut(folder_shortcut_name(path), folder_starter_path(path))


def workspace_shortcut_name(name):
    return quick_shortcut_name(name)


def workspace_starter_path(name):
    return quick_starter_path('schnell', name.casefold(), name)


def add_workspace_quick(name):
    return install_quick_shortcut(workspace_shortcut_name(name), workspace_starter_path(name),
                                  f'das Quick-Öffnen des Workspaces {name}', 'open-workspace ' + shlex.quote(name))


def remove_workspace_quick(name):
    remove_quick_shortcut(workspace_shortcut_name(name), workspace_starter_path(name))


def save_workspace(name, projects, shortcut, rename_from=None, quick=None, local_dev=None):
    """Create or change a workspace. `quick` (the quick-open shortcut) and `local_dev` ({provider, model, framework} that
    also starts Local Dev; False removes it) are kept as they were unless given."""
    name, projects = clean_name(name), clean_projects(projects)
    store = read_store()
    old = find(store, rename_from) if rename_from else None
    if rename_from and not old:
        raise ValueError(f'Den Workspace „{rename_from}“ gibt es nicht mehr.')
    clash = find(store, name)
    if clash and clash is not old:
        raise ValueError(f'Es gibt schon einen Workspace „{clash["name"]}“.')
    had_quick = bool(old and old.get('quickOpen'))
    quick = had_quick if quick is None else bool(quick)
    if local_dev is None:
        local_dev = old.get('localDev') if old else None
    elif local_dev is False:
        local_dev = None
    else:
        local_dev = clean_local_dev(local_dev)
    renamed = bool(old) and old['name'].casefold() != name.casefold()
    same_file = bool(old) and old['name'] != name and not renamed          # nur Groß-/Kleinschreibung: gleicher Dateiname
    # Zuerst die Shortcuts: scheitert einer, bleibt die gespeicherte Konfiguration unverändert.
    if same_file:
        remove_shortcut(old['name'])
        if had_quick:
            remove_workspace_quick(old['name'])
    if quick:                                  # vor dem normalen Shortcut: ein fremder Name scheitert, bevor etwas geändert ist
        add_workspace_quick(name)
    elif had_quick:
        remove_workspace_quick(name)
    if shortcut:
        add_shortcut(name)
    else:
        remove_shortcut(name)
    if renamed:
        remove_shortcut(old['name'])
        if had_quick:
            remove_workspace_quick(old['name'])
    entry = {'name': name, 'projects': projects, 'shortcut': bool(shortcut)}
    if quick:
        entry['quickOpen'] = True
    if local_dev:
        entry['localDev'] = local_dev
    store['workspaces'] = [entry if ws is old else ws for ws in store['workspaces']]
    if not old:
        store['workspaces'].append(entry)
    write_store(store)
    return entry


def set_workspace_quick(name, enabled):
    """Switch a workspace's quick-open shortcut on or off without touching anything else. Returns the shortcut's name."""
    if type(enabled) is not bool:
        raise ValueError('Quick-Öffnen kennt nur „an“ und „aus“.')
    store = read_store()
    ws = find(store, name)
    if not ws:
        raise ValueError(f'Den Workspace „{name}“ gibt es nicht.')
    shortcut_name = workspace_shortcut_name(ws['name'])
    if enabled:
        add_workspace_quick(ws['name'])            # zuerst der Shortcut, dann das Kästchen
        ws['quickOpen'] = True
    else:
        remove_workspace_quick(ws['name'])
        ws.pop('quickOpen', None)
    try:
        write_store(store)
    except OSError:
        if enabled:
            remove_workspace_quick(ws['name'])
        raise
    return shortcut_name


def delete_workspace(name):
    store = read_store()
    ws = find(store, name)
    if not ws:
        raise ValueError(f'Den Workspace „{name}“ gibt es nicht.')
    remove_shortcut(ws['name'])
    if ws.get('quickOpen'):
        remove_workspace_quick(ws['name'])
    store['workspaces'] = [w for w in store['workspaces'] if w is not ws]
    write_store(store)


def quick_open_folders():
    """Search folders with quick open switched on (read first, so a broken file stops a sync before it changes anything)."""
    if 'search-folders' not in {e['id'] for e in module_entries()}:
        return []
    result = call_module('search-folders', ['list', str(config_dir())], timeout=30)
    if result['code']:
        raise ValueError(modules_error(result['err'] or result['out']))
    return [folder['path'] for folder in json.loads(result['out']) if folder.get('quickOpen')]


def sync_shortcuts():
    """Recreate every Desktop shortcut (workspaces, their quick-open ones and quick-open folders), e.g. after the Desktop was cleaned up."""
    folders = quick_open_folders()
    count = 0
    for ws in read_store()['workspaces']:
        if ws['shortcut']:
            add_shortcut(ws['name'])
            count += 1
        if ws.get('quickOpen'):
            add_workspace_quick(ws['name'])
            count += 1
    for folder in folders:
        add_folder_shortcut(folder)
        count += 1
    return count


def wake_state():
    if 'remote' not in {e['id'] for e in module_entries()}:
        return None
    try:
        result = call_module('remote', ['wake-state'], timeout=20)
        if result['code']:
            raise ValueError(result['err'] or result['out'])
        data = json.loads(result['out'])
        if (type(data.get('enabled')) is not bool or not isinstance(data.get('text'), str)
                or data.get('level') not in ('ok', 'warn', 'off')):
            raise ValueError('Ungültiger Wachhalten-Status')
        return data
    except (ValueError, AttributeError, OSError, subprocess.SubprocessError) as exc:
        return {'enabled': None, 'text': f'Wachhalten-Status nicht lesbar: {exc}', 'level': 'warn'}


def local_dev_rows(output):
    """Parse the local-dev module's tab-separated list (nine fields per combination); anything else it prints is ignored."""
    options = []
    for line in output.splitlines():
        parts = line.split('\t')
        if len(parts) != 9:
            continue
        options.append({'provider': parts[0], 'providerName': parts[1], 'model': parts[2], 'local': parts[3] == '1',
                        'framework': parts[4], 'frameworkName': parts[5], 'active': parts[6] == '1',
                        'providerReady': parts[7] == '1', 'frameworkReady': parts[8] == '1'})
    return options


def local_dev_module(args):
    """Run the local-dev module and return its stdout; raise ValueError with the module's own reason on failure."""
    result = call_module('local', args, timeout=30)
    if result['code']:
        reason = (result['err'] or result['out'] or f'Status {result["code"]}').splitlines()[-1].strip()
        raise ValueError(re.sub(r'^×\s*', '', reason))
    return result['out']


def local_dev_options(everything=False):
    """Local Dev combinations for the window: {'available', 'options', 'error'}.

    By default only what can be started right now (the workspace dialog). `everything` lists every configured, matching
    combination, installed or not (the setting). The local-dev module owns the detection; this only reads its list."""
    if 'local' not in {e['id'] for e in module_entries()}:
        return {'available': False, 'options': [], 'error': None}
    try:
        return {'available': True, 'options': local_dev_rows(local_dev_module(['--options-all' if everything else '--options'])),
                'error': None}
    except (ValueError, OSError, subprocess.SubprocessError) as exc:
        return {'available': True, 'options': [], 'error': f'Local Dev: {exc}'}


def local_dev_settings():
    """The setting dialog: every combination plus the saved selection, {'available', 'options', 'current', 'error'}."""
    found = dict(local_dev_options(everything=True), current=None)
    if not found['available'] or found['error']:
        return found
    try:
        parts = local_dev_module(['--current']).split('\t')
        if len(parts) == 3 and all(parts):
            found['current'] = dict(zip(LOCAL_DEV_KEYS, parts))
    except (ValueError, OSError, subprocess.SubprocessError) as exc:
        found['error'] = f'Local Dev: {exc}'
    return found


def set_local_dev_default(value):
    """Save the provider / model / CLI that Local Dev preselects (the module validates and writes, like its --setup)."""
    value = clean_local_dev(value)
    return local_dev_module(['--set-default'] + [value[key] for key in LOCAL_DEV_KEYS])


def setting_action(name, enabled):
    if type(enabled) is not bool:
        raise ValueError('Die Einstellung muss ein- oder ausgeschaltet werden.')
    if name == 'keep-awake':
        result = call_module('remote', ['on' if enabled else 'off'], timeout=30)
        if result['code']:
            raise ValueError(result['err'] or result['out'] or 'Wachhalten konnte nicht geändert werden.')
    else:
        raise ValueError(f'Unbekannte Einstellung „{name}“.')


# --- Start ----------------------------------------------------------------------------

def launcher_argv(ws):
    argv = [str(LAUNCHER)]
    for project in ws['projects']:
        argv += ['--project', project]
    if ws.get('localDev'):
        argv += ['--local-dev'] + [ws['localDev'][key] for key in LOCAL_DEV_KEYS]
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


def pick_projects(names):
    """The launcher's own checkbox dialog (project-selection.js) for these names. Returns the chosen ones, [] on cancel."""
    with tempfile.TemporaryDirectory(prefix='vibecode-pick-') as tmp:
        names_file, defaults_file = Path(tmp) / 'names.txt', Path(tmp) / 'defaults.txt'
        names_file.write_text('\n'.join(names) + '\n', encoding='utf-8')
        defaults_file.write_text('', encoding='utf-8')                   # nichts vorgewählt
        result = subprocess.run(['/usr/bin/osascript', '-l', 'JavaScript', str(REPO / 'workspaces' / 'project-selection.js'),
                                 str(names_file), str(defaults_file)], capture_output=True, text=True)
    if result.returncode:
        raise ValueError('Die Auswahl konnte nicht angezeigt werden: ' + osa_error(result.stderr))
    return [line for line in result.stdout.splitlines() if line.strip()]


def open_workspace(name):
    """Quick open of a workspace (its second Desktop shortcut): ask which of its projects to open, then start the launcher
    for exactly those. Cancel starts nothing; a project the launcher no longer knows is left out."""
    refresh_home()
    ws = require(name)
    known = set(list_projects())
    names = [project for project in ws['projects'] if project in known]
    if not names:
        raise ValueError(f'Der Launcher kennt keines der Projekte von „{ws["name"]}“. Prüfe die Repository-Suche in der VibeCode-App.')
    chosen = pick_projects(names)
    if not chosen:
        return []
    argv = launcher_argv({'projects': chosen, 'localDev': ws.get('localDev')})   # Local Dev gehört zum Workspace
    os.execv(argv[0], argv)


def open_folder(path):
    """Quick open, the Desktop shortcut of a search folder: ask which of its repositories to open, then start the
    launcher for exactly those (like a workspace shortcut: this process becomes the launcher). Cancel starts nothing."""
    refresh_home()
    names = projects_in(path, list_project_paths())
    if not names:
        raise ValueError(f'Der Launcher kennt in {path} keine Repositories. Prüfe die Repository-Suche in der VibeCode-App.')
    chosen = pick_projects(names)
    if not chosen:
        return []
    argv = launcher_argv({'projects': chosen})
    os.execv(argv[0], argv)


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
                      and all(isinstance(part, str) for part in entry['run'])
                      and (entry.get('order') is None or type(entry['order']) is int)
                      and (entry.get('status') is None
                           or (isinstance(entry['status'], list) and entry['status']
                               and all(isinstance(part, str) for part in entry['status']))))
                if not ok:
                    raise ValueError(f'Eintrag {entry!r}')
                entries.append(dict(entry, module=manifest.parent.name, dir=str(manifest.parent)))
        except (ValueError, KeyError, TypeError, AttributeError) as exc:
            raise ValueError(f'{manifest} ist ungültig ({exc}).') from exc
    ids = [entry['id'] for entry in entries]
    if len(ids) != len(set(ids)):
        raise ValueError('Zwei Module melden denselben Befehl an.')
    # Reihenfolge im Fenster: optionales "order" (kleiner = weiter oben), sonst alphabetisch nach id.
    return sorted(entries, key=lambda entry: (entry.get('order', 100), entry['id']))


def entry_argv(entry, extra=()):
    return [part.replace('{module}', entry['dir']) for part in entry['run']] + list(extra)


def open_in_terminal(argv):
    # Der Befehl läuft als Argument in AppleScript, nie als zusammengesetzter Quelltext.
    command = [sys.executable, str(CORE / 'terminal_session.py')] + list(argv)
    subprocess.run(['/usr/bin/osascript', '-e', 'on run argv', '-e', 'tell application "Terminal"',
                    '-e', 'activate', '-e', 'do script (item 1 of argv)', '-e', 'end tell',
                    '-e', 'end run', 'exec ' + shlex.join(command)], check=True, timeout=30)


def module_env():
    env = dict(os.environ)
    env.setdefault('VIBECODE_REMOTE_DIR', str(config_dir() / 'remote'))
    return env


def entry_status(entry):
    """What a module says about itself: {"text", "level"} (level ok | warn | off), or None if it says nothing."""
    if not entry.get('status'):
        return None
    argv = [part.replace('{module}', entry['dir']) for part in entry['status']]
    if argv[0] == 'python3':
        argv[0] = sys.executable
    try:
        result = subprocess.run(argv, capture_output=True, text=True, timeout=15,
                                stdin=subprocess.DEVNULL, env=module_env())
        data = json.loads(result.stdout)
        if (result.returncode or not isinstance(data.get('text'), str)
                or data.get('level') not in ('ok', 'warn', 'off')):
            raise ValueError
        return {'text': data['text'], 'level': data['level']}
    except (ValueError, AttributeError, OSError, subprocess.SubprocessError):
        # Ein kaputter Status darf das Fenster nie verhindern: er wird sichtbar als Warnung gezeigt.
        return {'text': 'Status nicht lesbar', 'level': 'warn'}


def call_module(entry_id, args, timeout=60):
    """Run a module entry without a terminal and return {'code', 'out', 'err'} (never raises on exit codes)."""
    entries = {e['id']: e for e in module_entries()}
    if entry_id not in entries:
        raise ValueError(f'Das Modul „{entry_id}“ ist nicht installiert.')
    argv = entry_argv(entries[entry_id], args)
    if argv[0] == 'python3':
        argv[0] = sys.executable
    result = subprocess.run(argv, capture_output=True, text=True, timeout=timeout,
                            stdin=subprocess.DEVNULL, env=module_env())
    return {'code': result.returncode, 'out': result.stdout.strip(), 'err': result.stderr.strip()}


def ssh_state():
    """SSH overview for the window: configured hosts, the saved Mac target, what is available."""
    present = {e['id'] for e in module_entries()}
    info = {'hosts': [], 'mac': None, 'guided': 'setup' in present, 'share': 'remote' in present, 'errors': []}
    for entry_id, args, key in (('hosts', ['list', str(config_dir())], 'hosts'),
                                ('remote', ['ssh', 'show'], 'mac')):
        if entry_id not in present:
            continue
        try:
            result = call_module(entry_id, args, timeout=20)
            if result['code']:
                raise ValueError(result['err'] or result['out'] or f'Status {result["code"]}')
            data = json.loads(result['out'])
            info[key] = data['target'] if key == 'mac' else data
        except (ValueError, KeyError, TypeError, subprocess.SubprocessError) as exc:
            info['errors'].append(f'{entry_id}: {exc}')
    info['available'] = info['guided'] or info['share'] or bool(info['hosts'])
    return info


def modules_error(text):
    """The reason without the module's own prefix ("Suchordner: ", "Remote-Repository-Suche: ")."""
    return re.sub(r'^(Suchordner|Remote-Repository-Suche): ', '', (text or '').strip())


def projects_in(folder, known):
    """Names of the launcher's projects that live inside `folder`, for the quick-open dialog (remote projects never do)."""
    root = os.path.realpath(folder).rstrip(os.sep)
    names = [name for name, path in known
             if not path.startswith('vscode-remote://') and (os.path.realpath(path) + os.sep).startswith(root + os.sep)]
    return sorted(names, key=str.casefold)


def folder_state(hosts):
    """Search folders for the window: local ones with a fresh repository count, remote ones from the host list.

    A local folder with quick open switched on also carries `shortcut`, the name of its Desktop shortcut."""
    present = {e['id'] for e in module_entries()}
    info = {'local': [], 'remote': [dict(host) for host in hosts],
            'canAddLocal': 'search-folders' in present, 'canAddRemote': 'hosts' in present, 'errors': []}
    if 'search-folders' in present:
        try:
            result = call_module('search-folders', ['list', str(config_dir())], timeout=30)
            if result['code']:
                raise ValueError(modules_error(result['err'] or result['out']))
            info['local'] = json.loads(result['out'])
            for folder in info['local']:
                if folder.get('quickOpen'):
                    try:
                        folder['shortcut'] = folder_shortcut_name(folder['path'])
                    except ValueError:
                        folder['shortcut'] = None
        except (ValueError, TypeError, subprocess.SubprocessError) as exc:
            info['errors'].append(f'Suchordner: {exc}')
    return info


def folder_action(action, path=None, host=None, root=None, mode=None):
    """Add or remove a search folder, or switch its quick open (the Desktop shortcut) `on`/`off`.
    Returns {'message', 'warning'}; raises ValueError with a readable reason."""
    config = str(config_dir())

    def local_folder(value):
        """The search folder's entry from the module, matched like the module does (real paths), or None."""
        if not isinstance(value, str) or not value.strip():
            return None
        listing = json.loads(checked('search-folders', ['list', config], 30)['out'])
        return next((entry for entry in listing if os.path.realpath(entry['path']) == os.path.realpath(value)), None)

    def checked(entry_id, args, timeout=60):
        result = call_module(entry_id, args, timeout=timeout)
        if result['code']:
            raise ValueError(modules_error(result['err'] or result['out']) or f'Status {result["code"]}')
        return result

    def plural(count):
        return f'{count} {"Repository" if count == 1 else "Repositories"}'

    if action == 'add':
        found = json.loads(checked('search-folders', ['add', config, path or ''])['out'])
        warning = None
        if found['truncated']:
            warning = 'Der Ordner ist sehr groß, die Suche wurde abgebrochen. Wähle einen kleineren Ordner.'
        elif not found['repos']:
            warning = 'Darin wurden keine Git-Repositories gefunden (bis zu 4 Ebenen tief).'
        return {'message': f'Ordner hinzugefügt: {found["path"]} ({plural(found["repos"])})', 'warning': warning}
    if action == 'remove':
        known = local_folder(path)
        if known and known.get('quickOpen'):
            remove_folder_shortcut(known['path'])          # sonst bliebe ein toter Shortcut auf dem Schreibtisch
        checked('search-folders', ['remove', config, path or ''])
        return {'message': f'Suchordner entfernt: {path}. Die Repositories selbst bleiben unberührt.', 'warning': None}
    if action == 'quick-open':
        if mode not in ('on', 'off'):
            raise ValueError('Quick-Öffnen kennt nur „on“ und „off“.')
        known = local_folder(path)
        if known is None:
            raise ValueError(f'Dieser Ordner ist kein Suchordner: {path}')
        if mode == 'off':
            remove_folder_shortcut(known['path'])
            checked('search-folders', ['quick', config, known['path'], 'off'], 30)
            return {'message': f'Quick-Öffnen aus: der Shortcut „{folder_shortcut_name(known["path"])}“ ist vom Schreibtisch entfernt.',
                    'warning': None}
        # Zuerst der Shortcut: scheitert er (z. B. ein fremdes Objekt gleichen Namens), bleibt das Kästchen aus.
        name = add_folder_shortcut(known['path'])
        try:
            checked('search-folders', ['quick', config, known['path'], 'on'], 30)
        except ValueError:
            remove_folder_shortcut(known['path'])
            raise
        return {'message': f'Quick-Öffnen an: „{name}“ liegt auf dem Schreibtisch und öffnet die Repositories von {known["path"]}.',
                'warning': None}
    if action == 'add-remote':
        host, root = (host or '').strip(), (root or '').strip() or '~'
        known = any(entry['host'] == host for entry in ssh_state()['hosts'])
        checked('hosts', ['add', config, host, root])
        # Ohne Terminal und ohne Passwortabfrage suchen: klappt die Anmeldung nicht, bleibt der Host trotzdem gespeichert.
        search = call_module('hosts', ['discover', config], timeout=90)
        warning = None
        if search['code']:
            warning = modules_error(search['err'] or search['out'])
        elif f'Remote {host}: ' in search['err']:
            warning = search['err'].split(f'Remote {host}: ', 1)[1].splitlines()[0]
        count = next((entry['repos'] for entry in json.loads(checked('hosts', ['list', config])['out'])
                      if entry['host'] == host), 0)
        verb = 'geändert' if known else 'hinzugefügt'
        message = f'Remote-Ordner {verb}: {host}:{root} ({plural(count)})'
        if warning:
            message += '. Gespeichert, aber die Suche ist fehlgeschlagen'
        return {'message': message, 'warning': warning}
    if action == 'remove-remote':
        checked('hosts', ['remove', config, host or ''])
        return {'message': f'Remote-Ordner entfernt: {host}. Auf dem Server bleibt alles unberührt.', 'warning': None}
    raise ValueError(f'Unbekannte Aktion „{action}“.')


def osa_error(text):
    """A readable reason from osascript's `execution error: Error: … (-2700)`."""
    text = (text or '').strip().splitlines()[-1] if (text or '').strip() else ''
    text = re.sub(r'^.*?execution error: (?:Error: )?', '', text)
    return re.sub(r'\s*\(-?\d+\)$', '', text).strip()


def list_project_paths():
    """(name, path) of every project, exactly as the launcher looks them up. Presets are stored per path."""
    result = subprocess.run([str(LAUNCHER), '--list-paths'], capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise ValueError('Projektpfade nicht lesbar: ' + (result.stderr.strip() or result.stdout.strip()))
    return [tuple(line.split('\t', 1)) for line in result.stdout.splitlines() if '\t' in line]


def presets_state(projects=None):
    """Presets for the window: repos, their custom presets, presets of repos that moved, the defaults.

    `general` is the user's general default ({terminals, urls}) for repos without a preset, or None while the
    built-in `defaults` apply."""
    present = {e['id'] for e in module_entries()}
    info = {'available': 'preset-store' in present, 'repos': [], 'items': [], 'orphans': [],
            'defaults': {'local': [], 'remote': []}, 'general': None, 'errors': []}
    if not info['available']:
        return info
    try:
        config = str(config_dir())
        known = projects if projects is not None else list_project_paths()
        defaults, stored, general = (call_module('preset-store', args, timeout=30)
                                     for args in (['defaults'], ['list', config], ['general', config]))
        for reply in (defaults, stored, general):
            if reply['code']:
                raise ValueError(osa_error(reply['err'] or reply['out']))
        info['defaults'] = json.loads(defaults['out'])
        info['general'] = json.loads(general['out'])
        custom = {entry['path']: entry for entry in json.loads(stored['out'])}
    except (ValueError, TypeError, KeyError, subprocess.SubprocessError) as exc:
        info['errors'].append(f'Presets: {exc}')
        return info
    paths = {path for _name, path in known}
    for name, path in known:
        info['repos'].append({'name': name, 'path': path, 'remote': path.startswith('vscode-remote://'),
                              'custom': path in custom})
        if path in custom:
            info['items'].append(dict(custom[path], name=name, remote=path.startswith('vscode-remote://')))
    by_name = {}
    for name, path in known:
        by_name.setdefault(Path(path).name, []).append((name, path))
    for path, entry in custom.items():
        if path not in paths:
            label = Path(path).name or path
            same = [match for match in by_name.get(label, []) if match[1] not in custom]
            # Nur ein eindeutiger, noch freier Treffer wird vorgeschlagen.
            info['orphans'].append(dict(entry, name=label, suggestion=(
                {'name': same[0][0], 'path': same[0][1]} if len(same) == 1 else None)))
    return info


def preset_action(action, path, preset=None, to=None):
    """Save, reset or move one repository's preset, or save/reset the general default (`save-general`,
    `reset-general`, no path). Returns {'message'}; raises ValueError with a readable reason."""
    config = str(config_dir())

    def checked(args):
        result = call_module('preset-store', args, timeout=60)
        if result['code']:
            raise ValueError(osa_error(result['err'] or result['out']) or f'Status {result["code"]}')
        return result

    def save(target, content):
        if not isinstance(content, dict):
            raise ValueError('Das Preset fehlt.')
        with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8') as handle:
            json.dump(content, handle, ensure_ascii=False)
        try:
            # target None = der allgemeine Standard (kein Repository-Pfad)
            return checked(['save', config, target, handle.name] if target is not None
                           else ['save-general', config, handle.name])
        finally:
            os.unlink(handle.name)

    if action == 'save':
        saved = json.loads(save(path, preset)['out'])
        return {'message': f'Preset gespeichert ({len(saved["terminals"])} Terminals, {len(saved["urls"])} Browser-Tabs).'}
    if action == 'reset':
        checked(['reset', config, path])
        return {'message': 'Preset zurückgesetzt: es gilt wieder der Standard.'}
    if action == 'save-general':
        saved = json.loads(save(None, preset)['out'])
        return {'message': f'Allgemeiner Standard gespeichert ({len(saved["terminals"])} Terminals, '
                           f'{len(saved["urls"])} Browser-Tabs). Er gilt für Repositories ohne eigenes Preset.'}
    if action == 'reset-general':
        checked(['reset-general', config])
        return {'message': 'Allgemeiner Standard zurückgesetzt: es gelten wieder die eingebauten Standard-Terminals.'}
    if action == 'move':
        if not to or to == path:
            raise ValueError('Bitte ein anderes Repository als Ziel wählen.')
        stored = json.loads(checked(['list', config])['out'])
        entry = next((item for item in stored if item['path'] == path), None)
        if entry is None:
            raise ValueError('Dieses Preset gibt es nicht mehr.')
        if any(item['path'] == to for item in stored):
            raise ValueError('Das Ziel-Repository hat schon ein eigenes Preset.')
        save(to, {'terminals': entry['terminals'], 'urls': entry['urls']})
        checked(['reset', config, path])        # erst nach erfolgreichem Kopieren löschen
        return {'message': 'Preset übernommen.'}
    raise ValueError(f'Unbekannte Aktion „{action}“.')


def line_tokens(line, keyword):
    """Words of a pasted line such as `workspace remote ssh join user@host SHA256:…`, after `keyword`."""
    if not isinstance(line, str) or not line.strip():
        raise ValueError('Bitte die Zeile vom anderen Mac einfügen.')
    if '\n' in line.strip() or len(line) > 2000:
        raise ValueError('Bitte genau eine Zeile einfügen.')
    try:
        tokens = shlex.split(line)
    except ValueError:
        raise ValueError('Die Zeile ist unvollständig: Anführungszeichen fehlen. Bitte komplett kopieren.') from None
    if keyword in tokens:
        tokens = tokens[tokens.index(keyword) + 1:]
    # Optionen aus eingefügtem Text werden nie übernommen.
    return [token for token in tokens if not token.startswith('--')]


def ssh_action(action, line=''):
    if action not in SSH_ACTIONS:
        raise ValueError(f'Unbekannte SSH-Aktion „{action}“.')
    if action in ('share', 'share-wake', 'share-recheck'):
        # JSON statt Terminal-Text: das Fenster zeigt daraus eine kurze Maske. "recheck" öffnet die Systemeinstellungen nicht erneut.
        args = ['ssh', 'share', '--json'] + {'share': [], 'share-wake': ['--wake'], 'share-recheck': ['--no-open']}[action]
    elif action == 'join':
        tokens = line_tokens(line, 'join')
        if not tokens:
            raise ValueError('In der Zeile fehlt benutzer@host.')
        args = ['ssh', 'join'] + tokens
    else:
        tokens = line_tokens(line, 'allow')
        if not tokens:
            raise ValueError('In der Zeile fehlt der Schlüssel.')
        args = ['ssh', 'allow', '--check' if action == 'allow-check' else '--yes'] + tokens
    return call_module('remote', args, timeout=90)


def open_ssh(kind, name=None):
    """Open an interactive SSH session (or the guided setup) in Terminal."""
    entries = {e['id']: e for e in module_entries()}
    if kind == 'guided':
        if 'setup' not in entries:
            raise ValueError('Das Workspaces-Modul mit dem Setup fehlt.')
        open_in_terminal(entry_argv(entries['setup'], ['--connect-remote']))
    elif kind == 'mac':
        if 'remote' not in entries:
            raise ValueError('Das Remote-Modul fehlt.')
        open_in_terminal(entry_argv(entries['remote'], ['ssh']))
    elif kind == 'host':
        # Nur Hosts aus der eigenen Liste: der Name kommt aus dem Fenster, nie ungeprüft in den Befehl.
        if name not in [entry['host'] for entry in ssh_state()['hosts']]:
            raise ValueError(f'„{name}“ ist kein eingerichteter SSH-Host.')
        open_in_terminal(['/usr/bin/ssh', '--', name])
    else:
        raise ValueError(f'Unbekannte Verbindungsart „{kind}“.')


def state():
    store, paths = read_store(), list_project_paths()
    projects = [name for name, _path in paths]           # dieselbe Liste wie --list-projects, ohne zweiten Launcher-Aufruf
    known = set(projects)
    menu = [e for e in module_entries() if e.get('menu')]
    with ThreadPoolExecutor(max_workers=4) as pool:      # Modulstatus parallel: das Fenster soll zügig öffnen
        statuses = list(pool.map(entry_status, menu))
    ssh = ssh_state()
    return {
        'workspaces': [dict(ws, missing=[p for p in ws['projects'] if p not in known], quickOpen=bool(ws.get('quickOpen')))
                       for ws in store['workspaces']],
        'projects': projects,
        'canLaunch': any(e['id'] == 'launch' for e in module_entries()),
        'entries': [{'id': e['id'], 'title': e['title'], 'status': status}
                    for e, status in zip(menu, statuses)],
        'ssh': ssh,
        'folders': folder_state(ssh['hosts']),
        'presets': presets_state(paths),
        'settings': {'wake': wake_state()},
    }


# --- Kommandozeile --------------------------------------------------------------------

def window():
    refresh_home()
    result = subprocess.run(['/usr/bin/osascript', '-l', 'JavaScript', str(CORE / 'window.js'),
                             sys.executable, str(CORE / 'vibecode.py')])
    return result.returncode


def usage(entries):
    lines = ['VibeCode Workspace', '',
             '  Aufruf: ./VibeCode\\ Workspace.command <Befehl>   (unten kurz: vibecode)', '',
             '  vibecode                      Hauptfenster öffnen',
             '  vibecode list                 gespeicherte Workspaces',
             '  vibecode run NAME             Workspace starten',
             '  vibecode save --name N --project P [--project Q] [--shortcut]',
             '  vibecode delete --name N      Workspace samt Shortcut löschen',
             '  vibecode shortcuts sync       Schreibtisch-Shortcuts neu anlegen',
             '  vibecode settings keep-awake on|off',
             '  vibecode projects             Projekte, die der Launcher kennt',
             '  vibecode open-folder ORDNER   Repositories dieses Ordners zum Ankreuzen zeigen und öffnen (Schreibtisch-Shortcut)',
             '  vibecode open-workspace NAME  Projekte dieses Workspaces zum Ankreuzen zeigen und öffnen (Quick-Shortcut)',
             '  vibecode workspace-quick --name N on|off   Quick-Öffnen-Shortcut eines Workspaces',
             '  vibecode save … [--local-dev-provider P --local-dev-model M --local-dev-framework F | --no-local-dev]',
             '  vibecode local-options        startbare Local-Dev-Kombinationen (JSON)',
             '  vibecode local-settings       alle Kombinationen und die gespeicherte Vorauswahl (JSON)',
             '  vibecode local-default --provider P --model M --framework F   Local-Dev-Vorauswahl speichern']
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
            print(f'{ws["name"]}\t{", ".join(ws["projects"])}\t{"Shortcut" if ws["shortcut"] else "-"}'
                  + ('\tQuick-Öffnen' if ws.get('quickOpen') else '')
                  + ('\tLocal Dev' if ws.get('localDev') else ''))
        return 0
    if command == 'projects':
        print('\n'.join(list_projects()))
        return 0
    if command == '_state':
        print(json.dumps(state(), ensure_ascii=False))
        return 0
    if command == 'settings':
        parser = argparse.ArgumentParser(prog='vibecode settings', add_help=False)
        parser.add_argument('name', choices=['keep-awake'])
        parser.add_argument('value', choices=['on', 'off'])
        options = parser.parse_args(rest)
        setting_action(options.name, options.value == 'on')
        return 0
    if command == '_ssh':
        parser = argparse.ArgumentParser(prog='vibecode _ssh', add_help=False)
        parser.add_argument('action')
        parser.add_argument('--line', default='')
        options = parser.parse_args(rest)
        print(json.dumps(ssh_action(options.action, options.line), ensure_ascii=False))
        return 0
    if command == 'open-folder':
        if len(rest) != 1:
            raise ValueError('Aufruf: vibecode open-folder ORDNER')
        open_folder(rest[0])
        return 0
    if command == 'folders':
        parser = argparse.ArgumentParser(prog='vibecode folders', add_help=False)
        parser.add_argument('action', choices=['list', 'add', 'remove', 'add-remote', 'remove-remote', 'quick-open'])
        parser.add_argument('positional', nargs='*')
        for option in ('--path', '--host', '--root', '--mode'):
            parser.add_argument(option)
        parser.add_argument('--json', action='store_true')
        options = parser.parse_args(rest)
        if options.action == 'list':
            info = folder_state(ssh_state()['hosts'])
            for entry in info['local']:
                print(f'lokal\t{entry["path"]}\t{entry["repos"] if entry["exists"] else "Ordner fehlt"}'
                      + ('\tQuick-Öffnen' if entry.get('quickOpen') else ''))
            for entry in info['remote']:
                print(f'remote\t{entry["host"]}:{entry["root"]}\t{entry["repos"]}')
            return 0
        words = options.positional
        result = folder_action(options.action, path=options.path or (words[0] if words else None),
                               host=options.host or (words[0] if words else None),
                               root=options.root or (words[1] if len(words) > 1 else None),
                               mode=options.mode or (words[1] if options.action == 'quick-open' and len(words) > 1 else None))
        if options.json:
            print(json.dumps(result, ensure_ascii=False))
        else:
            print(result['message'] + (f'\nHinweis: {result["warning"]}' if result['warning'] else ''))
        return 0
    if command == 'presets':
        parser = argparse.ArgumentParser(prog='vibecode presets', add_help=False)
        parser.add_argument('action', choices=['list', 'save', 'reset', 'move', 'save-general', 'reset-general'])
        parser.add_argument('positional', nargs='*')
        for option in ('--path', '--to', '--data'):
            parser.add_argument(option)
        parser.add_argument('--json', action='store_true')
        options = parser.parse_args(rest)
        if options.action == 'list':
            info = presets_state()
            if info['general']:
                print(f'Allgemeiner Standard\t{", ".join(t["name"] for t in info["general"]["terminals"]) or "keine Terminals"}'
                      f'\t{len(info["general"]["urls"])} Browser-Tabs')
            for item in info['items']:
                print(f'{item["name"]}\t{", ".join(t["name"] for t in item["terminals"]) or "keine Terminals"}\t{len(item["urls"])} Browser-Tabs')
            for orphan in info['orphans']:
                print(f'{orphan["name"]}\tRepository nicht mehr gefunden' +
                      (f' -> {orphan["suggestion"]["path"]}' if orphan['suggestion'] else ''))
            return 0
        words = options.positional
        data = json.loads(options.data) if options.data else None
        result = preset_action(options.action, options.path or (words[0] if words else ''), preset=data,
                               to=options.to or (words[1] if len(words) > 1 else None))
        print(json.dumps(result, ensure_ascii=False) if options.json else result['message'])
        return 0
    if command == 'ssh-open':
        parser = argparse.ArgumentParser(prog='vibecode ssh-open', add_help=False)
        parser.add_argument('--kind', required=True)
        parser.add_argument('--name')
        options = parser.parse_args(rest)
        open_ssh(options.kind, options.name)
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
    if command == 'local-options':
        print(json.dumps(local_dev_options(), ensure_ascii=False))
        return 0
    if command == 'local-settings':
        print(json.dumps(local_dev_settings(), ensure_ascii=False))
        return 0
    if command == 'local-default':
        parser = argparse.ArgumentParser(prog='vibecode local-default', add_help=False)
        for key in LOCAL_DEV_KEYS:
            parser.add_argument(f'--{key}', required=True)
        options = parser.parse_args(rest)
        print(set_local_dev_default({key: getattr(options, key) for key in LOCAL_DEV_KEYS}))
        return 0
    if command == 'open-workspace':
        if len(rest) != 1:
            raise ValueError('Aufruf: vibecode open-workspace NAME')
        open_workspace(rest[0])
        return 0
    if command == 'workspace-quick':
        parser = argparse.ArgumentParser(prog='vibecode workspace-quick', add_help=False)
        parser.add_argument('--name', required=True)
        parser.add_argument('mode', choices=['on', 'off'])
        options = parser.parse_args(rest)
        shortcut = set_workspace_quick(options.name, options.mode == 'on')
        print(f'Quick-Öffnen an: „{shortcut}“ liegt auf dem Schreibtisch.' if options.mode == 'on'
              else f'Quick-Öffnen aus: „{shortcut}“ ist vom Schreibtisch entfernt.')
        return 0
    if command == 'save':
        parser = argparse.ArgumentParser(prog='vibecode save', add_help=False)
        parser.add_argument('--name', required=True)
        parser.add_argument('--project', action='append', default=[])
        parser.add_argument('--rename-from')
        parser.add_argument('--shortcut', action='store_true')
        parser.add_argument('--no-shortcut', action='store_true')
        for key in LOCAL_DEV_KEYS:
            parser.add_argument(f'--local-dev-{key}')
        parser.add_argument('--no-local-dev', action='store_true')
        options = parser.parse_args(rest)
        given = {key: getattr(options, f'local_dev_{key}') for key in LOCAL_DEV_KEYS}
        if options.no_local_dev and any(value is not None for value in given.values()):
            raise ValueError('--no-local-dev und --local-dev-… schließen sich aus.')
        # Nichts angegeben: Local Dev bleibt, wie es war. Teilweise angegeben: abgelehnt (alle drei oder keins).
        local_dev = False if options.no_local_dev else (given if any(value is not None for value in given.values()) else None)
        ws = save_workspace(options.name, options.project, options.shortcut and not options.no_shortcut,
                            options.rename_from, local_dev=local_dev)
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
    from terminal_session import wrap_if_needed
    wrap_if_needed([sys.executable, str(CORE / 'vibecode.py')] + sys.argv[1:])
    try:
        sys.exit(main(sys.argv[1:]))
    except (ValueError, OSError, subprocess.SubprocessError) as exc:
        print('VibeCode: ' + str(exc), file=sys.stderr)
        sys.exit(1)
