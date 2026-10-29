#!/usr/bin/env python3
"""Discover Git checkouts on configured SSH hosts, with an offline snapshot."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile
from urllib.parse import quote


SCAN_SCRIPT = r'''
root=$1
case "$root" in
    '~') root=$HOME ;;
    '~/'*) root="$HOME/${root#\~/}" ;;
esac
if [ ! -d "$root" ]; then
    printf 'Suchordner existiert nicht: %s\n' "$root" >&2
    exit 2
fi
cd "$root" || exit 2
root=$(pwd -P) || exit 2
printf 'VIBECODE_REMOTE_REPOS\000'
find "$root" -mindepth 1 \( -name node_modules -o -name .venv -o -name venv \
    -o -name .cache -o -name .Trash -o -name Library \) -prune \
    -o -name .git \( -type d -o -type f \) -print0 -prune
status=$?
# A partial scan must not remove previously discovered, now unreadable repos.
[ "$status" -eq 0 ] || exit 3
'''


def valid_path(value, home=False):
    return (isinstance(value, str) and bool(value) and
            (value.startswith('/') or home and (value == '~' or value.startswith('~/'))) and
            not re.search(r'[\x00-\x1f\x7f]', value) and
            not any(part in ('.', '..') for part in value.split('/')))


def location(host, root):
    if not isinstance(host, str) or re.fullmatch(r'[a-zA-Z0-9_][a-zA-Z0-9_.@-]*', host) is None:
        raise ValueError('Ungültiger SSH-Host. Bitte einen Hostalias oder user@host angeben.')
    if not valid_path(root, home=True):
        raise ValueError('Suchordner muss ein absoluter Pfad, ~ oder ~/Unterordner sein.')
    return host, root.rstrip('/') or '/'


def read_json(path, default):
    return json.loads(path.read_text()) if path.exists() else default


def hosts(config):
    raw = read_json(config / 'remote-hosts.json', {'version': 1, 'hosts': []})
    if not isinstance(raw, dict) or raw.get('version') != 1 or not isinstance(raw.get('hosts'), list):
        raise ValueError('Ungültige remote-hosts.json. Die Datei wurde nicht verändert.')
    entries, seen = [], set()
    for entry in raw['hosts']:
        if not isinstance(entry, dict):
            raise ValueError('Ungültiger Remote-Host-Eintrag.')
        host, root = location(entry.get('host'), entry.get('root'))
        if host in seen:
            raise ValueError(f'SSH-Host doppelt konfiguriert: {host}')
        seen.add(host)
        entries.append({'host': host, 'root': root})
    return entries


def snapshot(config):
    raw = read_json(config / 'remote-repositories.json', {'version': 1, 'hosts': {}})
    if not isinstance(raw, dict) or raw.get('version') != 1 or not isinstance(raw.get('hosts'), dict):
        raise ValueError('Ungültiger Remote-Repository-Cache. Die Datei wurde nicht verändert.')
    for host, entry in raw['hosts'].items():
        if not isinstance(entry, dict):
            raise ValueError('Ungültiger Remote-Repository-Cache-Eintrag.')
        location(host, entry.get('root'))
        if not isinstance(entry.get('paths'), list) or any(not valid_path(p) for p in entry['paths']):
            raise ValueError('Ungültige Repository-Pfade im Remote-Cache.')
    return raw['hosts']


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(json.dumps(value, indent=2, ensure_ascii=False) + '\n')
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def add_host(config, host, root):
    host, root = location(host, root)
    entries = hosts(config)
    entries = [entry for entry in entries if entry['host'] != host]
    entries.append({'host': host, 'root': root})
    write_json(config / 'remote-hosts.json', {'version': 1, 'hosts': entries})


def scan(host, root, interactive=False):
    # SSH runs the remote command through a shell; quote its one variable argument.
    # The scanner itself goes over stdin and requires only POSIX sh and find remotely.
    command = ['ssh', '-T', '-o', 'ConnectTimeout=5', '-o', 'ConnectionAttempts=1',
               '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=1']
    if not interactive:
        command += ['-o', 'BatchMode=yes']
    command += ['--', host, 'sh -s -- ' + shlex.quote(root)]
    result = subprocess.run(command, input=SCAN_SCRIPT.encode(), stdout=subprocess.PIPE,
                            stderr=None if interactive else subprocess.PIPE, timeout=60 if interactive else 15)
    if result.returncode not in (0, 3):
        detail = (result.stderr or b'').decode('utf-8', errors='replace').strip()
        raise ValueError(detail or f'SSH-Suche fehlgeschlagen (Status {result.returncode}).')
    _banner, separator, payload = result.stdout.partition(b'VIBECODE_REMOTE_REPOS\0')
    if not separator:
        raise ValueError('Die SSH-Verbindung hat keine gültige Repository-Liste geliefert.')
    paths = []
    for marker in payload.decode('utf-8').split('\0'):
        if marker.endswith('/.git'):
            path = marker[:-5] or '/'
            if valid_path(path):
                paths.append(path)
    return sorted(set(paths)), result.returncode == 3


def discover(config, cached=False, interactive=False, output=sys.stderr):
    entries, previous = hosts(config), snapshot(config)
    updated, projects = dict(previous), []

    def refresh(entry):
        host, root = entry['host'], entry['root']
        old = previous.get(host, {})
        paths = old.get('paths', []) if old.get('root') == root else []
        if cached:
            return paths, None
        try:
            found, partial = scan(host, root, interactive)
            if partial:
                print(f'Remote {host}: Suche unvollständig; bisherige Repositories bleiben erhalten.', file=output)
                found = sorted(set(paths + found))
            return found, {'root': root, 'paths': found}
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            print(f'Remote {host}: {error}\nVerwende {len(paths)} zuletzt gefundene Repositories.', file=output)
            return paths, None

    # Password/key prompts in setup must happen one host at a time.
    with ThreadPoolExecutor(max_workers=1 if interactive else 4) as pool:
        for entry, (paths, fresh) in zip(entries, pool.map(refresh, entries)):
            host = entry['host']
            if fresh is not None:
                updated[host] = fresh
            for path in paths:
                name = f'{Path(path).name or "Remote"} [SSH: {host}]'
                # Match encodeURIComponent in remote-project.js for stable identities.
                encoded_path = quote(path, safe="/!'()*")
                uri = f'vscode-remote://ssh-remote+{host}{encoded_path}'
                projects.append((name, uri))
    if updated != previous and not cached:
        write_json(config / 'remote-repositories.json', {'version': 1, 'hosts': updated})
    return projects


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    add = commands.add_parser('add')
    add.add_argument('config', type=Path)
    add.add_argument('host')
    add.add_argument('root', nargs='?', default='~')
    find = commands.add_parser('discover')
    find.add_argument('config', type=Path)
    find.add_argument('--cached', action='store_true')
    find.add_argument('--interactive', action='store_true')
    args = parser.parse_args()
    if args.command == 'add':
        add_host(args.config, args.host, args.root)
    else:
        for name, uri in discover(args.config, args.cached, args.interactive):
            print(f'{name}\t{uri}')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError) as error:
        print(f'Remote-Repository-Suche: {error}', file=sys.stderr)
        sys.exit(1)
