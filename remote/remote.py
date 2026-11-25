#!/usr/bin/env python3
"""Persistent macOS wake/app control terminal. No third-party packages required."""
import datetime as dt
import fcntl
import getpass
import ipaddress
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


# --- Tailscale ---------------------------------------------------------------------------------------------------
# `<name>.local` (Bonjour) only exists in the same network. While Tailscale runs, the join line carries the tailnet host instead,
# which also works away from home (and at home). Only the existing sshd + pinned host key flow is used, never `tailscale ssh`.
TAILSCALE_CLIS = ('/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/opt/homebrew/bin/tailscale', '/usr/local/bin/tailscale')
TAILNET_ADDRESSES = ipaddress.ip_network('100.64.0.0/10')


def tailscale_cli():
    """Path of the Tailscale CLI or None. VIBECODE_TAILSCALE replaces the search (tests, unusual installs); empty means none."""
    override = os.environ.get('VIBECODE_TAILSCALE')
    candidates = [override] if override is not None else [shutil.which('tailscale'), *TAILSCALE_CLIS]
    return next((c for c in candidates if c and Path(c).is_file() and os.access(c, os.X_OK)), None)


def ipv4(value):
    try:
        return str(ipaddress.IPv4Address(value))
    except ValueError:
        return ''


def tailnet_node(node):
    """(DNS name without the trailing dot, first IPv4) of a node from `tailscale status --json`; '' for anything unusable.
    IPv6 is ignored on purpose: host names may not contain ':' here."""
    name = node.get('DNSName')
    name = name.rstrip('.') if isinstance(name, str) else ''
    if not SSH_HOST.fullmatch(name) or ':' in name:
        name = ''
    addresses = node.get('TailscaleIPs')
    return name, next((ip for ip in map(ipv4, addresses if isinstance(addresses, list) else []) if ip), '')


def tailscale_query():
    """(info, data, problem) from `tailscale status --json`. Never raises.

    `info` is what tailscale_state() returns, `data` the parsed status object ({} if unreadable) and `problem` is '' or
    'denied' (the daemon refuses this user: the operator is not set, see TAILSCALE_SETUP) or 'daemon' (no answer: not running)."""
    info = {'cli': tailscale_cli(), 'state': '', 'magic': False, 'name': '', 'ip': '', 'peers': []}
    if not info['cli']:
        return info, {}, ''
    try:
        # TAILSCALE_BE_CLI: the App Store build is the GUI app itself and would otherwise start it instead of answering.
        result = subprocess.run([info['cli'], 'status', '--json'], capture_output=True, text=True, timeout=4,
                                env={**os.environ, 'TAILSCALE_BE_CLI': '1'})
    except (OSError, subprocess.SubprocessError):
        return info, {}, 'daemon'
    try:
        data = json.loads(result.stdout)
    except ValueError:
        data = None
    if not isinstance(data, dict):
        text = (result.stderr + result.stdout).lower()
        return info, {}, 'denied' if 'access denied' in text or 'permission denied' in text else 'daemon'
    state, tailnet, me, peers = (data.get('BackendState'), data.get('CurrentTailnet'), data.get('Self'), data.get('Peer'))
    info['state'] = state if isinstance(state, str) else ''
    info['magic'] = isinstance(tailnet, dict) and tailnet.get('MagicDNSEnabled') is True
    if isinstance(me, dict):
        info['name'], info['ip'] = tailnet_node(me)
    for peer in peers.values() if isinstance(peers, dict) else []:
        if isinstance(peer, dict):
            name, ip = tailnet_node(peer)
            names = [name.lower(), name.split('.')[0].lower()] if name else []
            info['peers'].append({'names': names, 'ip': ip, 'online': peer.get('Online') is True})
    return info, data, ''


def tailscale_state():
    """What Tailscale on THIS Mac reports (see tailscale_query), without the details only the window needs.

    {'cli': path or None, 'state': BackendState ('' if unknown), 'magic': MagicDNS on, 'name': this Mac's tailnet name,
     'ip': its 100.x address, 'peers': [{'names': [lowercase full and short name], 'ip', 'online'}]}"""
    return tailscale_query()[0]


def tailscale_host(info):
    """The host other Macs use for THIS Mac over Tailscale, '' if it is not running. The tailnet name only when MagicDNS is
    on (it resolves nowhere else); otherwise the 100.x address, which resolves everywhere."""
    if info['state'] != 'Running':
        return ''
    return info['name'] if info['magic'] and info['name'] else info['ip']


def tailscale_kind(info):
    """'running', 'off' (installed, not connected) or 'missing'."""
    return 'running' if info['state'] == 'Running' else 'off' if info['cli'] else 'missing'


def tailscale_reason(host, unresolved=False):
    """Why a Tailscale host is not reachable, or '' when `host` is not one (then the usual hints apply).

    A host counts as Tailscale's if it ends in .ts.net, is a 100.64/10 address, or is a name Tailscale itself knows. A name without a
    dot that Tailscale does not know is just some SSH alias or LAN name: no Tailscale claim about it. `unresolved`: the name did not
    resolve on this Mac."""
    low = host.lower()
    try:
        address = ipaddress.IPv4Address(low) in TAILNET_ADDRESSES
    except ValueError:
        address = False
    tailnet_host = address or low.endswith('.ts.net')
    if not (tailnet_host or '.' not in low):
        return ''
    info = tailscale_state()
    named = next((p for p in info['peers'] if low in p['names']), None)
    peer = named or next((p for p in info['peers'] if low == p['ip']), None)
    if peer is None and not tailnet_host:
        return ''
    if not info['cli']:
        return 'Das Ziel ist ein Tailscale-Gerät, aber Tailscale ist auf diesem Mac nicht installiert.'
    if info['state'] != 'Running':
        return (f'Tailscale ist auf diesem Mac nicht verbunden{" (" + info["state"] + ")" if info["state"] else ""}: '
                'Tailscale in der Menüleiste öffnen, anmelden und verbinden.')
    if peer is None:
        return ('Tailscale kennt dieses Gerät in deinem Tailnet nicht. Name oder 100.x-Adresse prüfen (am Remote-Mac: '
                'workspace remote ssh share) und ob beide Macs im selben Tailscale-Konto angemeldet sind.')
    asleep = (' Außerdem ist der Remote-Mac im Tailnet offline, vermutlich im Ruhezustand: dort Wachhalten einschalten '
              '(workspace remote ssh share --wake).') if not peer['online'] else ''
    if unresolved and named is not None and peer['ip']:
        return (f'Tailscale kennt den Remote-Mac, aber der Name {host} lässt sich auf diesem Mac nicht auflösen (Tailscale-DNS ist hier '
                f'wohl nicht aktiv). Als Host die Adresse {peer["ip"]} eintragen (workspace remote ssh join benutzer@{peer["ip"]}).' + asleep)
    if not peer['online']:
        return ('Der Remote-Mac ist im Tailnet offline, vermutlich im Ruhezustand: dort Wachhalten einschalten '
                '(workspace remote ssh share --wake) und den Mac aufwecken.')
    return ('Tailscale verbindet beide Macs, aber der SSH-Port antwortet nicht: am Remote-Mac „Entfernte Anmeldung“ '
            'prüfen (workspace remote ssh share).')


# --- Tailscale steuern: Status, Verbinden, Anmelden, Geräte, „mit VibeCode starten und beenden“ ----------------------------------
# Never sudo, never `up` with flags (a flagless `up` just reconnects; flags on a configured node must all be repeated), never a
# disconnect that the user did not ask for or that VibeCode did not itself cause by starting Tailscale (the "ours" marker).
TAILSCALE_FILE = 'tailscale.json'            # {"version": 1, "auto": bool}; not config.json (simple_config() rewrites that one)
TAILSCALE_OURS = 'tailscale-ours.json'       # {"boot", "launched", "seen", "lastSeen"}: VibeCode turned Tailscale on
TAILSCALE_LOGIN = 'tailscale-login.json'     # {"pid"} of a login `up` that still waits for the browser
TAILSCALE_SESSIONS = 'tailscale-sessions'    # one heartbeat file per VS Code window VibeCode opened (written by the extension)
TAILSCALE_WATCH_LOCK = 'tailscale-watch.lock'
HEARTBEAT_FRESH = 45                          # seconds; the extension touches its file every 15
# The Homebrew daemon runs as root: without the operator setting a normal user is refused. Steps live in one place, the window's
# "Einrichten…" opens a Terminal with them (the password is typed there; VibeCode never runs sudo).
TAILSCALE_SETUP_HINT = ('Tailscale verweigert diesem Konto den Zugriff (der Dienst läuft als root). Einmal „Einrichten…“ ausführen: '
                        'das setzt `sudo tailscale set --operator="$USER"`.')
TAILSCALE_SETUP = r"""
set -u
BREW=""
for candidate in /opt/homebrew/bin/brew /usr/local/bin/brew; do
  [ -x "$candidate" ] && BREW="$candidate" && break
done
if [ -d /Applications/Tailscale.app ]; then
  echo "Die Tailscale-App ist installiert. Zwei Tailscale-Dienste auf einem Mac stören sich: nutze die App oder entferne sie zuerst."
  exit 1
fi
if [ -z "$BREW" ]; then
  echo "Homebrew fehlt. Installation: https://brew.sh  Danach „Einrichten…“ noch einmal wählen."
  exit 1
fi
"$BREW" list tailscale >/dev/null 2>&1 || "$BREW" install tailscale || exit 1
echo "Gleich fragt macOS nach deinem Passwort (sudo): der Tailscale-Dienst läuft als Systemdienst."
sudo "$BREW" services start tailscale || exit 1
TAILSCALE="$("$BREW" --prefix)/bin/tailscale"
for attempt in 1 2 3 4 5 6 7 8; do
  "$TAILSCALE" status >/dev/null 2>&1 && break
  sleep 1
done
sudo "$TAILSCALE" set --operator="$USER" || exit 1
echo
echo "Fertig. Im VibeCode-Fenster jetzt „Anmelden…“ wählen."
printf "Zum Schließen Enter drücken: "
read -r _
"""


def clean_text(value, limit=80):
    """Text from Tailscale that the window will show: control characters out, length capped."""
    return re.sub(r'[\x00-\x1f\x7f]', '', value)[:limit] if isinstance(value, str) else ''


def tailscale_variant(cli):
    return 'missing' if not cli else 'app' if str(cli).startswith('/Applications/Tailscale.app/') else 'cli'


def tailscale_settings():
    """{'auto': bool}. A corrupt file raises (never read as "off"), like every other file of ours."""
    try:
        saved = read(TAILSCALE_FILE)
    except ValueError:
        raise ValueError(f'{TAILSCALE_FILE} ist ungültig. Datei prüfen oder löschen.') from None
    if saved is None:
        return {'auto': False}
    if (not isinstance(saved, dict) or set(saved) - {'version', 'auto'} or saved.get('version', 1) != 1
            or type(saved.get('auto', False)) is not bool):
        raise ValueError(f'{TAILSCALE_FILE} ist ungültig. Datei prüfen oder löschen.')
    return {'auto': saved.get('auto', False)}


def tailscale_auto(args):
    if args not in (['on'], ['off']):
        raise ValueError('Aufruf: workspace remote tailscale auto on|off')
    settings = tailscale_settings()
    settings['auto'] = args == ['on']
    write(TAILSCALE_FILE, {'version': 1, 'auto': settings['auto']})
    print('Tailscale startet und endet jetzt mit VibeCode.' if settings['auto'] else 'Tailscale wird nicht mehr von VibeCode gestartet.')


def boot_id():
    return run('/usr/sbin/sysctl', '-n', 'kern.boottime', check=False).stdout.strip()


def tailscale_marker():
    """The "VibeCode turned Tailscale on" marker, or None. A marker from before a reboot is void: the daemon comes back with its
    old state by itself, and that would not be ours."""
    try:
        marker = read(TAILSCALE_OURS)
    except ValueError:
        marker = None
    if isinstance(marker, dict) and marker.get('boot') == boot_id() and isinstance(marker.get('launched'), (int, float)):
        return marker
    (BASE / TAILSCALE_OURS).unlink(missing_ok=True)
    return None


def clear_ours():
    (BASE / TAILSCALE_OURS).unlink(missing_ok=True)


def tailscale_devices(data):
    """Other devices of the tailnet for the window: online first, then by name. Every string is cleaned and capped."""
    peers = data.get('Peer')
    devices = []
    for peer in peers.values() if isinstance(peers, dict) else []:
        if not isinstance(peer, dict):
            continue
        name, ip = tailnet_node(peer)
        seen = clean_text(peer.get('LastSeen'), 40)
        devices.append({'name': clean_text(peer.get('HostName'), 60) or name.split('.')[0], 'dns': name, 'ip': ip,
                        'os': clean_text(peer.get('OS'), 20), 'online': peer.get('Online') is True,
                        'lastSeen': '' if seen.startswith('0001-') else seen})
    return sorted(devices, key=lambda d: (not d['online'], d['name'].casefold()))[:200]


def tailscale_show():
    """One JSON object for the window: {variant, state, name, ip, tailnet, auto, autoError, ours, devices}.

    state: missing | daemon-down | denied | needs-login | needs-approval | starting | stopped | running | unknown."""
    info, data, problem = tailscale_query()
    auto, auto_error = False, ''
    try:
        auto = tailscale_settings()['auto']
    except ValueError as exc:
        auto_error = str(exc)
    if not info['cli']:
        state = 'missing'
    elif problem:
        state = 'daemon-down' if problem == 'daemon' else problem
    else:
        state = {'Running': 'running', 'Stopped': 'stopped', 'NeedsLogin': 'needs-login', 'NeedsMachineAuth': 'needs-approval',
                 'Starting': 'starting'}.get(info['state'], 'unknown')
    tailnet = data.get('CurrentTailnet')
    print(json.dumps({'variant': tailscale_variant(info['cli']), 'state': state, 'name': info['name'], 'ip': info['ip'],
                      'tailnet': clean_text(tailnet.get('Name'), 80) if isinstance(tailnet, dict) else '',
                      'auto': auto, 'autoError': auto_error, 'ours': tailscale_marker() is not None,
                      'devices': tailscale_devices(data)}, ensure_ascii=False))


def tailscale_command(cli, *args, timeout=20):
    """Run the CLI once; a readable ValueError for a refusal or a timeout. Always as CLI (TAILSCALE_BE_CLI=1)."""
    try:
        result = subprocess.run([cli, *args], capture_output=True, text=True, timeout=timeout,
                                env={**os.environ, 'TAILSCALE_BE_CLI': '1'})
    except subprocess.TimeoutExpired:
        raise ValueError(f'Tailscale „{args[0]}“ hat nicht rechtzeitig geantwortet.') from None
    except OSError as exc:
        raise ValueError(f'Tailscale konnte nicht gestartet werden: {exc}') from None
    if result.returncode:
        text = (result.stderr or result.stdout).strip()
        if 'access denied' in text.lower() or 'permission denied' in text.lower():
            raise ValueError(TAILSCALE_SETUP_HINT)
        raise ValueError(clean_text((text.splitlines() or [f'Exit {result.returncode}'])[-1], 200))
    return result


def tailscale_ready():
    """(cli, info, data) once Tailscale can be controlled, else a ValueError that says what is missing."""
    info, data, problem = tailscale_query()
    if not info['cli']:
        raise ValueError('Tailscale ist nicht installiert. „Einrichten…“ zeigt die Schritte.')
    if problem == 'denied':
        raise ValueError(TAILSCALE_SETUP_HINT)
    if problem:
        raise ValueError('Der Tailscale-Dienst antwortet nicht. CLI-Variante: „Einrichten…“ startet ihn; App-Variante: die '
                         'Tailscale-App öffnen.')
    return info['cli'], info, data


def tailscale_up():
    """Connect (flagless `up`). A manual choice, so a VibeCode-started marker is dropped: the watcher must not undo it."""
    cli, info, _ = tailscale_ready()
    if info['state'] == 'NeedsLogin':
        raise ValueError('Tailscale ist auf diesem Mac nicht angemeldet. Zuerst „Anmelden…“.')
    if info['state'] != 'Running':
        tailscale_command(cli, 'up', timeout=30)
    clear_ours()
    print('Tailscale ist verbunden.')


def tailscale_down():
    cli, info, _ = tailscale_ready()
    if info['state'] == 'Running':
        tailscale_command(cli, 'down')
    clear_ours()
    print('Tailscale ist getrennt.')


def tailscale_logout():
    cli, _, _ = tailscale_ready()
    tailscale_command(cli, 'logout')
    clear_ours()
    print('Von Tailscale abgemeldet. „Anmelden…“ meldet diesen Mac wieder an.')


def detached(command, out=subprocess.DEVNULL, env=None):
    """Start `command` in a session of its own with no terminal, so it never keeps a Terminal tab open or dies with it."""
    return subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=out, stderr=out, start_new_session=True, env=env)


def pid_runs(pid, needle):
    """True if process `pid` is still ours: its command line contains `needle` (a recycled pid is never signalled)."""
    return needle in run('/bin/ps', '-p', str(pid), '-o', 'command=', check=False).stdout


def tailscale_login(wait=15, sleep=time.sleep, clock=time.time):
    """Start the browser login: a detached `up` waits for it, its AuthURL (from `status --json`) is opened and printed as JSON.

    {"url": "https://…"} or {"url": ""} when this Mac is connected already. Only an https URL is ever opened."""
    cli, info, data = tailscale_ready()
    if info['state'] == 'Running':
        print(json.dumps({'url': ''}))
        return
    try:
        previous = read(TAILSCALE_LOGIN)
    except ValueError:
        previous = None
    if isinstance(previous, dict) and isinstance(previous.get('pid'), int) and pid_runs(previous['pid'], f'{cli} up'):
        os.kill(previous['pid'], signal.SIGTERM)                               # a login that nobody finished
    BASE.mkdir(parents=True, exist_ok=True)
    with (BASE / 'tailscale-login.log').open('w') as log:
        child = detached([cli, 'up'], log, {**os.environ, 'TAILSCALE_BE_CLI': '1'})
    write(TAILSCALE_LOGIN, {'pid': child.pid})
    deadline = clock() + wait
    while True:
        _, data, problem = tailscale_query()
        url = data.get('AuthURL')
        if not url:
            # Fallback: `up` schreibt „To authenticate, visit: https://…“ selbst, falls der Status den Link (noch) nicht nennt.
            found = re.search(r'https://\S+', (BASE / 'tailscale-login.log').read_text(errors='replace')) if (BASE / 'tailscale-login.log').exists() else None
            url = found.group(0) if found else url
        if isinstance(url, str) and url.startswith('https://') and len(url) < 2000 and not re.search(r'[\x00-\x20\x7f]', url):
            run('/usr/bin/open', url, check=False)
            print(json.dumps({'url': url}))
            return
        if data.get('BackendState') == 'Running':
            print(json.dumps({'url': ''}))
            return
        if problem == 'denied':
            raise ValueError(TAILSCALE_SETUP_HINT)
        if clock() >= deadline:
            raise ValueError('Tailscale hat keinen Anmelde-Link geliefert. Läuft der Dienst? „Einrichten…“ prüft das.')
        sleep(1)


def live_sessions(now):
    """Heartbeat files of VS Code windows VibeCode opened that were touched recently."""
    folder = BASE / TAILSCALE_SESSIONS
    live = []
    for file in folder.glob('*.json') if folder.is_dir() else []:
        try:
            if 0 <= now - file.stat().st_mtime < HEARTBEAT_FRESH:
                live.append(file)
        except OSError:
            pass
    return live


def watcher_running():
    BASE.mkdir(parents=True, exist_ok=True)
    with (BASE / TAILSCALE_WATCH_LOCK).open('a+') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return True
        fcntl.flock(lock, fcntl.LOCK_UN)
        return False


def spawn_watcher():
    """Start the watcher once. Detached with its own session and no terminal, so it never keeps a Terminal tab open."""
    (BASE / TAILSCALE_SESSIONS).mkdir(parents=True, exist_ok=True)      # the extension reports only while this folder exists
    if watcher_running():
        return
    with (BASE / 'tailscale-watch.log').open('a') as log:
        detached([sys.executable, str(Path(__file__).resolve()), 'tailscale', 'watch'], log)


def tailscale_ensure(wait=0):
    """VibeCode starts a workspace: connect Tailscale if "mit VibeCode starten und beenden" is on. Never raises, never blocks long.

    Only a Tailscale that VibeCode itself turned on is ever turned off again later; one that was running already is left alone."""
    try:
        try:
            if not tailscale_settings()['auto']:
                return 'aus'
        except ValueError:
            return 'aus'                                                    # a corrupt settings file never makes a launch fail
        info, _, problem = tailscale_query()
        if not info['cli'] or problem or info['state'] == 'NeedsLogin':
            return 'übersprungen'
        now = time.time()
        if info['state'] == 'Running':
            marker = tailscale_marker()
            if marker is None:
                return 'lief schon'
            write(TAILSCALE_OURS, dict(marker, launched=now, seen=False))      # a new launch: wait for its window again
        else:
            write(TAILSCALE_OURS, {'boot': boot_id(), 'launched': now, 'seen': False, 'lastSeen': 0})
            if wait > 0:
                try:
                    subprocess.run([info['cli'], 'up'], capture_output=True, timeout=wait,
                                   env={**os.environ, 'TAILSCALE_BE_CLI': '1'})
                except subprocess.TimeoutExpired:
                    pass                                                    # still connecting: the watcher goes on regardless
            else:
                detached([info['cli'], 'up'], env={**os.environ, 'TAILSCALE_BE_CLI': '1'})
        spawn_watcher()
        return 'verbunden' if wait > 0 else 'wird verbunden'
    except (ValueError, OSError, subprocess.SubprocessError) as exc:
        print(f'Tailscale-Autostart: {exc}', file=sys.stderr)
        return 'Fehler'


def tailscale_watch(poll=15, grace=60, patience=600, clock=time.time, sleep=time.sleep):
    """Disconnect Tailscale once the last VS Code window VibeCode opened is gone — and only then.

    All must hold: the marker says VibeCode turned it on, a heartbeat was seen since the last launch, none has been live for
    `grace` seconds and Tailscale is still running. No heartbeat within `patience` (old extension, cancelled dialog): the marker is
    dropped and Tailscale stays on. In doubt it stays on. A Mac that slept freezes the watcher and the windows alike: when the clock
    jumped between two polls, the old heartbeats prove nothing, so `lastSeen` restarts and the windows get `grace` to report again
    (otherwise opening the lid would disconnect Tailscale while Remote-SSH reconnects). Returns what happened, for the log and the tests."""
    BASE.mkdir(parents=True, exist_ok=True)
    with (BASE / TAILSCALE_WATCH_LOCK).open('a+') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 'läuft schon'
        try:
            last_poll = clock()
            while True:
                marker = tailscale_marker()
                if marker is None:
                    return 'keine Marke'
                info = tailscale_state()
                if info['state'] != 'Running':
                    clear_ours()
                    return 'nicht mehr verbunden'
                now = clock()
                woke, last_poll = now - last_poll > poll + 30, now
                if live_sessions(now):
                    write(TAILSCALE_OURS, dict(marker, seen=True, lastSeen=now))
                elif woke:
                    if marker.get('seen'):
                        write(TAILSCALE_OURS, dict(marker, lastSeen=now))
                elif marker.get('seen') and now - marker.get('lastSeen', 0) >= grace:
                    tailscale_command(info['cli'], 'down')
                    clear_ours()
                    return 'getrennt'
                elif not marker.get('seen') and now - marker['launched'] > patience:
                    clear_ours()
                    return 'keine Fenstermeldung'
                sleep(poll)
        finally:
            folder = BASE / TAILSCALE_SESSIONS
            for file in folder.glob('*') if folder.is_dir() else []:
                file.unlink(missing_ok=True)
            if folder.is_dir():
                folder.rmdir()


def tailscale_main(args):
    sub, rest = (args[0] if args else 'show'), args[1:]
    if sub == 'show' and not rest:
        tailscale_show()
    elif sub == 'up' and not rest:
        tailscale_up()
    elif sub == 'down' and not rest:
        tailscale_down()
    elif sub == 'login' and not rest:
        tailscale_login()
    elif sub == 'logout' and not rest:
        tailscale_logout()
    elif sub == 'auto':
        tailscale_auto(rest)
    elif sub == 'ensure':
        if rest and not (len(rest) == 2 and rest[0] == '--wait' and rest[1].isdigit()):
            raise ValueError('Aufruf: workspace remote tailscale ensure [--wait SEKUNDEN]')
        print(tailscale_ensure(min(int(rest[1]), 30) if rest else 0))
    elif sub == 'setup' and not rest:
        os.execv('/bin/sh', ['/bin/sh', '-c', TAILSCALE_SETUP])
    elif sub == 'watch' and not rest:
        print(tailscale_watch())
    else:
        raise ValueError('tailscale-Befehle: show | up | down | login | logout | auto on|off | ensure [--wait N] | setup | watch')


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
    tailscale = tailscale_reason(target['host'], unknown_name)
    # The general "Tailscale would help" tip only when nothing more specific is known: it would contradict a Tailscale-specific reason.
    tip = (' Der Name wird nicht gefunden: sind beide Macs im selben Netz? Unterwegs hilft Tailscale auf beiden Macs: '
           'als Host dann den Tailscale-Namen oder die 100.x-Adresse des Remote-Macs verwenden.') if unknown_name and not tailscale else ''
    raise ValueError(
        f'{target["host"]}:{target["port"]} nicht erreichbar ({reason}). Prüfen: Remote-Mac '
        'an und wach (dort: workspace remote on), Entfernte Anmeldung aktiv (dort: '
        'workspace remote ssh info), gleiches Netz bzw. Tailscale läuft.' + tip + (' ' + tailscale if tailscale else ''))


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
     'line': the join line for the other Mac ('' while Remote Login is off),
     'via': 'tailscale' if the line carries the tailnet host (works away from home), else 'local' (.local, same network only),
     'localLine': the .local variant when `line` uses Tailscale (for the home network), else '',
     'tailscale': 'running' | 'off' (installed, not connected) | 'missing'}"""
    name = run('/usr/sbin/scutil', '--get', 'LocalHostName', check=False).stdout.strip()
    local = (name or socket.gethostname().split('.')[0]) + '.local'
    tailnet = tailscale_state()
    host = tailscale_host(tailnet) or local
    listening, awake = ssh_listening(), waking or wake_active()
    fingerprint = host_fingerprint() if listening else ''

    def join_line(target):
        return ' '.join(['workspace remote ssh join', f'{getpass.getuser()}@{target}'] +
                        ([fingerprint] if fingerprint else [])) if listening else ''
    via = 'local' if host == local else 'tailscale'
    return {'listening': listening, 'awake': awake, 'fingerprint': fingerprint, 'line': join_line(host), 'via': via,
            'localLine': join_line(local) if via == 'tailscale' else '', 'tailscale': tailscale_kind(tailnet)}


def ssh_info(output=print, waking=False):
    """Status of THIS Mac as an SSH target (run on the remote Mac), as text. Returns the join line or ''."""
    facts = ssh_facts(waking)
    listening, awake = facts['listening'], facts['awake']
    output('SSH-ZUGANG DIESES MACS')
    output(f'Entfernte Anmeldung  {"AN (Port 22)" if listening else "AUS"}')
    output(f'Wachhalten           {"AN" if awake else "AUS (Mac kann einschlafen, dann ist SSH nicht erreichbar)"}')
    output('Tailscale            ' + {'running': 'verbunden: dieser Mac ist auch unterwegs erreichbar',
                                      'off': 'installiert, aber nicht verbunden: nur im selben Netz erreichbar',
                                      'missing': 'nicht installiert: nur im selben Netz erreichbar (unterwegs: Tailscale auf beiden Macs)'}[facts['tailscale']])
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
    if facts['localLine']:
        output('Nur im selben Netz geht auch:')
        output('  ' + facts['localLine'])
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
                          'fingerprint': bool(facts['fingerprint']), 'copied': copied, 'settingsOpened': opened,
                          'via': facts['via'], 'localLine': facts['localLine'], 'tailscale': facts['tailscale']},
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
    elif cmd == 'tailscale':
        tailscale_main(args[1:])
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
        raise ValueError('Befehle: control | on | off | status | ssh | tailscale | install | uninstall')


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
