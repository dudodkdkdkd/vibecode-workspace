#!/usr/bin/env python3
"""One status line for the VibeCode window: {"text", "level"}. Reads the same file as launcher.zsh."""
import json
import os
from pathlib import Path

NAMES = {'mlx': 'MLX', 'ollama': 'Ollama'}


def summary():
    path = Path(os.environ.get('LOCAL_DEV_CONFIG_FILE') or Path(__file__).resolve().parent / 'local-ai.json')
    if not path.exists():
        return {'text': 'Noch nicht eingerichtet', 'level': 'off'}
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        provider, model, framework = data['provider'], data['model'], data['framework']
        if not all(isinstance(value, str) and value for value in (provider, model, framework)):
            raise ValueError
    except (ValueError, KeyError, TypeError):
        return {'text': 'Konfiguration unlesbar: Local Dev öffnen und neu einrichten', 'level': 'warn'}
    return {'text': f'{NAMES.get(provider, provider)} · {model.rsplit("/", 1)[-1]} → {framework}', 'level': 'ok'}


if __name__ == '__main__':
    print(json.dumps(summary(), ensure_ascii=False))
