#!/usr/bin/env python3
"""Persistent macOS wake/app control terminal. No third-party packages required."""
import datetime as dt
import fcntl
import getpass
import json
import math
import os
from pathlib import Path
import plistlib
import re
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parent
BASE = Path(os.environ.get(
    'VIBECODE_REMOTE_DIR', str(Path.home() / '.config/vibecode-workspace/remote')))
LABEL = 'com.vibecode-workspace.remote'
PLIST = Path.home() / 'Library/LaunchAgents' / (LABEL + '.plist')
DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
PLATFORM_PRESETS = ['Claude', 'Claude Code', 'Codex', 'OpenCode']
CLI_PLATFORMS = {'Claude Code': 'claude', 'Codex': 'codex', 'OpenCode': 'opencode'}
MANUAL_END = 253402300799  # 9999-12-31 23:59:59 UTC; displayed as "bis AUS".
WAKE_SETTINGS = ('keep_awake', 'apps', 'close_apps_on_off', 'switch_at', 'cycle')
CONTROLLER_VERSION = 3
INTERNAL_DEFAULTS = {
    # Kept internally so installations from the former scheduled mode can be
    # detected and safely migrated/cancelled. They are not user-facing config.
    'enabled': False,
    'days': ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    'start': '14:00',
    'duration': '5h',
    'wake_mac': True,
    'open_workspace': False,
    'open_terminals': False,
    'open_control_terminal': True,
}


def read(name, default=None):
    p = BASE / name
    return json.loads(p.read_text()) if p.exists() else default


def write(name, value):
    BASE.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=BASE)
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump(value, f, indent=2)
            f.write('\n')
        os.replace(tmp, BASE / name)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def duration(value, *, max_seconds=86400):
    m = re.fullmatch(r'([1-9][0-9]*)(m|h)', value)
    if not m:
        raise ValueError('Gib eine Dauer wie 5h oder 90m ein.')
    seconds = int(m[1]) * (3600 if m[2] == 'h' else 60)
    if max_seconds is not None and seconds > max_seconds:
        raise ValueError('Maximale Dauer: 24h.')
    return seconds


def config(overrides=None):
    defaults = {**INTERNAL_DEFAULTS,
                **json.loads((ROOT / 'remote.example.json').read_text())}
    c = {**defaults, **read('config.json', {}), **(overrides or {})}
    for k, v in defaults.items():
        if isinstance(v, bool) and type(c[k]) is not bool:
            raise ValueError(k + ' muss true oder false sein.')
    if not isinstance(c['days'], list) or not c['days'] or any(d not in DAYS for d in c['days']):
        raise ValueError('days benötigt englische Wochentage.')
    if not isinstance(c['apps'], list) or any(not isinstance(a, str) or not a.strip() for a in c['apps']):
        raise ValueError('apps benötigt eine Liste von App-Namen.')
    if 'switch_at' in c and (type(c['switch_at']) is not int or not 0 <= c['switch_at'] < MANUAL_END):
        raise ValueError('Ungültiger Zeitpunkt für den Wachhalten-Timer.')
    cycle = c['cycle']
    if cycle is not None and (
        not c.get('switch_at') or not isinstance(cycle, dict) or set(cycle) != {'on_seconds', 'off_seconds'}
        or any(type(seconds) is not int or seconds <= 0 for seconds in cycle.values())
        or c['switch_at'] + sum(cycle.values()) >= MANUAL_END
    ):
        raise ValueError('Ungültige AN- oder AUS-Dauer für den automatischen Wechsel.')
    if not re.fullmatch(r'([01][0-9]|2[0-3]):[0-5][0-9]', c['start']):
        raise ValueError('start benötigt HH:MM.')
    duration(c['duration'])
    return c


def simple_config(saved=None):
    saved = read('config.json') if saved is None else saved
    return (isinstance(saved, dict) and set(saved) <= set(WAKE_SETTINGS) and
            'keep_awake' in saved and 'apps' in saved)


def slots(c, now):
    """Local wall-clock start, elapsed duration; includes overnight windows."""
    local = dt.datetime.fromtimestamp(now)
    h, m = map(int, c['start'].split(':'))
    result = []
    for offset in range(-1, 8):
        day = local.date() + dt.timedelta(days=offset)
        if DAYS[day.weekday()] in c['days']:
            start = dt.datetime.combine(day, dt.time(h, m)).timestamp()
            result.append((start, start + duration(c['duration'])))
    return result


def timer_phase(c, now):
    """Return the current state and the next switch time, or zero for no switch."""
    initial_on, first_switch = c['keep_awake'], c.get('switch_at', 0)
    if not first_switch or now < first_switch:
        return initial_on, first_switch
    cycle = c['cycle']
    if not cycle:
        return not initial_on, 0

    cycle_length = cycle['on_seconds'] + cycle['off_seconds']
    first_phase_length = cycle['off_seconds'] if initial_on else cycle['on_seconds']
    completed_cycles, elapsed = divmod(int(now) - first_switch, cycle_length)
    cycle_start = first_switch + completed_cycles * cycle_length
    if elapsed < first_phase_length:
        return not initial_on, cycle_start + first_phase_length
    return initial_on, cycle_start + cycle_length


def window(c, state, now):
    if 'switch_at' in c:
        enabled, next_switch = timer_phase(c, now)
        return (next_switch or MANUAL_END) if enabled else 0
    if state.get('disabled', False) or not c['keep_awake']:
        return 0
    # Older manual and weekly configurations still use request.json.
    if simple_config():
        return MANUAL_END
    ends = [MANUAL_END if state.get('manual_on', False) else state.get('manual_until', 0)]
    if c['enabled']:
        ends += [end for start, end in slots(c, now)
                 if start <= now < end and end > state.get('skip_until', 0)]
    return max([end for end in ends if end > now], default=0)


def run(*args, check=True):
    result = subprocess.run(args, capture_output=True, text=True, timeout=30)
    if check and result.returncode:
        raise ValueError(f'{args[0]}: {result.stderr.strip() or result.stdout.strip()}')
    return result


def app_running(name):
    # Match the desktop executable's bundle path, not arbitrary CLI sessions of the same name.
    pattern = r'/' + re.escape(name) + r'\.app/Contents/'
    return run('/usr/bin/pgrep', '-f', pattern, check=False).returncode == 0


def app_pids(name):
    """Return only processes whose executable path belongs to the named .app."""
    pattern = r'/' + re.escape(name) + r'\.app/Contents/'
    result = run('/usr/bin/pgrep', '-f', pattern, check=False)
    return [int(value) for value in result.stdout.split() if value.isdigit()]


def quit_apps(apps):
    """Quit complete app processes, escalating only when graceful quit is ignored."""
    apps = list(dict.fromkeys(apps))
    # App names are argv-passed, not interpolated into AppleScript source.
    for app in apps:
        run('/usr/bin/osascript', '-e', 'on run argv', '-e',
            'tell application (item 1 of argv) to quit', '-e',
            'end run', app, check=False)

    deadline = time.monotonic() + 4
    remaining = {app: app_pids(app) for app in apps}
    while any(remaining.values()) and time.monotonic() < deadline:
        time.sleep(0.2)
        remaining = {app: app_pids(app) for app in apps}

    # A normal SIGTERM handles apps that ignored AppleScript without immediately
    # resorting to a force kill. Every PID was resolved through its .app path.
    for pids in remaining.values():
        for pid in pids:
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass

    deadline = time.monotonic() + 2
    while any(remaining.values()) and time.monotonic() < deadline:
        time.sleep(0.2)
        remaining = {app: app_pids(app) for app in apps}

    for pids in remaining.values():
        for pid in pids:
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass


def cli_executable(platform):
    command = CLI_PLATFORMS[platform]
    candidates = [shutil.which(command)]
    candidates += [
        str(Path.home() / f'.local/bin/{command}'),
        str(Path.home() / f'.npm-global/bin/{command}'),
        str(Path.home() / f'.opencode/bin/{command}'),
    ]
    nvm_candidates = list((Path.home() / '.nvm/versions/node').glob(f'*/bin/{command}'))
    candidates += [str(path) for path in sorted(
        nvm_candidates, key=lambda path: path.stat().st_mtime, reverse=True)]
    for candidate in candidates:
        if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK):
            return str(Path(candidate).resolve())
    raise ValueError(f'{platform} ist optional und derzeit nicht installiert.')


def process_rows():
    result = run('/bin/ps', '-axww', '-o', 'pid=,tty=,command=', check=False)
    rows = []
    for line in result.stdout.splitlines():
        parts = line.strip().split(None, 2)
        if len(parts) == 3 and parts[0].isdigit():
            rows.append((int(parts[0]), parts[1], parts[2]))
    return rows


def valid_cli_handle(handle):
    return (isinstance(handle, dict) and isinstance(handle.get('tty'), str) and
            re.fullmatch(r'/dev/tty[\w.-]+', handle['tty']) is not None and
            isinstance(handle.get('token'), str) and
            re.fullmatch(r'[0-9a-f]{32}', handle['token']) is not None)


def cli_handle_alive(handle):
    if not valid_cli_handle(handle):
        return False
    tty = Path(handle['tty']).name
    return any(row_tty == tty and handle['token'] in command
               for _pid, row_tty, command in process_rows())


def cli_handles():
    saved = read('cli-terminals.json', {})
    if not isinstance(saved, dict):
        return {}
    return {name: handle for name, handle in saved.items()
            if name in CLI_PLATFORMS and valid_cli_handle(handle)}


def save_cli_handles(handles):
    write('cli-terminals.json', handles)


def saved_managed_apps():
    saved = read('managed-apps.json', [])
    if not isinstance(saved, list):
        return set()
    return {name for name in saved if isinstance(name, str) and name.strip()}


def save_managed_apps(apps):
    write('managed-apps.json', sorted(apps))


def close_terminal_tab(tty_path):
    run('/usr/bin/osascript', '-e', 'on run argv',
        '-e', 'set targetTTY to item 1 of argv',
        '-e', 'tell application "Terminal"',
        '-e', 'repeat with terminalWindow in windows',
        '-e', 'repeat with terminalTab in tabs of terminalWindow',
        '-e', 'if (tty of terminalTab) is targetTTY then',
        '-e', 'if (count of tabs of terminalWindow) is 1 then close terminalWindow saving no',
        '-e', 'return',
        '-e', 'end if',
        '-e', 'end repeat',
        '-e', 'end repeat',
        '-e', 'end tell',
        '-e', 'end run', tty_path, check=False)


def launch_cli_platform(platform):
    """Open a selected terminal-only platform in an owned Apple Terminal tab."""
    executable = cli_executable(platform)
    token = os.urandom(16).hex()
    host = [sys.executable, str(ROOT / 'remote.py'), '_cli_host', token, executable]
    command = 'exec ' + shlex.join(host)
    result = run(
        '/usr/bin/osascript',
        '-e', 'on run argv',
        '-e', 'tell application "Terminal"',
        '-e', 'activate',
        '-e', 'set platformTab to do script (item 1 of argv)',
        '-e', 'repeat 20 times',
        '-e', 'set terminalTTY to tty of platformTab',
        '-e', 'if terminalTTY is not "" then return terminalTTY',
        '-e', 'delay 0.1',
        '-e', 'end repeat',
        '-e', 'error "Terminal-TTY konnte nicht ermittelt werden."',
        '-e', 'end tell',
        '-e', 'end run',
        command,
    )
    tty = result.stdout.strip()
    handle = {'tty': tty, 'token': token}
    if not valid_cli_handle(handle):
        raise ValueError(f'Ungültige Terminal-Kennung für {platform}: {tty or "leer"}')
    deadline = time.monotonic() + 3
    while not cli_handle_alive(handle) and time.monotonic() < deadline:
        time.sleep(0.1)
    if not cli_handle_alive(handle):
        close_terminal_tab(tty)
        raise ValueError(f'{platform} konnte im Terminal nicht gestartet werden.')
    return handle


def close_cli_platform(handle):
    """Terminate only the CLI tab carrying our random ownership token."""
    if not cli_handle_alive(handle):
        return
    tty_path = handle['tty']
    tty = Path(tty_path).name
    pids = [pid for pid, row_tty, _command in process_rows() if row_tty == tty]
    for signal_number, wait_seconds in ((signal.SIGTERM, 2), (signal.SIGKILL, 0)):
        for pid in pids:
            try:
                os.kill(pid, signal_number)
            except ProcessLookupError:
                pass
        if not wait_seconds:
            break
        deadline = time.monotonic() + wait_seconds
        while time.monotonic() < deadline:
            time.sleep(0.2)
            live_pids = {pid for pid, row_tty, _command in process_rows() if row_tty == tty}
            pids = [pid for pid in pids if pid in live_pids]
            if not pids:
                break

    # Once all processes have gone, close the exact tab that VibeCode opened.
    close_terminal_tab(tty_path)


def platform_running(name):
    if name in CLI_PLATFORMS:
        return cli_handle_alive(cli_handles().get(name, {}))
    return app_running(name)


def platform_label(name):
    if name in CLI_PLATFORMS:
        optional = 'optional, ' if name == 'OpenCode' else ''
        return f'{name} ({optional}Terminal)'
    return f'{name} App'


def stamp(value):
    if value == MANUAL_END:
        return 'manuell (bis AUS)'
    return dt.datetime.fromtimestamp(value).strftime('%d.%m.%Y um %H:%M') if value else '—'


def status(output=print):
    c, state, now = config(), read('request.json', {}), time.time()
    health = read('health.json', {})
    live = now - health.get('updated', 0) < 75
    end = window(c, state, now)
    active = live and end and health.get('until', 0) > now
    output('WACHHALTEN & APPS')
    output(f'Status          {"AKTIV" if active else ("STARTET" if end else "AUS")}')
    output('Mac-Ruhezustand ' +
           ('BLOCKIERT' if active and health.get('awake') else 'nicht durch VibeCode blockiert'))
    enabled, next_switch = timer_phase(c, now)
    if next_switch:
        next_mode = 'AUS' if enabled else 'AN'
        output(f'Timer           {next_mode} am {stamp(next_switch)}')
    cycle = c['cycle']
    if cycle:
        on_minutes = cycle['on_seconds'] // 60
        off_minutes = cycle['off_seconds'] // 60
        output(f'Automatik       AN {on_minutes} min · AUS {off_minutes} min')
    for app in c['apps']:
        output(f'{platform_label(app):<31}{"LÄUFT" if platform_running(app) else "AUS"}')
    if not c['apps']:
        output('Plattformen     keine')
    if live and health.get('error'):
        output(f'Fehler          {health["error"]}')


# The SSH target lives separately from the wake/app settings.
SSH_FILE = 'ssh.json'
# Neither pattern may start with "-": the values end up as ssh arguments and
# must never be readable as an option such as -oProxyCommand=...
SSH_HOST = re.compile(r'[A-Za-z0-9][A-Za-z0-9._:-]*')
SSH_USER = re.compile(r'[A-Za-z0-9_][A-Za-z0-9._-]*')
SSH_SETUP_HINT = 'Einmalig einrichten: workspace remote ssh join benutzer@host'
SSH_DIR = Path.home() / '.ssh'
# A key line is accepted only if it STARTS with a key type. authorized_keys lines may
# begin with options such as command="...", which must never be smuggled in.
KEY_LINE = re.compile(r'(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)) '
                      r'([A-Za-z0-9+/]+={0,2})(?: ([^\x00-\x1f\x7f]{1,200}))?')
FINGERPRINT = re.compile(r'SHA256:[A-Za-z0-9+/]{43}')
SHARING_PANE = 'x-apple.systempreferences:com.apple.Sharing-Settings.extension'
JOIN_USAGE = 'Aufruf: workspace remote ssh join benutzer@host [SHA256:…] [port]'


def ssh_target(value, port=22):
    """Validate "[benutzer@]host" plus port; reject anything ssh could parse as an option."""
    user, at, host = value.rpartition('@')
    # An "@" with nothing before it is a typo, not "current user".
    if not SSH_HOST.fullmatch(host) or (at and not SSH_USER.fullmatch(user)):
        raise ValueError('SSH-Ziel muss benutzer@host sein, z. B. user@remote-mac.local')
    if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
        raise ValueError('SSH-Port: Zahl von 1 bis 65535.')
    return {'user': user, 'host': host, 'port': port}


def saved_ssh_target():
    saved = read(SSH_FILE)
    if saved is None:
        raise ValueError('Kein SSH-Ziel gespeichert. ' + SSH_SETUP_HINT)
    # Corrupt data is rejected, never defaulted: a silent fallback would connect elsewhere.
    if not isinstance(saved, dict) or not all(
            isinstance(saved.get(key, ''), str) for key in ('user', 'host')):
        raise ValueError(SSH_FILE + ' ist ungültig. ' + SSH_SETUP_HINT)
    user, host = saved.get('user', ''), saved.get('host', '')
    return ssh_target(f'{user}@{host}' if user else host, saved.get('port', 22))


def ssh_destination(target):
    return f'{target["user"]}@{target["host"]}' if target['user'] else target['host']


def ssh_command(target, remote=None):
    """Interactive login, or with `remote` a non-interactive one-shot command.

    BatchMode makes the one-shot variant fail immediately instead of waiting for a
    password or host-key prompt nobody can answer (agents have no terminal).
    """
    command = ['/usr/bin/ssh', '-p', str(target['port']),
               '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=30']
    if remote is not None:
        command += ['-o', 'BatchMode=yes']
    command.append(ssh_destination(target))
    return command + [remote] if remote is not None else command


def ssh_set(args):
    if not args or len(args) > 2:
        raise ValueError('Aufruf: workspace remote ssh set benutzer@host [port]')
    try:
        port = int(args[1]) if len(args) == 2 else 22
    except ValueError:
        raise ValueError('SSH-Port: Zahl von 1 bis 65535.') from None
    target = ssh_target(args[0], port)
    write(SSH_FILE, target)
    print(f'SSH-Ziel gespeichert: {ssh_command(target)[-1]} (Port {port})')
    print('Verbinden mit: workspace remote ssh')


def unreachable_reason(host, port, timeout=5):
    """None if host:port accepts a connection, otherwise a short reason.

    Probed with Apple's nc, not with Python's socket: the python.org Python cannot resolve .local (Bonjour) names on some Macs
    ("[Errno 8] nodename nor servname provided") although ssh, which comes next, resolves and connects without trouble. nc
    resolves like ssh does, so "not reachable" now means what it says."""
    try:
        result = subprocess.run(['/usr/bin/nc', '-z', '-G', str(timeout), '--', host, str(port)],
                                capture_output=True, text=True, timeout=timeout + 10)
    except (OSError, subprocess.SubprocessError) as exc:
        return str(exc) or exc.__class__.__name__
    if result.returncode == 0:
        return None
    lines = (result.stderr or result.stdout).strip().splitlines()
    # Ein Zeitablauf meldet nc mit -z gar nichts.
    return re.sub(r'^nc: ', '', lines[-1]) if lines else f'keine Antwort innerhalb von {timeout} Sekunden'


def ssh_require_reachable(target):
    # A sleeping or unreachable Mac would otherwise just hang for a while.
    reason = unreachable_reason(target['host'], target['port'])
    if reason is None:
        return
    unknown_name = 'nodename nor servname' in reason or 'not known' in reason
    raise ValueError(
        f'{target["host"]}:{target["port"]} nicht erreichbar ({reason}). Prüfen: Remote-Mac '
        'an und wach (dort: workspace remote on), Entfernte Anmeldung aktiv (dort: '
        'workspace remote ssh info), gleiches Netz bzw. Tailscale läuft.' +
        (' Der Name wird nicht gefunden: sind beide Macs im selben Netz? Unterwegs hilft Tailscale auf beiden Macs: '
         'als Host dann den Tailscale-Namen oder die 100.x-Adresse des Remote-Macs verwenden.' if unknown_name else ''))


def ssh_connect(remote=None):
    """exec ssh: interactive login, or one non-interactive command when `remote` is given."""
    target = saved_ssh_target()
    command = ssh_command(target, remote)
    ssh_require_reachable(target)
    # exec hands the terminal, stdin/stdout and the exit status straight to ssh.
    os.execv(command[0], command)


def ssh_pair():
    """Install this Mac's public key on the target. Needs the target's password: a human step."""
    target = saved_ssh_target()
    ssh_require_reachable(target)
    command = ['/usr/bin/ssh-copy-id', '-p', str(target['port']), ssh_destination(target)]
    os.execv(command[0], command)


def summary():
    """One status line for the VibeCode window: {"text", "level"}."""
    active = wake_active()
    apps = ', '.join(config()['apps']) or 'keine Apps gewählt'
    print(json.dumps({'text': f'Wachhalten {"AN" if active else "AUS"} · Apps: {apps}',
                      'level': 'ok' if active else 'off'}, ensure_ascii=False))


def wake_state():
    """Requested mode separately from controller health, so a failed start can still be switched off."""
    c = config()
    enabled = bool(window(c, read('request.json', {}), time.time()))
    active = wake_active()
    apps = ', '.join(c['apps']) or 'keine Apps gewählt'
    text = f'Wachhalten {"AN" if enabled else "AUS"} · Apps: {apps}'
    if enabled and not active:
        text += ' · Controller startet oder ist nicht erreichbar'
    print(json.dumps({'enabled': enabled, 'active': active, 'text': text,
                      'level': 'warn' if enabled and not active else 'ok' if enabled else 'off'},
                     ensure_ascii=False))


def ssh_show():
    """The saved target as JSON ({"target": null} if none), for the VibeCode window."""
    target = saved_ssh_target() if read(SSH_FILE) is not None else None
    print(json.dumps({'target': target}))


def ssh_listening(port=22):
    try:
        socket.create_connection(('127.0.0.1', port), timeout=1).close()
        return True
    except OSError:
        return False


def wake_active():
    c, state, now = config(), read('request.json', {}), time.time()
    health = read('health.json', {})
    end = window(c, state, now)
    return bool(end and now - health.get('updated', 0) < 75 and health.get('until', 0) > now)


def host_fingerprint():
    """Fingerprint of THIS Mac's sshd host key; '' while sshd has not generated one yet."""
    found = FINGERPRINT.search(run(
        '/usr/bin/ssh-keygen', '-lf', '/etc/ssh/ssh_host_ed25519_key.pub', check=False).stdout)
    return found.group(0) if found else ''


def ssh_facts(waking=False):
    """What the other Mac needs to know about THIS Mac as an SSH target.

    {'listening': Remote Login on, 'awake': keep-awake on, 'fingerprint': sshd host key ('' if unreadable),
     'line': the join line for the other Mac ('' while Remote Login is off)}"""
    name = run('/usr/sbin/scutil', '--get', 'LocalHostName', check=False).stdout.strip()
    host = (name or socket.gethostname().split('.')[0]) + '.local'
    listening, awake = ssh_listening(), waking or wake_active()
    fingerprint = host_fingerprint() if listening else ''
    line = ' '.join(['workspace remote ssh join', f'{getpass.getuser()}@{host}'] +
                    ([fingerprint] if fingerprint else [])) if listening else ''
    return {'listening': listening, 'awake': awake, 'fingerprint': fingerprint, 'line': line}


def ssh_info(output=print, waking=False):
    """Status of THIS Mac as an SSH target (run on the remote Mac), as text. Returns the join line or ''."""
    facts = ssh_facts(waking)
    listening, awake = facts['listening'], facts['awake']
    output('SSH-ZUGANG DIESES MACS')
    output(f'Entfernte Anmeldung  {"AN (Port 22)" if listening else "AUS"}')
    output(f'Wachhalten           {"AN" if awake else "AUS (Mac kann einschlafen, dann ist SSH nicht erreichbar)"}')
    if not listening:
        output('Aktivieren: Systemeinstellungen → Allgemein → Teilen → Entfernte Anmeldung')
        output('            (oder im Terminal: sudo systemsetup -setremotelogin on)')
    if not awake:
        output('Wachhalten:  workspace remote ssh share --wake   (oder: workspace remote on)')
    if not listening:
        return ''
    if not facts['fingerprint']:
        output('Host-Schlüssel nicht lesbar: der andere Mac kann den Fingerprint nicht prüfen.')
    output('Auf dem anderen Mac ausführen:')
    output('  ' + facts['line'])
    return facts['line']


def clipboard(text):
    """Best effort, so Universal Clipboard can carry the line to the other Mac."""
    try:
        subprocess.run(['/usr/bin/pbcopy'], input=text, text=True, timeout=5, check=True)
        return True
    except (OSError, subprocess.SubprocessError):
        return False


def ssh_share(args):
    """Prepare THIS Mac to be reached over SSH and print the one line the other Mac needs.

    --wake keeps the Mac awake (like `workspace remote on`). --json prints the state as JSON for the VibeCode window instead of
    text. --no-open does not open System Settings again (the window's "check again")."""
    flags = set(args)
    if flags - {'--wake', '--json', '--no-open'} or len(flags) != len(args):
        raise ValueError('Aufruf: workspace remote ssh share [--wake] [--json] [--no-open]')
    waking = '--wake' in flags
    if waking:
        # Same switch as `workspace remote on`: it also starts the configured apps.
        activate()
    if '--json' in flags:
        facts = ssh_facts(waking)
        opened = copied = False
        if not facts['listening']:
            if '--no-open' not in flags:
                run('/usr/bin/open', SHARING_PANE, check=False)
                opened = True
        else:
            copied = clipboard(facts['line'])
        print(json.dumps({'remoteLogin': facts['listening'], 'awake': facts['awake'], 'line': facts['line'],
                          'fingerprint': bool(facts['fingerprint']), 'copied': copied, 'settingsOpened': opened},
                         ensure_ascii=False))
        return
    line = ssh_info(print, waking)
    if not line:
        if '--no-open' not in flags:
            run('/usr/bin/open', SHARING_PANE, check=False)
            print('Systemeinstellungen geöffnet. „Entfernte Anmeldung“ einschalten, dann diesen Befehl wiederholen.')
    elif clipboard(line):
        print('(in die Zwischenablage kopiert)')


def keygen_fingerprint(key):
    """SHA256 fingerprint of a "type base64" public key; ValueError if it is not one."""
    result = subprocess.run(['/usr/bin/ssh-keygen', '-lf', '-'], input=key + '\n',
                            capture_output=True, text=True, timeout=10)
    found = FINGERPRINT.search(result.stdout)
    if result.returncode or not found:
        raise ValueError('Das ist kein gültiger öffentlicher SSH-Schlüssel.')
    return found.group(0)


def checked_public_key(text):
    """Validate exactly one public-key line. Returns (canonical line, fingerprint)."""
    match = KEY_LINE.fullmatch(text.strip())
    if not match:
        raise ValueError('Erwartet wird genau eine Zeile: ssh-ed25519 AAAA… name')
    kind, blob, comment = match.groups()
    return ' '.join(part for part in (kind, blob, comment) if part), keygen_fingerprint(f'{kind} {blob}')


def append_line(path, line):
    """Append one line to a file in ~/.ssh with owner-only permissions."""
    path.parent.mkdir(mode=0o700, exist_ok=True)
    existing = path.read_bytes() if path.exists() else b''
    separator = b'' if not existing or existing.endswith(b'\n') else b'\n'
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600), 'ab') as f:
        f.write(separator + line.encode() + b'\n')


def own_public_key():
    for name in ('id_ed25519', 'id_ecdsa', 'id_rsa'):
        path = SSH_DIR / (name + '.pub')
        if path.is_file():
            return (path,) + checked_public_key(path.read_text())
    raise ValueError('Kein SSH-Schlüssel gefunden. Erzeugen: ssh-keygen -t ed25519')


def ssh_allow(args):
    """Authorize ONE public key on THIS Mac (run on the remote Mac). Shows the fingerprint first."""
    key, fingerprint = checked_public_key(' '.join(arg for arg in args if arg not in ('--yes', '--check')))
    path = SSH_DIR / 'authorized_keys'
    blob = key.split()[1]
    known = path.exists() and any(blob in line.split() for line in path.read_text().splitlines())
    name = key.split(' ', 2)[2] if key.count(' ') >= 2 else '(ohne Name)'
    if '--check' in args:
        # Für das Hauptfenster: Name und Fingerprint zum Bestätigen zeigen, nichts schreiben.
        print(json.dumps({'name': name, 'fingerprint': fingerprint, 'known': known}, ensure_ascii=False))
        return
    if known:
        print(f'Schon freigegeben: {fingerprint}')
        return
    print(f'Zugriff auf diesen Mac für: {name}\nFingerprint: {fingerprint}')
    if '--yes' not in args:
        if not sys.stdin.isatty():
            raise ValueError('Bestätigung nötig: Fingerprint dem Besitzer zeigen, dann mit --yes wiederholen.')
        if input('Diesem Schlüssel Zugriff geben? [j/N] ').strip().lower() not in ('j', 'ja', 'y', 'yes'):
            raise ValueError('Abgebrochen, nichts geändert.')
    append_line(path, key)
    print('Freigegeben. Auf dem anderen Mac jetzt: workspace remote ssh join')


def pin_host_key(target, fingerprint):
    """Trust the target's host key only if it matches the fingerprint the target itself printed."""
    spec = target['host'] if target['port'] == 22 else f'[{target["host"]}]:{target["port"]}'
    if run('/usr/bin/ssh-keygen', '-F', spec, check=False).returncode == 0:
        return  # already known; ssh itself refuses a changed key
    scan = run('/usr/bin/ssh-keyscan', '-T', '5', '-p', str(target['port']),
               '-t', 'ed25519', target['host'], check=False).stdout
    entry = next((line for line in scan.splitlines() if line.strip() and not line.startswith('#')), '')
    fields = entry.split()
    if len(fields) < 3:
        raise ValueError(f'Host-Schlüssel von {target["host"]} konnte nicht gelesen werden.')
    if keygen_fingerprint(' '.join(fields[1:3])) != fingerprint:
        raise ValueError(
            f'Der Host-Schlüssel von {target["host"]} stimmt NICHT mit dem Fingerprint überein, den '
            'der Remote-Mac angezeigt hat. Nicht verbinden: falscher Rechner oder jemand dazwischen.')
    append_line(SSH_DIR / 'known_hosts', entry)


def ssh_join(args):
    """Run on the Mac that wants access: pin the host key, save the target, check the login.

    Exit 0 = connected, 1 = error, 2 = the other Mac still has to run `ssh allow`.
    """
    fingerprint, port = '', 22
    for extra in args[1:]:
        if FINGERPRINT.fullmatch(extra):
            fingerprint = extra
        elif re.fullmatch(r'[0-9]{1,5}', extra):
            port = int(extra)
        else:
            raise ValueError(JOIN_USAGE)
    target = ssh_target(args[0], port) if args else saved_ssh_target()
    ssh_require_reachable(target)
    if args:
        if fingerprint:
            pin_host_key(target, fingerprint)
        write(SSH_FILE, target)
    probe = subprocess.run(ssh_command(target, 'true'), capture_output=True, text=True, timeout=30)
    if probe.returncode == 0:
        print(f'✔ Verbunden mit {ssh_destination(target)}. Befehle: workspace remote ssh run -- <befehl>')
        return
    if 'Host key verification failed' in probe.stderr:
        raise ValueError('Host-Schlüssel unbekannt oder geändert. Auf dem Remote-Mac `workspace remote '
                         'ssh share` ausführen und den ganzen join-Befehl mit Fingerprint verwenden.')
    if 'Permission denied' not in probe.stderr:
        raise ValueError('Verbindung fehlgeschlagen: ' +
                         (probe.stderr.strip().splitlines() or [f'Exit {probe.returncode}'])[-1])
    path, key, fingerprint = own_public_key()
    line = f'workspace remote ssh allow {shlex.quote(key)}'
    copied = clipboard(line)
    print('Noch nicht freigegeben. Auf dem Remote-Mac ausführen' +
          (' (in der Zwischenablage):' if copied else ':'))
    print('  ' + line)
    print(f'Fingerprint dieses Schlüssels: {fingerprint}')
    print('Danach hier: workspace remote ssh join')
    print(f'Hilft das nicht, hat der Schlüssel eine Passphrase und ist nicht im ssh-agent: '
          f'ssh-add --apple-use-keychain {str(path)[:-4]}')
    raise SystemExit(2)


def control_running():
    """True while another interactive control terminal owns the menu lock."""
    BASE.mkdir(parents=True, exist_ok=True)
    with (BASE / 'control.lock').open('a+') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return True
        fcntl.flock(lock, fcntl.LOCK_UN)
        return False


def terminal():
    if control_running():
        return
    command = 'exec ' + shlex.join([sys.executable, str(ROOT / 'remote.py'), 'control'])
    run('/usr/bin/osascript', '-e', 'on run argv', '-e',
        'tell application "Terminal" to do script (item 1 of argv)', '-e',
        'end run', command)


def repeat_settings():
    p = Path('/Library/Preferences/SystemConfiguration/com.apple.AutoWake.plist')
    if not p.exists():
        return {}
    with p.open('rb') as f:
        data = plistlib.load(f)
    return {k: v for k, v in data.items() if k.startswith('Repeating')}


def wake_plan(c, remove=False):
    current = repeat_settings()
    owned = read('wake.json')
    # pmset repeat is a global pair of events. Never overwrite someone else's.
    if current and current != owned:
        raise ValueError('Fremder/geänderter wiederkehrender pmset-Plan vorhanden. Keine Änderung vorgenommen.')
    if remove or not (c['enabled'] and c['wake_mac']):
        if owned and current == owned:
            subprocess.run(['sudo', '/usr/bin/pmset', 'repeat', 'cancel'], check=True)
        (BASE / 'wake.json').unlink(missing_ok=True)
        return
    days = ''.join(letter for day, letter in zip(DAYS, 'MTWRFSU') if day in c['days'])
    subprocess.run(['sudo', '/usr/bin/pmset', 'repeat', 'wakeorpoweron', days, c['start'] + ':00'], check=True)
    saved = repeat_settings()
    if not saved:
        raise ValueError('pmset-Wake-Plan konnte nicht verifiziert werden.')
    write('wake.json', saved)


def install(schedule=False, *, only_if_loaded=False):
    domain = 'gui/' + str(os.getuid())
    target = domain + '/' + LABEL
    loaded = run('/bin/launchctl', 'print', target, check=False).returncode == 0
    if only_if_loaded and not loaded:
        return
    c = config()
    BASE.mkdir(parents=True, exist_ok=True)
    if not (BASE / 'config.json').exists():
        save_settings()
    if schedule:
        wake_plan(c)
        state = read('request.json', {})
        state['disabled'] = False
        write('request.json', state)
    if loaded:
        if read('health.json', {}).get('version') != CONTROLLER_VERSION:
            run('/bin/launchctl', 'kickstart', '-k', target)
        return
    PLIST.parent.mkdir(parents=True, exist_ok=True)
    payload = {'Label': LABEL, 'ProgramArguments': [sys.executable, str(ROOT / 'remote.py'), 'controller'],
               'RunAtLoad': True, 'KeepAlive': True, 'ThrottleInterval': 10,
               'StandardOutPath': str(BASE / 'controller.log'),
               'StandardErrorPath': str(BASE / 'controller.log'),
               'EnvironmentVariables': {
                   'PATH': '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
                   'VIBECODE_REMOTE_DIR': str(BASE),
               }}
    PLIST.write_bytes(plistlib.dumps(payload))
    run('/bin/launchctl', 'bootstrap', domain, str(PLIST))


def stop(disable=False):
    c, now = config(), time.time()
    # A stop skips the current scheduled slot; it must not restart next tick.
    ends = [end for start, end in slots(c, now) if start <= now < end]
    write('request.json', {'manual_on': False, 'manual_until': 0,
                           'skip_until': max(ends, default=0), 'disabled': disable})


def save_settings(**changes):
    """Persist one snapshot of the mode, timer and app settings."""
    BASE.mkdir(parents=True, exist_ok=True)
    with (BASE / 'settings.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        c = config()
        if 'switch_at' not in c:
            state = read('request.json', {})
            changes.setdefault('keep_awake', bool(window(c, state, time.time())))
            changes.setdefault('switch_at', 0)
        if changes or not simple_config():
            c = config(changes)
            write('config.json', {key: c[key] for key in WAKE_SETTINGS})
        return c


def activate():
    """Enable indefinite wake/app mode until the user explicitly turns it off."""
    install()
    save_settings(keep_awake=True, switch_at=0, cycle=None)


def deactivate():
    """Turn off wake mode and let the controller apply the app preference."""
    return save_settings(keep_awake=False, switch_at=0, cycle=None)


def set_timer(enabled, seconds):
    install()
    save_settings(keep_awake=enabled, switch_at=math.ceil(time.time()) + seconds, cycle=None)


def start_cycle(on_seconds, off_seconds):
    install()
    now = time.time()
    enabled = bool(window(config(), read('request.json', {}), now))
    first_duration = on_seconds if enabled else off_seconds
    save_settings(keep_awake=enabled, switch_at=math.ceil(now) + first_duration,
                  cycle={'on_seconds': on_seconds, 'off_seconds': off_seconds})


def read_duration(input_fn, prompt):
    raw = input_fn(prompt).strip().lower()
    if not raw:
        return None
    if re.fullmatch(r'[0-9]+', raw):
        raw += 'h'
    return duration(raw, max_seconds=None)


def setting(value):
    return 'AN' if value else 'AUS'


def clear_screen(output):
    if sys.stdout.isatty():
        output('\033[2J\033[H')


def platforms_menu(input_fn, output):
    while True:
        c = config()
        output('')
        output('PLATTFORMEN / APPS')
        output('Bei AN werden diese Apps vollständig geöffnet und überwacht.')
        for index, name in enumerate(PLATFORM_PRESETS, 1):
            marker = 'x' if name in c['apps'] else ' '
            label = platform_label(name)
            output(f'  [{index}] [{marker}] {label}')
        custom = [name for name in c['apps'] if name not in PLATFORM_PRESETS]
        output(f'  [e] Eigene App-Liste: {", ".join(custom) if custom else "keine"}')
        output('  [0] Keine App auswählen')
        output('  [b] Zurück')
        answer = input_fn('Auswahl zum Umschalten: ').strip().lower()
        if answer in ('b', ''):
            return
        if answer == '0':
            save_settings(apps=[])
            continue
        if answer == 'e':
            raw = input_fn(
                'Alle App-Namen, Komma-getrennt ("-" = keine, Enter = unverändert): '
            ).strip()
            if not raw:
                continue
            names = [] if raw == '-' else [name.strip() for name in raw.split(',') if name.strip()]
            # Preserve the entered order while avoiding duplicate app launches.
            save_settings(apps=list(dict.fromkeys(names)))
            continue
        if answer.isdigit() and 1 <= int(answer) <= len(PLATFORM_PRESETS):
            name = PLATFORM_PRESETS[int(answer) - 1]
            apps = list(c['apps'])
            if name in apps:
                apps.remove(name)
            else:
                apps.append(name)
            save_settings(apps=apps)
            continue
        output('Ungültige Auswahl.')


def control_loop(input_fn=input, output=print):
    while True:
        clear_screen(output)
        output('VIBECODE KONTROLLTERMINAL')
        output('═' * 55)
        status(output)
        c = config()
        now = time.time()
        active = bool(window(c, read('request.json', {}), now))
        _, next_switch = timer_phase(c, now)
        output('')
        output(f'Wachhalten + Apps  {setting(active)}')
        output(f'Ausgewählte Apps   {", ".join(c["apps"]) if c["apps"] else "keine"}')
        output('')
        output(f'  [1] Wachhalten + Apps {"AUSSCHALTEN" if active else "EINSCHALTEN"}')
        output('  [2] Apps auswählen')
        output(f'  [3] Apps bei AUS schließen ({"JA" if c["close_apps_on_off"] else "NEIN"})')
        output('  [4] AN für eine bestimmte Zeit, dann AUS')
        output('  [5] AUS für eine bestimmte Zeit, dann wieder AN')
        if next_switch:
            output('  [6] Timer aufheben und aktuellen Zustand behalten')
        output('  [7] Automatischen Wechsel zwischen AN und AUS einstellen')
        output('  [s] Status aktualisieren')
        output('  [q] Kontrollterminal schließen')
        try:
            answer = input_fn('Auswahl: ').strip().lower()
            if answer == '1':
                if active:
                    deactivate()
                else:
                    activate()
            elif answer == '2':
                platforms_menu(input_fn, output)
            elif answer == '3':
                save_settings(close_apps_on_off=not c['close_apps_on_off'])
            elif answer in ('4', '5'):
                if answer == '5':
                    output('Schläft der Mac beim Ablauf, schaltet VibeCode beim Aufwachen wieder ein.')
                seconds = read_duration(input_fn, 'Dauer in Stunden oder z. B. 90m (Enter bricht ab): ')
                if seconds is not None:
                    set_timer(answer == '4', seconds)
            elif answer == '6' and next_switch:
                current = config()
                enabled = bool(window(current, read('request.json', {}), time.time()))
                save_settings(keep_awake=enabled, switch_at=0, cycle=None)
            elif answer == '7':
                on_seconds = read_duration(input_fn, 'Dauer für AN in Stunden oder z. B. 90m (Enter bricht ab): ')
                if on_seconds is not None:
                    off_seconds = read_duration(input_fn, 'Dauer für AUS (Enter übernimmt die AN-Dauer): ')
                    start_cycle(on_seconds, off_seconds or on_seconds)
            elif answer == 'q':
                return
            elif answer not in ('s', ''):
                raise ValueError('Ungültige Auswahl.')
        except (EOFError, KeyboardInterrupt):
            output('')
            return
        except (ValueError, OSError, subprocess.SubprocessError) as exc:
            output(f'Fehler: {exc}')
            try:
                input_fn('Weiter mit Enter ...')
            except (EOFError, KeyboardInterrupt):
                return


def control(input_fn=input, output=print):
    BASE.mkdir(parents=True, exist_ok=True)
    with (BASE / 'control.lock').open('a+') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            output('Das VibeCode-Kontrollterminal ist bereits geöffnet.')
            return
        try:
            install(only_if_loaded=True)
            save_settings()
            control_loop(input_fn, output)
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def controller():
    BASE.mkdir(parents=True, exist_ok=True)
    with (BASE / 'controller.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        alive = True
        def terminate(*_):
            nonlocal alive
            alive = False
        signal.signal(signal.SIGTERM, terminate)
        signal.signal(signal.SIGINT, terminate)
        coffee, previous, last_check, coffee_key = None, 0, 0, None
        active_platforms = ()
        managed_apps = saved_managed_apps()
        terminal_handles = cli_handles()
        service_error = ''
        close_apps_on_off = True
        def release():
            nonlocal coffee, coffee_key
            if coffee and coffee.poll() is None:
                coffee.terminate()
                coffee.wait(timeout=5)
            coffee = None
            coffee_key = None

        def close_managed_platforms():
            if managed_apps:
                quit_apps(sorted(managed_apps))
                managed_apps.clear()
                save_managed_apps(managed_apps)
            for platform, handle in list(terminal_handles.items()):
                close_cli_platform(handle)
                del terminal_handles[platform]
                save_cli_handles(terminal_handles)

        try:
            write('health.json', {'version': CONTROLLER_VERSION})
            while alive:
                error, end = '', 0
                try:
                    c, state, now = config(), read('request.json', {}), time.time()
                    close_apps_on_off = c['close_apps_on_off']
                    end = window(c, state, now)
                    if end:
                        wanted_coffee = ('manual',) if end == MANUAL_END else ('until', end)
                        if not coffee or coffee.poll() is not None or coffee_key != wanted_coffee:
                            release()
                            command = ['/usr/bin/caffeinate', '-is']
                            if wanted_coffee[0] == 'until':
                                command += ['-t', str(max(1, math.ceil(end - now)))]
                            command += ['-w', str(os.getpid())]
                            coffee = subprocess.Popen(command)
                            coffee_key = wanted_coffee

                        configured_platforms = tuple(c['apps'])
                        removed_platforms = set(active_platforms) - set(configured_platforms)
                        configured_apps = set(configured_platforms) - set(CLI_PLATFORMS)
                        removed_apps = ((removed_platforms - set(CLI_PLATFORMS)) |
                                        (managed_apps - configured_apps))
                        if removed_apps:
                            quit_apps(sorted(removed_apps))
                            managed_apps.difference_update(removed_apps)
                            save_managed_apps(managed_apps)
                        handles_changed = False
                        removed_cli = ((removed_platforms & set(CLI_PLATFORMS)) |
                                       (set(terminal_handles) - set(configured_platforms)))
                        for platform in removed_cli:
                            handle = terminal_handles.pop(platform, None)
                            if handle:
                                close_cli_platform(handle)
                                handles_changed = True
                        if handles_changed:
                            save_cli_handles(terminal_handles)

                        platforms_changed = configured_platforms != active_platforms
                        active_platforms = configured_platforms
                        previous_managed_apps = set(managed_apps)
                        managed_apps.update(configured_apps)
                        if managed_apps != previous_managed_apps:
                            save_managed_apps(managed_apps)
                        if not previous or platforms_changed or now - last_check >= 60:
                            last_check = now
                            errors = []
                            for platform in active_platforms:
                                try:
                                    if platform in CLI_PLATFORMS:
                                        handle = terminal_handles.get(platform)
                                        if not handle or not cli_handle_alive(handle):
                                            if handle:
                                                close_cli_platform(handle)
                                            terminal_handles[platform] = launch_cli_platform(platform)
                                            save_cli_handles(terminal_handles)
                                    elif not app_running(platform):
                                        run('/usr/bin/open', '-g', '-a', platform)
                                except Exception as exc:
                                    errors.append(f'{platform}: {exc}')
                            service_error = '; '.join(errors)
                        if not previous:
                            # Mark the transition before UI side effects to avoid duplicate windows on errors.
                            previous = end
                            if c['open_control_terminal'] and not c.get('switch_at'):
                                try:
                                    terminal()
                                except Exception as exc:
                                    service_error += ' ' + str(exc)
                            if c['open_workspace']:
                                env = dict(os.environ, VIBE_REMOTE_TERMINALS=str(c['open_terminals']).lower())
                                with (BASE / 'workspace.log').open('a') as log:
                                    subprocess.Popen([str(ROOT / 'VibeCode Workspace.command'), '--remote-workspace'],
                                                     env=env, stdout=log, stderr=log)
                        previous = end
                        error = service_error
                    else:
                        release()
                        previous = 0
                        active_platforms = ()
                        service_error = ''
                        if close_apps_on_off:
                            close_managed_platforms()
                except Exception as exc:
                    error = str(exc)
                    # Invalid config releases our assertion; normal app errors retain the bounded window.
                    if not end:
                        release()
                        previous = 0
                    else:
                        previous = end
                write('health.json', {'version': CONTROLLER_VERSION, 'updated': time.time(), 'until': end,
                                     'awake': coffee is not None and coffee.poll() is None, 'error': error})
                time.sleep(2)
        finally:
            release()
            if close_apps_on_off:
                close_managed_platforms()
            write('health.json', {'version': CONTROLLER_VERSION, 'updated': time.time(),
                                 'until': 0, 'awake': False})


def main(args):
    cmd = args[0] if args else 'control'
    if cmd == '_cli_host':
        if (len(args) != 3 or re.fullmatch(r'[0-9a-f]{32}', args[1]) is None or
                not Path(args[2]).is_file() or not os.access(args[2], os.X_OK)):
            raise ValueError('Ungültiger interner CLI-Start.')
        # Preserve failures so the shared terminal wrapper can keep their diagnosis visible.
        raise SystemExit(subprocess.call([args[2]]))
    elif cmd == 'controller':
        controller()
    elif cmd == 'status':
        status()
    elif cmd in ('menu', 'control', 'config'):
        control()
    elif cmd == 'on':
        activate()
        time.sleep(2.2)
        status()
    elif cmd == 'install':
        install()
        print('Remote-Controller installiert. Einstellungen:', BASE / 'config.json')
    elif cmd == 'ssh':
        sub = args[1] if len(args) > 1 else 'connect'
        if sub == 'connect' and len(args) <= 2:
            ssh_connect()
        elif sub == 'run':
            words = args[2:]
            if words[:1] == ['--']:
                words = words[1:]
            if not ' '.join(words).strip():
                raise ValueError('Aufruf: workspace remote ssh run -- <befehl>')
            ssh_connect(' '.join(words))
        elif sub == 'pair' and len(args) == 2:
            ssh_pair()
        elif sub == 'share':
            ssh_share(args[2:])
        elif sub == 'join':
            ssh_join(args[2:])
        elif sub == 'allow':
            ssh_allow(args[2:])
        elif sub == 'show':
            ssh_show()
        elif sub == 'set':
            ssh_set(args[2:])
        elif sub == 'info':
            ssh_info()
        else:
            raise ValueError('ssh-Befehle: ssh share [--wake] | ssh join benutzer@host [SHA256:…] | '
                             'ssh allow \'<schlüssel>\' | ssh run -- <befehl> | ssh | ssh pair | '
                             'ssh set benutzer@host [port] | ssh info')
    elif cmd == 'summary':
        summary()
    elif cmd == 'wake-state':
        wake_state()
    elif cmd == 'off':
        c = deactivate()
        apps_action = 'werden beendet' if c['close_apps_on_off'] else 'bleiben geöffnet'
        print(f'AUS. Wachhaltesperre gelöst. Ausgewählte Apps {apps_action}.')
    elif cmd == 'uninstall':
        stop(disable=True)
        deactivate()
        wake_plan(config(), remove=True)
        run('/bin/launchctl', 'bootout', 'gui/' + str(os.getuid()) + '/' + LABEL, check=False)
        PLIST.unlink(missing_ok=True)
        print('Remote-Dienst entfernt. Konfiguration bleibt erhalten.')
    else:
        raise ValueError('Befehle: control | on | off | status | ssh | install | uninstall')


if __name__ == '__main__':
    helper_dir = ROOT.parent / 'core'
    if (helper_dir / 'terminal_session.py').is_file():
        sys.path.insert(0, str(helper_dir))
        from terminal_session import wrap_if_needed
        wrap_if_needed([sys.executable, str(ROOT / 'remote.py')] + sys.argv[1:])
    try:
        main(sys.argv[1:])
    except (ValueError, OSError, subprocess.SubprocessError) as exc:
        print('Remote: ' + str(exc), file=sys.stderr)
        sys.exit(1)
