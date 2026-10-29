#!/usr/bin/env python3
"""Guided SSH setup shared by repository discovery and VS Code Remote SSH."""
import argparse
import glob
import importlib.util
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time


spec = importlib.util.spec_from_file_location('remote_hosts', Path(__file__).with_name('remote-hosts.py'))
remote_hosts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(remote_hosts)

INSTALL_KEY = r'''
set -eu
IFS= read -r key
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
touch "$HOME/.ssh/authorized_keys"
chmod 600 "$HOME/.ssh/authorized_keys"
if ! grep -qxF -- "$key" "$HOME/.ssh/authorized_keys"; then
    printf '\n%s\n' "$key" >> "$HOME/.ssh/authorized_keys"
fi
printf '\nVIBECODE_KEY_READY\n'
'''


def aliases(ssh_dir):
    """List concrete aliases, including Include files, without executing config."""
    found, visited = [], set()
    def visit(path):
        path = path.resolve()
        if path in visited or not path.is_file() or len(visited) >= 100:
            return
        visited.add(path)
        for line in path.read_text().splitlines():
            line = re.sub(r'^(\s*\w+)\s*=\s*', r'\1 ', line)
            parts = shlex.split(line, comments=True)
            if not parts:
                continue
            if parts[0].lower() == 'host':
                found.extend(value for value in parts[1:] if re.fullmatch(r'[\w.-]+', value, re.ASCII))
            elif parts[0].lower() == 'include':
                for pattern in parts[1:]:
                    pattern = Path(pattern).expanduser()
                    if not pattern.is_absolute():
                        pattern = ssh_dir / pattern
                    for included in sorted(glob.glob(str(pattern))):
                        visit(Path(included))
    visit(ssh_dir / 'config')
    return list(dict.fromkeys(found))


def connection(alias, target, port):
    if re.fullmatch(r'[a-zA-Z0-9_][a-zA-Z0-9_.-]*', alias) is None:
        raise ValueError('Verbindungsname: nur Buchstaben, Zahlen, Punkt, Unterstrich und Bindestrich verwenden.')
    if target.count('@') != 1:
        raise ValueError('Ziel als benutzer@adresse eingeben, z. B. ubuntu@192.168.1.50.')
    user, address = target.split('@')
    address = address.removeprefix('[').removesuffix(']')
    if (re.fullmatch(r'[a-zA-Z0-9_][a-zA-Z0-9_.-]*', user) is None or
            re.fullmatch(r'[a-zA-Z0-9:][a-zA-Z0-9_.:-]*', address) is None):
        raise ValueError('Ungültiger Benutzer oder Hostname/IP-Adresse.')
    if not str(port).isdigit() or not 1 <= int(port) <= 65535:
        raise ValueError('SSH-Port muss zwischen 1 und 65535 liegen.')
    return user, address, int(port)


def config_string(value):
    if '${' in value or any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise ValueError('Ungültiger Pfad für den SSH-Schlüssel.')
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%') + '"'


def save_connection(ssh_dir, alias, target, port, key):
    user, address, port = connection(alias, target, port)
    if alias.casefold() in {name.casefold() for name in aliases(ssh_dir)}:
        raise ValueError(f'Die Verbindung {alias} existiert bereits. Bitte auswählen oder einen anderen Namen verwenden.')
    ssh_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    config = ssh_dir / 'config'
    destination = config.resolve() if config.is_symlink() else config
    original = destination.read_text() if destination.exists() else ''
    block = (f'# VibeCode Workspace: {alias}\nHost {alias}\n'
             f'    HostName {address}\n    User {user}\n    Port {port}\n'
             f'    IdentityFile {config_string(str(key))}\n    IdentitiesOnly yes\n'
             '    AddKeysToAgent yes\n    IgnoreUnknown UseKeychain\n    UseKeychain yes\n'
             '    ServerAliveInterval 15\n    ServerAliveCountMax 3\n'
             'Host *\n# Ende VibeCode Workspace\n\n')
    # Specific values must precede existing Host * defaults. Reset the Host
    # context before the original file's global options, preserving its contents.
    candidate = block + original
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=destination.parent, delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(candidate)
        result = subprocess.run(['ssh', '-G', '-F', str(temporary), alias],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
        if result.returncode:
            raise ValueError('SSH-Konfiguration ist ungültig: ' + result.stderr.decode(errors='replace').strip())
        backup = None
        if destination.exists():
            backup = ssh_dir / f'config.vibecode-backup-{time.time_ns()}'
            shutil.copy2(destination, backup)
        os.replace(temporary, destination)
        return backup
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def ensure_key(key, output=print):
    key.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not key.exists():
        output(f'Erzeuge SSH-Schlüssel: {key}\nDie Passphrase wird direkt von ssh-keygen abgefragt.')
        subprocess.run(['ssh-keygen', '-t', 'ed25519', '-f', str(key), '-C', 'VibeCode Workspace'], check=True)
    public = Path(str(key) + '.pub')
    if not public.exists():
        result = subprocess.run(['ssh-keygen', '-y', '-f', str(key)], check=True,
                                stdout=subprocess.PIPE)
        public.write_bytes(result.stdout)
    subprocess.run(['ssh-keygen', '-l', '-f', str(public)], check=True,
                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return public


def load_key(key, output=print):
    command = ['/usr/bin/ssh-add', '--apple-use-keychain'] if sys.platform == 'darwin' else ['ssh-add']
    if subprocess.run(command + [str(key)]).returncode:
        output('Der Schlüssel konnte nicht in den SSH-Agent geladen werden. Der folgende Verbindungstest prüft den Zugang trotzdem.')


def ssh_command(host, interactive=False):
    # A reused ControlMaster socket would hide a broken key configuration.
    command = ['ssh', '-T', '-o', 'ConnectTimeout=5', '-o', 'ConnectionAttempts=1',
               '-o', 'ControlPath=none']
    if not interactive:
        command += ['-o', 'BatchMode=yes']
    return command + ['--', host]


def probe(host, interactive=False):
    result = subprocess.run(ssh_command(host, interactive) + ["printf '\\nVIBECODE_CONNECTED\\n'"],
                            stdout=subprocess.PIPE, stderr=None if interactive else subprocess.PIPE,
                            timeout=90 if interactive else 15)
    return result.returncode == 0 and b'\nVIBECODE_CONNECTED\n' in result.stdout


def install_key(host, public):
    key = public.read_text().strip()
    if len(key.splitlines()) != 1 or not re.match(r'^(ssh-|ecdsa-)', key):
        raise ValueError('Keine gültige öffentliche SSH-Schlüsseldatei.')
    result = subprocess.run(ssh_command(host, interactive=True) + ['sh -c ' + shlex.quote(INSTALL_KEY)],
                            input=(key + '\n').encode(), stdout=subprocess.PIPE, timeout=120)
    if result.returncode or b'\nVIBECODE_KEY_READY\n' not in result.stdout:
        raise ValueError('SSH-Schlüssel konnte nicht hinterlegt werden. Adresse, Benutzer, SSH-Dienst und Anmeldung prüfen.')


def configured_keys(host):
    result = subprocess.run(['ssh', '-G', host], check=True, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=10)
    return [Path(line.split(' ', 1)[1]).expanduser() for line in result.stdout.decode().splitlines()
            if line.startswith('identityfile ') and '%' not in line and '${' not in line]


def choose(options, text, input_fn=input, output=print):
    output(text)
    for index, option in enumerate(options, 1):
        output(f'  [{index}] {option}')
    while True:
        answer = input_fn('Auswahl (Enter = 1, q = Abbrechen): ').strip() or '1'
        if answer.lower() == 'q':
            raise KeyboardInterrupt
        if answer.isdigit() and 1 <= int(answer) <= len(options):
            return int(answer) - 1
        output('Bitte eine Nummer aus der Liste wählen.')


def wizard(config, ssh_dir=None, input_fn=input, output=print):
    ssh_dir = ssh_dir or Path.home() / '.ssh'
    known = aliases(ssh_dir)
    output('REMOTE-VERBINDUNG EINRICHTEN\nPasswörter und Passphrasen werden nur von SSH im Terminal abgefragt.')
    selected = choose(known + ['Neue Verbindung einrichten'], 'Vorhandene Verbindung wählen oder eine neue anlegen:', input_fn, output)
    new = selected == len(known)
    key = None
    if new:
        while True:
            target = input_fn('Benutzer und Adresse (z. B. ubuntu@192.168.1.50): ').strip()
            default = 'vibe-' + re.sub(r'[^a-zA-Z0-9_.-]', '-', target.split('@')[-1])
            host = input_fn(f'Name der Verbindung [{default}]: ').strip() or default
            port = input_fn('SSH-Port [22]: ').strip() or '22'
            try:
                connection(host, target, port)
                if host.casefold() in {name.casefold() for name in known}:
                    raise ValueError(f'{host} ist bereits eingerichtet. Für die neue Verbindung einen anderen Namen wählen.')
                break
            except ValueError as error:
                output(str(error))
        available = sorted(path.with_suffix('') for path in ssh_dir.glob('*.pub') if path.with_suffix('').is_file())
        selected_key = choose([str(path) for path in available] + ['Neuen SSH-Schlüssel erzeugen'],
                              'SSH-Schlüssel für die Verbindung:', input_fn, output) if available else 0
        key = available[selected_key] if selected_key < len(available) else ssh_dir / f'id_ed25519_vibecode_{host}'
    else:
        host = known[selected]
    while True:
        root = input_fn('Repository-Suchordner auf dem Server [~ = Home]: ').strip() or '~'
        try:
            remote_hosts.location(host, root)
            break
        except ValueError as error:
            output(str(error))
    # Validate existing profile data before changing SSH configuration or keys.
    remote_hosts.hosts(config)
    remote_hosts.snapshot(config)
    if new:
        public = ensure_key(key, output)
        backup = save_connection(ssh_dir, host, target, port, key)
        if backup:
            output(f'Bisherige SSH-Konfiguration gesichert: {backup}')
        load_key(key, output)
        if not probe(host):
            output('Hinterlege den öffentlichen Schlüssel auf dem Server. SSH fragt bei Bedarf nach Host-Fingerabdruck und Anmeldepasswort.')
            install_key(host, public)
    else:
        keys = [path for path in configured_keys(host) if path.is_file()]
        if not probe(host):
            if keys:
                selected_key = choose([str(path) for path in keys], 'Konfigurierten SSH-Schlüssel entsperren:', input_fn, output)
                key = keys[selected_key]
                load_key(key, output)
            if not probe(host) and not probe(host, interactive=True):
                raise ValueError('Verbindung fehlgeschlagen. Adresse, Netzwerk und SSH-Zugang prüfen.')
            if not probe(host):
                if key is None:
                    raise ValueError('Die Verbindung benötigt noch ein Passwort. Über „Neue Verbindung einrichten“ einen Schlüsselzugang anlegen.')
                install_key(host, ensure_key(key, output))
    if not probe(host):
        raise ValueError('SSH benötigt weiterhin eine Anmeldung. Schlüssel im SSH-Agent entsperren oder Server-Zugang prüfen. Der Host wurde noch nicht für automatische Starts aktiviert.')
    output(f'Verbindung zu {host} funktioniert ohne Passwortabfrage. Suche Repositories …')
    # A failed scan must not register a host as ready or discard an old snapshot.
    paths, partial = remote_hosts.scan(host, root)
    if partial:
        output('Einige Unterordner waren nicht lesbar; die gefundenen Repositories werden übernommen.')
    remote_hosts.add_host(config, host, root)
    old = remote_hosts.snapshot(config)
    normalized_root = remote_hosts.location(host, root)[1]
    previous = old.get(host, {})
    if partial and previous.get('root') == normalized_root:
        paths = sorted(set(paths + previous.get('paths', [])))
    old[host] = {'root': normalized_root, 'paths': paths}
    remote_hosts.write_json(config / 'remote-repositories.json', {'version': 1, 'hosts': old})
    output(f'Fertig: {len(paths)} Repositories verfügbar. Jetzt „Launch Workspace.command“ starten.\nAgenten und Browser-Tabs lassen sich über „Terminals ändern“ anpassen.')
    return host


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('config', type=Path)
    args = parser.parse_args()
    try:
        wizard(args.config)
    except (KeyboardInterrupt, EOFError):
        print('\nRemote-Einrichtung abgebrochen. Vorhandene Verbindungen bleiben verfügbar.')
        sys.exit(130)
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(f'Remote-Einrichtung: {error}', file=sys.stderr)
        sys.exit(1)
