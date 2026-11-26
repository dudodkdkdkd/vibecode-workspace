#!/usr/bin/env python3
"""Ollama models for the VibeCode window: what is installed, what could be downloaded, remove and download.

    models.py list           JSON for the window (reads files only: no `ollama` call, no network, fast enough for every redraw)
    models.py check NAME     is NAME a valid model name and is Ollama there? (no side effects; the window asks before opening a Terminal)
    models.py remove NAME    `ollama rm NAME` for an installed model
    models.py pull NAME      `ollama pull NAME` (replaces this process, so a Terminal shows the download progress)

Installed models come from the manifests Ollama keeps on disk (${OLLAMA_MODELS:-~/.ollama/models}/manifests), the same place
launcher.zsh reads. "Not downloaded" are the models the Local Dev configuration names plus a short suggestion list
(ollama-suggestions.json); there is no library API to ask, so any other model is downloaded by typing its name.

Standard library only (Python 3.9 is enough). Reads the same local-ai.json as launcher.zsh (LOCAL_DEV_CONFIG_FILE overrides it).
"""
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXTRA_BIN_DIRS = ('/opt/homebrew/bin', '/usr/local/bin', '/Applications/Ollama.app/Contents/Resources')
# registry/namespace/model:tag. No leading "-" (it would be read as an option), no "..", no spaces or control characters.
MODEL_NAME = re.compile(r'[A-Za-z0-9][A-Za-z0-9._/-]{0,150}(?::[A-Za-z0-9][A-Za-z0-9._-]{0,60})?')
DEFAULT_ENDPOINT = ('127.0.0.1', 11434)
REMOVE_TIMEOUT = 60
MAX_MISSING = 30


def config_path():
    configured = os.environ.get('LOCAL_DEV_CONFIG_FILE')
    if configured:
        return Path(configured).expanduser()
    own = HERE / 'local-ai.json'
    return own if own.exists() else HERE / 'local-ai.example.json'


def read_json(path):
    try:
        value = json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def ollama_provider():
    """(id, profile) of the first configured provider of type ollama, or (None, {})."""
    providers = (read_json(config_path()) or {}).get('providers')
    for provider_id, profile in (providers.items() if isinstance(providers, dict) else []):
        if isinstance(profile, dict) and profile.get('type') == 'ollama':
            return provider_id, profile
    return None, {}


def resolve_executable(command):
    expanded = os.path.expanduser(command or 'ollama')
    if '/' in expanded:
        return expanded if os.access(expanded, os.X_OK) and os.path.isfile(expanded) else None
    return shutil.which(expanded) or shutil.which(expanded, path=os.pathsep.join(EXTRA_BIN_DIRS))


def manifest_root():
    return Path(os.environ.get('OLLAMA_MODELS') or Path.home() / '.ollama' / 'models').expanduser() / 'manifests'


def model_name(parts):
    """Manifest path below manifests/ (host, namespace, model, tag) -> the name you type: qwen2.5-coder:7b."""
    host, namespace, model, tag = parts
    if host == 'registry.ollama.ai':
        return f'{model}:{tag}' if namespace == 'library' else f'{namespace}/{model}:{tag}'
    return f'{host}/{namespace}/{model}:{tag}'


def manifest_size(path):
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        layers = data.get('layers') if isinstance(data, dict) else None
        total = sum(layer['size'] for layer in (layers or []) if isinstance(layer, dict) and isinstance(layer.get('size'), int))
        config = data.get('config') if isinstance(data, dict) else None
        if isinstance(config, dict) and isinstance(config.get('size'), int):
            total += config['size']
        return total
    except (OSError, ValueError, TypeError):
        return 0


def installed_models():
    root = manifest_root()
    found = []
    try:
        files = [path for path in root.glob('*/*/*/*') if path.is_file()]
    except OSError:
        return found
    for path in files:
        name = model_name(path.relative_to(root).parts)
        if not MODEL_NAME.fullmatch(name):
            continue
        try:
            modified = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        except OSError:
            modified = ''
        found.append({'name': name, 'size': manifest_size(path), 'modified': modified})
    return sorted(found, key=lambda model: model['name'].casefold())


def suggestions():
    data = read_json(HERE / 'ollama-suggestions.json') or {}
    entries = data.get('models') if isinstance(data.get('models'), list) else []
    return [entry for entry in entries if isinstance(entry, dict) and isinstance(entry.get('name'), str)
            and MODEL_NAME.fullmatch(entry['name']) and isinstance(entry.get('note', ''), str)]


def listing():
    provider_id, profile = ollama_provider()
    if provider_id is None:
        return {'available': False}
    installed = installed_models()
    have = {model['name'] for model in installed}
    missing = []
    configured = profile.get('default_model')
    if isinstance(configured, str) and MODEL_NAME.fullmatch(configured) and configured not in have:
        missing.append({'name': configured, 'why': 'eingestellt'})
    for entry in suggestions():
        if entry['name'] not in have and not any(item['name'] == entry['name'] for item in missing):
            missing.append({'name': entry['name'], 'why': 'Vorschlag', 'note': entry.get('note', '')[:60]})
    return {'available': True, 'provider': provider_id, 'providerName': str(profile.get('name') or provider_id)[:60],
            'cli': resolve_executable(profile.get('server_command')) is not None,
            'models': installed, 'missing': missing[:MAX_MISSING]}


def endpoint_env(profile):
    host = profile.get('host') if isinstance(profile.get('host'), str) and profile.get('host') else DEFAULT_ENDPOINT[0]
    port = profile.get('port') if type(profile.get('port')) is int else DEFAULT_ENDPOINT[1]
    return dict(os.environ, OLLAMA_HOST=f'{host}:{port}')


def checked_name(name):
    if not isinstance(name, str) or not MODEL_NAME.fullmatch(name) or '..' in name:
        raise ValueError('Ungültiger Modellname. Erlaubt sind Buchstaben, Ziffern und . _ - / :, zum Beispiel qwen2.5-coder:7b.')
    return name


def cli_for(profile):
    cli = resolve_executable(profile.get('server_command'))
    if cli is None:
        raise ValueError('Ollama wurde nicht gefunden. Installiere Ollama (ollama.com) oder prüfe den Eintrag server_command.')
    return cli


def remove(name):
    name = checked_name(name)
    provider_id, profile = ollama_provider()
    if provider_id is None:
        raise ValueError('In der Local-Dev-Konfiguration ist kein Ollama-Anbieter eingetragen.')
    if name not in {model['name'] for model in installed_models()}:
        raise ValueError(f'„{name}“ ist nicht installiert.')
    try:
        result = subprocess.run([cli_for(profile), 'rm', name], capture_output=True, text=True, timeout=REMOVE_TIMEOUT,
                                stdin=subprocess.DEVNULL, env=endpoint_env(profile))
    except subprocess.TimeoutExpired:
        raise ValueError('Ollama antwortet nicht. Läuft der Ollama-Dienst?') from None
    if result.returncode:
        reason = (result.stderr or result.stdout).strip().splitlines()
        raise ValueError(f'Ollama konnte „{name}“ nicht entfernen: {reason[-1] if reason else f"Status {result.returncode}"}')
    return f'„{name}“ wurde entfernt.'


def prepared(name):
    name = checked_name(name)
    provider_id, profile = ollama_provider()
    if provider_id is None:
        raise ValueError('In der Local-Dev-Konfiguration ist kein Ollama-Anbieter eingetragen.')
    return name, cli_for(profile), endpoint_env(profile)


def pull(name):
    name, cli, env = prepared(name)
    os.execve(cli, [cli, 'pull', name], env)


def main(argv):
    try:
        if argv[:1] == ['list'] and len(argv) == 1:
            print(json.dumps(listing(), ensure_ascii=False))
        elif argv[:1] == ['check'] and len(argv) == 2:
            prepared(argv[1])
            print('ok')
        elif argv[:1] == ['remove'] and len(argv) == 2:
            print(remove(argv[1]))
        elif argv[:1] == ['pull'] and len(argv) == 2:
            pull(argv[1])
        else:
            print('Aufruf: models.py list | check NAME | remove NAME | pull NAME', file=sys.stderr)
            return 2
    except ValueError as exc:
        print(f'× {exc}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
