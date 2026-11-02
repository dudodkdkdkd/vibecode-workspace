#!/usr/bin/env python3
"""Local search folders: find Git repositories below folders the user added (counterpart of remote-hosts.py)."""
import argparse
import json
import os
from pathlib import Path
import re
import sys
import tempfile

# Same spirit as the remote scan: dependency and cache folders are never searched.
PRUNE = {'node_modules', '.venv', 'venv', '.cache', '.Trash', 'Library', '__pycache__'}
MAX_DEPTH = 4        # levels below the added folder; ~/Github/<org>/<repo> needs 2
MAX_DIRS = 20000     # a runaway folder (home directory, "/") must not freeze the app


def read_json(path, default):
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else default


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


def clean_path(value):
    """An absolute folder path. Never "/" (the whole disk) and never anything with control characters."""
    if not isinstance(value, str) or not value.strip() or re.search(r'[\x00-\x1f\x7f]', value):
        raise ValueError('Der Ordnerpfad ist leer oder enthält Steuerzeichen.')
    path = Path(value.strip()).expanduser()
    if not path.is_absolute():
        raise ValueError('Bitte einen absoluten Ordnerpfad angeben (oder mit ~ beginnen).')
    if path == Path('/'):
        raise ValueError('Bitte einen konkreten Ordner wählen, nicht die ganze Festplatte.')
    return Path(os.path.normpath(path))


def entries(config):
    """Search folders as {'path', 'quickOpen'}. quickOpen (default false) switches the window's "open repos of this folder" dialog on."""
    raw = read_json(config / 'search-folders.json', {'version': 1, 'folders': []})
    if not isinstance(raw, dict) or raw.get('version') != 1 or not isinstance(raw.get('folders'), list):
        raise ValueError('Ungültige search-folders.json. Die Datei wurde nicht verändert.')
    result, seen = [], set()
    for entry in raw['folders']:
        if not isinstance(entry, dict):
            raise ValueError('Ungültiger Suchordner-Eintrag.')
        path = clean_path(entry.get('path'))
        # Kein stillschweigendes "aus" bei Unsinn: ein beschädigter Wert wird abgelehnt (wie der Rest der Datei).
        if not isinstance(entry.get('quickOpen', False), bool):
            raise ValueError(f'Ungültiger Suchordner-Eintrag: quickOpen muss true oder false sein ({path}).')
        if str(path) in seen:
            raise ValueError(f'Suchordner doppelt konfiguriert: {path}')
        seen.add(str(path))
        result.append({'path': path, 'quickOpen': entry.get('quickOpen', False)})
    return result


def folders(config):
    return [entry['path'] for entry in entries(config)]


def write_entries(config, items):
    """quickOpen is only written when on, so a file without the option stays exactly as it was."""
    write_json(config / 'search-folders.json', {'version': 1, 'folders': [
        dict({'path': str(item['path'])}, **({'quickOpen': True} if item['quickOpen'] else {})) for item in items]})


def same_folder(first, second):
    return os.path.realpath(first) == os.path.realpath(second)


def find_repos(root):
    """Git repositories at or below `root`. Returns (sorted paths, truncated).

    A folder with a .git (directory or file, so worktrees count) is a repository and is not searched
    further. Hidden and dependency folders are skipped and symlinked folders are not followed.
    """
    found, stack, visited, truncated = [], [(Path(root), 0)], 0, False
    while stack:
        directory, depth = stack.pop()
        visited += 1
        if visited > MAX_DIRS:
            truncated = True
            break
        try:
            with os.scandir(directory) as scan:
                entries = list(scan)
        except OSError:
            continue
        if any(entry.name == '.git' for entry in entries):
            found.append(str(directory))
            continue
        if depth >= MAX_DEPTH:
            continue
        for entry in entries:
            if (entry.name not in PRUNE and not entry.name.startswith('.')
                    and entry.is_dir(follow_symlinks=False)):
                stack.append((Path(entry.path), depth + 1))
    return sorted(set(found)), truncated


def listing(config):
    """Every folder with how many repositories it holds right now (a fresh scan, no cache)."""
    result = []
    quick = {str(entry['path']): entry['quickOpen'] for entry in entries(config)}
    for path in folders(config):
        exists = path.is_dir()
        repos, truncated = find_repos(path) if exists else ([], False)
        result.append({'path': str(path), 'exists': exists, 'repos': len(repos), 'truncated': truncated,
                       'quickOpen': quick[str(path)]})
    return result


def add_folder(config, value):
    path = clean_path(value)
    if not path.is_dir():
        raise ValueError(f'Das ist kein Ordner: {path}')
    known = entries(config)
    if any(same_folder(path, item['path']) for item in known):
        raise ValueError(f'Dieser Ordner wird schon durchsucht: {path}')
    write_entries(config, known + [{'path': path, 'quickOpen': False}])
    repos, truncated = find_repos(path)
    return {'path': str(path), 'repos': len(repos), 'truncated': truncated}


def remove_folder(config, value):
    path = clean_path(value)
    known = entries(config)
    kept = [item for item in known if not same_folder(path, item['path'])]
    if len(kept) == len(known):
        raise ValueError(f'Dieser Ordner ist kein Suchordner: {path}')
    write_entries(config, kept)


def set_quick_open(config, value, enabled):
    """Switch "open the repositories of this folder" on or off for one search folder. Other folders stay as they are."""
    path = clean_path(value)
    known = entries(config)
    match = [item for item in known if same_folder(path, item['path'])]
    if not match:
        raise ValueError(f'Dieser Ordner ist kein Suchordner: {path}')
    if match[0]['quickOpen'] != enabled:
        match[0]['quickOpen'] = enabled
        write_entries(config, known)
    return {'path': str(match[0]['path']), 'quickOpen': enabled}


def discover(config):
    """`name<TAB>path` for every repository below every existing search folder, like remote-hosts.py."""
    seen, lines = set(), []
    for path in folders(config):
        if not path.is_dir():
            continue
        for repo in find_repos(path)[0]:
            real = os.path.realpath(repo)
            if real not in seen:
                seen.add(real)
                lines.append(f'{Path(repo).name}\t{repo}')
    return lines


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ('add', 'remove'):
        command = commands.add_parser(name)
        command.add_argument('config', type=Path)
        command.add_argument('path')
    for name in ('list', 'discover'):
        commands.add_parser(name).add_argument('config', type=Path)
    quick = commands.add_parser('quick')
    quick.add_argument('config', type=Path)
    quick.add_argument('path')
    quick.add_argument('mode', choices=['on', 'off'])
    args = parser.parse_args()
    if args.command == 'add':
        print(json.dumps(add_folder(args.config, args.path), ensure_ascii=False))
    elif args.command == 'remove':
        remove_folder(args.config, args.path)
    elif args.command == 'quick':
        print(json.dumps(set_quick_open(args.config, args.path, args.mode == 'on'), ensure_ascii=False))
    elif args.command == 'list':
        print(json.dumps(listing(args.config), ensure_ascii=False))
    else:
        lines = discover(args.config)
        if lines:
            print('\n'.join(lines))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError) as error:
        print(f'Suchordner: {error}', file=sys.stderr)
        sys.exit(1)
