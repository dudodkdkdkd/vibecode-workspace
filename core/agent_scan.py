#!/usr/bin/env python3
"""What are the coding agents on this Mac doing? Reads the END of Claude Code and Codex session files and prints, per
session, a state estimate as JSON. It never prints message text: only agent, folder, branch, state and age.

Standard library only (Python 3.9 is enough), so the same file also runs on another Mac over SSH (`python3 - < agent_scan.py`).

States (estimates from the session files, not a live feed):
  working    the agent is producing something (the file was written to a moment ago and the turn is not finished)
  ready      the turn is finished: the agent waits for you
  tool_wait  a command was started and nothing came back yet: it runs for a while or waits for your approval
  stalled    not finished, but silent for a long time (interrupted, or the program was closed)
  unknown    nothing readable at the end of the file
"""
import json
import os
import sys
import time
from pathlib import Path

TAIL_BYTES = 262144        # the end of a session file is enough; they grow to many MB
HEAD_BYTES = 16384         # Codex keeps the folder in its first line
WORKING_FRESH = 90         # seconds a not finished session still counts as working
TOOL_WAIT = 20             # seconds after which an unanswered tool call is "runs or waits for approval"
DEFAULT_HOURS = 3.0
DEFAULT_LIMIT = 60         # at most this many files are opened per run


def search_paths(env_name, defaults):
    """Roots from the environment (os.pathsep separated, e.g. a second Codex home) or the usual places."""
    value = os.environ.get(env_name)
    return [Path(p).expanduser() for p in (value.split(os.pathsep) if value is not None else defaults) if p]


def claude_roots():
    home = Path.home()
    config = os.environ.get('CLAUDE_CONFIG_DIR')
    return search_paths('VIBECODE_CLAUDE_PROJECTS', [str(home / '.claude' / 'projects')] + ([str(Path(config) / 'projects')] if config else []))


def codex_roots():
    home = Path.home()
    codex = os.environ.get('CODEX_HOME')
    return search_paths('VIBECODE_CODEX_SESSIONS', [str(home / '.codex' / 'sessions')] + ([str(Path(codex) / 'sessions')] if codex else []))


def records_at_end(path):
    """The parsable JSON lines at the end of the file (the first, probably cut line is dropped). Unreadable lines are skipped."""
    try:
        size = path.stat().st_size
        with path.open('rb') as handle:
            handle.seek(max(0, size - TAIL_BYTES))
            data = handle.read()
    except OSError:
        return []
    lines = data.split(b'\n')
    if size > TAIL_BYTES:
        lines = lines[1:]
    out = []
    for line in lines:
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if isinstance(value, dict):
            out.append(value)
    return out


def first_record(path):
    try:
        with path.open('rb') as handle:
            line = handle.readline(HEAD_BYTES)
        value = json.loads(line)
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def content_kinds(message):
    content = message.get('content') if isinstance(message, dict) else None
    if isinstance(content, list):
        return [item.get('type') for item in content if isinstance(item, dict)]
    return ['text'] if isinstance(content, str) else []


def unfinished(age):
    return 'working' if age <= WORKING_FRESH else 'stalled'


def claude_state(records, age):
    """From the last user/assistant record: an assistant message that ended its turn is `ready`; a tool call without an answer is
    `tool_wait` once it is a while old; anything else is the model still working (or stalled)."""
    turns = [r for r in records if r.get('type') in ('user', 'assistant') and not r.get('isSidechain')]
    if not turns:
        return 'unknown'
    last = turns[-1]
    message = last.get('message') if isinstance(last.get('message'), dict) else {}
    kinds = content_kinds(message)
    if last.get('type') == 'assistant':
        if message.get('stop_reason') == 'tool_use' or 'tool_use' in kinds:
            return 'working' if age < TOOL_WAIT else ('tool_wait' if age <= WORKING_FRESH * 20 else 'stalled')
        if message.get('stop_reason') in ('end_turn', 'max_tokens', 'stop_sequence'):
            return 'ready'
    return unfinished(age)


def codex_state(records, age):
    """The last event that says something about the turn: `task_complete` / `turn_aborted` = ready, anything after it = working."""
    for record in reversed(records):
        kind = record.get('type')
        payload = record.get('payload') if isinstance(record.get('payload'), dict) else {}
        if kind in ('token_usage_record', 'session_meta', 'turn_context') or (kind == 'event_msg' and payload.get('type') in ('token_count', 'thread_settings_applied')):
            continue
        if kind == 'event_msg' and payload.get('type') in ('task_complete', 'turn_aborted'):
            return 'ready'
        return unfinished(age)
    return 'unknown'


def last_value(records, key):
    for record in reversed(records):
        if isinstance(record.get(key), str) and record[key]:
            return record[key]
    return ''


def claude_session(path, now):
    records = records_at_end(path)
    age = max(0, int(now - path.stat().st_mtime))
    return {'agent': 'claude', 'cwd': last_value(records, 'cwd'), 'branch': last_value(records, 'gitBranch'),
            'state': claude_state(records, age), 'age': age}


def codex_session(path, now):
    head = first_record(path)
    meta = head.get('payload') if isinstance(head.get('payload'), dict) else {}
    git = meta.get('git') if isinstance(meta.get('git'), dict) else {}
    age = max(0, int(now - path.stat().st_mtime))
    cwd, branch = meta.get('cwd'), git.get('branch')
    return {'agent': 'codex', 'cwd': cwd if isinstance(cwd, str) else '', 'branch': branch if isinstance(branch, str) else '',
            'state': codex_state(records_at_end(path), age), 'age': age}


def recent_files(roots, pattern, since, limit):
    found = []
    for root in roots:
        try:
            for path in root.glob(pattern):
                try:
                    mtime = path.stat().st_mtime
                except OSError:
                    continue
                if mtime >= since:
                    found.append((mtime, path))
        except OSError:
            continue
    found.sort(key=lambda item: item[0], reverse=True)
    return [path for _, path in found[:limit]]


def scan(hours=DEFAULT_HOURS, limit=DEFAULT_LIMIT, now=None):
    now = time.time() if now is None else now
    since = now - hours * 3600
    sessions = []
    for path in recent_files(claude_roots(), '*/*.jsonl', since, limit):
        sessions.append(claude_session(path, now))
    for path in recent_files(codex_roots(), '**/rollout-*.jsonl', since, limit):
        sessions.append(codex_session(path, now))
    sessions = [s for s in sessions if s['cwd']]            # without a folder it cannot be tied to a project
    sessions.sort(key=lambda s: s['age'])
    return sessions[:limit]


def main(argv):
    hours, limit = DEFAULT_HOURS, DEFAULT_LIMIT
    args = list(argv)
    while args:
        flag = args.pop(0)
        if flag == '--json':
            continue
        if flag in ('--hours', '--limit') and args:
            try:
                value = float(args.pop(0))
            except ValueError:
                value = 0
            if not 0 < value <= 24 * 14:
                print('Aufruf: agent_scan.py [--json] [--hours STUNDEN] [--limit N]', file=sys.stderr)
                return 2
            hours, limit = (value, limit) if flag == '--hours' else (hours, int(value))
            continue
        print('Aufruf: agent_scan.py [--json] [--hours STUNDEN] [--limit N]', file=sys.stderr)
        return 2
    print(json.dumps({'sessions': scan(hours, limit)}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
