#!/usr/bin/env python3
"""Optional macOS remote windows. No third-party Python packages required."""
import datetime as dt
import fcntl
import json
import math
import os
from pathlib import Path
import plistlib
import re
import shlex
import signal
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parent
BASE = Path.home() / '.config/vibecode-workspace/remote'
LABEL = 'com.vibecode-workspace.remote'
PLIST = Path.home() / 'Library/LaunchAgents' / (LABEL + '.plist')
DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']


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


def duration(value):
    m = re.fullmatch(r'([1-9][0-9]*)(m|h)', value)
    if not m:
        raise ValueError('Dauer: 1m bis 24h, z. B. 5h oder 90m.')
    seconds = int(m[1]) * (3600 if m[2] == 'h' else 60)
    if seconds > 86400:
        raise ValueError('Maximale Dauer: 24h.')
    return seconds


def config(overrides=None):
    defaults = json.loads((ROOT / 'remote.example.json').read_text())
    c = {**defaults, **read('config.json', {}), **(overrides or {})}
    for k, v in defaults.items():
        if isinstance(v, bool) and type(c[k]) is not bool:
            raise ValueError(k + ' muss true oder false sein.')
    if not isinstance(c['days'], list) or not c['days'] or any(d not in DAYS for d in c['days']):
        raise ValueError('days benötigt englische Wochentage.')
    if not isinstance(c['apps'], list) or any(not isinstance(a, str) or not a.strip() for a in c['apps']):
        raise ValueError('apps benötigt eine Liste von App-Namen.')
    if not re.fullmatch(r'([01][0-9]|2[0-3]):[0-5][0-9]', c['start']):
        raise ValueError('start benötigt HH:MM.')
    duration(c['duration'])
    return c


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


def window(c, state, now):
    if state.get('disabled', False):
        return 0
    ends = [state.get('manual_until', 0)]
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
    pattern = r'/' + re.escape(name) + r'\.app/Contents/MacOS/'
    return run('/usr/bin/pgrep', '-f', pattern, check=False).returncode == 0


def quit_apps(apps):
    # argv-passed, not string-interpolated into the script, so app names can't break out of it.
    for app in apps:
        run('/usr/bin/osascript', '-e', 'on run argv', '-e',
            'tell application (item 1 of argv) to quit', '-e',
            'end run', app, check=False)


def stamp(value):
    return dt.datetime.fromtimestamp(value).strftime('%a %d %b · %H:%M') if value else '—'


def status():
    c, state, now = config(), read('request.json', {}), time.time()
    health = read('health.json', {})
    live = now - health.get('updated', 0) < 75
    end = window(c, state, now)
    active = live and end and health.get('until', 0) > now
    future = [start for start, _ in slots(c, now) if start > now]
    print('REMOTE SESSION')
    print('Status       ', 'ACTIVE' if active else ('STARTING' if end else 'OFFLINE'))
    print('Until        ', stamp(end))
    print('Mac sleep    ', 'BLOCKED (eigene Sperre)' if active and health.get('awake') else 'keine eigene Sperre bestätigt')
    for app in c['apps']:
        print(f'{app + " app":<13}', 'RUNNING' if app_running(app) else 'STOPPED')
    print('Remote link   nicht geprüft; Remote-Zugriff in den Apps einrichten')
    print('Next slot    ', stamp(min(future)) if future and c['enabled'] and not state.get('disabled') else '—')
    print('Wake plan    ', 'registriert (Stand bei Installation)' if read('wake.json') else 'nicht registriert')
    if live and health.get('error'):
        print('Fehler       ', health['error'])


def terminal():
    command = shlex.join([str(ROOT / 'workspace'), 'remote', 'watch'])
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


def install(schedule=False):
    c = config()
    BASE.mkdir(parents=True, exist_ok=True)
    if not (BASE / 'config.json').exists():
        write('config.json', c)
    if schedule:
        wake_plan(c)
        state = read('request.json', {})
        state['disabled'] = False
        write('request.json', state)
    domain = 'gui/' + str(os.getuid())
    if run('/bin/launchctl', 'print', domain + '/' + LABEL, check=False).returncode == 0:
        return
    PLIST.parent.mkdir(parents=True, exist_ok=True)
    payload = {'Label': LABEL, 'ProgramArguments': [sys.executable, str(ROOT / 'remote.py'), 'controller'],
               'RunAtLoad': True, 'KeepAlive': True, 'ThrottleInterval': 10,
               'StandardOutPath': str(BASE / 'controller.log'),
               'StandardErrorPath': str(BASE / 'controller.log'),
               'EnvironmentVariables': {'PATH': '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'}}
    PLIST.write_bytes(plistlib.dumps(payload))
    run('/bin/launchctl', 'bootstrap', domain, str(PLIST))


def stop(disable=False):
    c, now = config(), time.time()
    # A stop skips the current scheduled slot; it must not restart next tick.
    ends = [end for start, end in slots(c, now) if start <= now < end]
    write('request.json', {'manual_until': 0, 'skip_until': max(ends, default=0), 'disabled': disable})


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
        coffee, previous, last_check, coffee_end = None, 0, 0, 0
        service_error = ''
        def release():
            nonlocal coffee
            if coffee and coffee.poll() is None:
                coffee.terminate()
                coffee.wait(timeout=5)
            coffee = None
        try:
            while alive:
                error, end = '', 0
                try:
                    c, now = config(), time.time()
                    end = window(c, read('request.json', {}), now)
                    if end:
                        if c['keep_awake'] and (not coffee or coffee.poll() is not None or coffee_end != end):
                            release()
                            coffee = subprocess.Popen(['/usr/bin/caffeinate', '-is', '-t',
                                                       str(max(1, math.ceil(end - now))), '-w', str(os.getpid())])
                            coffee_end = end
                        elif not c['keep_awake']:
                            release()
                        if not previous or now - last_check >= 60:
                            last_check = now
                            errors = []
                            for app in c['apps']:
                                try:
                                    if (not previous or c['restart_if_crashed']) and not app_running(app):
                                        run('/usr/bin/open', '-g', '-a', app)
                                except Exception as exc:
                                    errors.append(f'{app}: {exc}')
                            service_error = '; '.join(errors)
                        if not previous:
                            # Mark the transition before UI side effects to avoid duplicate windows on errors.
                            previous = end
                            if c['open_control_terminal']:
                                try:
                                    terminal()
                                except Exception as exc:
                                    service_error += ' ' + str(exc)
                            if c['open_workspace']:
                                env = dict(os.environ, VIBE_REMOTE_TERMINALS=str(c['open_terminals']).lower())
                                with (BASE / 'workspace.log').open('a') as log:
                                    subprocess.Popen([str(ROOT / 'VibeCode Workspace.command'), '--remote-workspace'],
                                                     env=env, stdout=log, stderr=log)
                        error = service_error
                    else:
                        release()
                        if previous:
                            previous = 0
                            if c['close_apps_after']:
                                quit_apps(c['apps'])
                            if c['force_sleep']:
                                run('/usr/bin/pmset', 'sleepnow')
                except Exception as exc:
                    error = str(exc)
                    # Invalid config releases our assertion; normal app errors retain the bounded window.
                    if not end:
                        release()
                        previous = 0
                    else:
                        previous = end
                write('health.json', {'updated': time.time(), 'until': end,
                                     'awake': coffee is not None and coffee.poll() is None, 'error': error})
                time.sleep(2)
        finally:
            release()
            write('health.json', {'updated': time.time(), 'until': 0, 'awake': False})


def main(args):
    cmd = args[0] if args else 'status'
    if cmd == 'controller':
        controller()
    elif cmd == 'status':
        status()
    elif cmd == 'menu':
        result = run('/usr/bin/osascript', '-l', 'JavaScript', str(ROOT / 'remote-setup.js'),
                     json.dumps(config())).stdout.strip()
        if result:
            selection = json.loads(result)
            if 'config' in selection:
                write('config.json', config(selection['config']))
                print('Gespeichert. Für den Wake-Zeitplan jetzt ./workspace remote install ausführen.')
            else:
                main([selection['command']])
    elif cmd == 'install':
        install(schedule=True)
        print('Remote-Controller installiert. Einstellungen:', BASE / 'config.json')
    elif cmd == 'config':
        if not (BASE / 'config.json').exists():
            write('config.json', config())
        print(BASE / 'config.json')
        run('/usr/bin/open', '-t', str(BASE / 'config.json'))
    elif cmd in ('off', 'disable'):
        stop(disable=cmd == 'disable')
        if cmd == 'disable':
            wake_plan(config(), remove=True)
        print('Sitzung beendet; eigene Schlafsperre wird innerhalb von 2 Sekunden freigegeben.')
    elif cmd == 'uninstall':
        stop(disable=True)
        wake_plan(config(), remove=True)
        run('/bin/launchctl', 'bootout', 'gui/' + str(os.getuid()) + '/' + LABEL, check=False)
        PLIST.unlink(missing_ok=True)
        print('Remote-Dienst entfernt. Konfiguration bleibt erhalten.')
    elif cmd == 'watch':
        print('Steuerterminal: Strg+C beendet die aktuelle Remote-Sitzung.', flush=True)
        try:
            while window(config(), read('request.json', {}), time.time()):
                status()
                print('─' * 55, flush=True)
                time.sleep(10)
        except KeyboardInterrupt:
            stop()
        print('Remote-Sitzung beendet. macOS darf normal schlafen.')
    elif cmd in ('now', 'until-midnight') or re.fullmatch(r'[0-9]+[mh]', cmd):
        value = args[1] if cmd == 'now' and len(args) > 1 else ('5h' if cmd == 'now' else cmd)
        now = time.time()
        end = (dt.datetime.combine(dt.date.today() + dt.timedelta(days=1), dt.time()).timestamp()
               if cmd == 'until-midnight' else now + duration(value))
        install()
        state = read('request.json', {})
        state.update(manual_until=end, disabled=False)
        write('request.json', state)
        time.sleep(2.2)
        status()
    else:
        raise ValueError('Befehle: status | menu | now 5h | 1h | 3h | 6h | until-midnight | off | disable | config | install | uninstall | watch')


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except (ValueError, OSError, subprocess.SubprocessError) as exc:
        print('Remote: ' + str(exc), file=sys.stderr)
        sys.exit(1)
