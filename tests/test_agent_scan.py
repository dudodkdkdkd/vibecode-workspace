"""Agent states from session files (core/agent_scan.py): only synthetic files in a throwaway folder, never the real ones."""
import contextlib
import importlib.util
import io
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('agent_scan', ROOT / 'core' / 'agent_scan.py')
scan = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scan)

SECRET = 'SECRET-TOKEN-0000-do-not-print'


def assistant(stop, *kinds, **extra):
    return dict({'type': 'assistant', 'cwd': '/Users/example/work/app', 'gitBranch': 'main',
                 'message': {'role': 'assistant', 'stop_reason': stop,
                             'content': [{'type': kind, 'text': SECRET, 'input': {'command': SECRET}} for kind in kinds]}}, **extra)


def user(kind='tool_result', **extra):
    content = [{'type': kind, 'content': SECRET}] if kind else SECRET
    return dict({'type': 'user', 'cwd': '/Users/example/work/app', 'gitBranch': 'main', 'message': {'role': 'user', 'content': content}}, **extra)


class AgentScanTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='vibecode-agents-'))
        self.addCleanup(lambda: __import__('shutil').rmtree(self.tmp, ignore_errors=True))
        self.claude, self.codex = self.tmp / 'claude' / 'projects', self.tmp / 'codex' / 'sessions'
        self.claude.mkdir(parents=True)
        self.codex.mkdir(parents=True)
        self.now = time.time()
        env = patch.dict(os.environ, {'VIBECODE_CLAUDE_PROJECTS': str(self.claude), 'VIBECODE_CODEX_SESSIONS': str(self.codex)})
        env.start()
        self.addCleanup(env.stop)

    def write(self, path, records, age, raw_lines=()):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('\n'.join(list(raw_lines) + [json.dumps(r) for r in records]) + '\n', encoding='utf-8')
        os.utime(path, (self.now - age, self.now - age))
        return path

    def claude_session(self, records, age, name='one', **options):
        self.write(self.claude / '-Users-example-work-app' / f'{name}.jsonl', records, age, **options)
        return [s for s in scan.scan(now=self.now) if s['agent'] == 'claude']

    def test_claude_states_follow_how_the_last_turn_ended(self):
        cases = [
            ('ready: the assistant ended its turn', [user(None), assistant('end_turn', 'text')], 400, 'ready'),
            ('working: results came back a moment ago', [assistant('tool_use', 'tool_use'), user()], 10, 'working'),
            ('stalled: results came back long ago and nothing followed', [assistant('tool_use', 'tool_use'), user()], 400, 'stalled'),
            ('working: a tool call was just made', [assistant('tool_use', 'text', 'tool_use')], 5, 'working'),
            ('tool_wait: a tool call has no answer for a while', [assistant('tool_use', 'tool_use')], 45, 'tool_wait'),
            ('stalled: a tool call without answer for ages', [assistant('tool_use', 'tool_use')], 7200, 'stalled'),
            ('working: the user just sent a prompt', [assistant('end_turn', 'text'), user(None)], 8, 'working'),
            ('ready: a cut-off answer is a finished turn', [assistant('max_tokens', 'text')], 60, 'ready'),
            ('unknown: nothing about a turn at the end', [{'type': 'file-history-snapshot', 'snapshot': {}}, {'type': 'api-request'}], 10, 'unknown'),
        ]
        for label, records, age, expected in cases:
            with self.subTest(label):
                (self.claude / '-Users-example-work-app' / 'one.jsonl').unlink(missing_ok=True)
                found = self.claude_session(records, age) if expected != 'unknown' else self.claude_session([dict(r, cwd='/Users/example/work/app') for r in records], age)
                self.assertEqual([(s['state'], s['cwd'], s['branch']) for s in found], [(expected, '/Users/example/work/app', 'main' if expected != 'unknown' else '')], label)

    def test_side_chains_do_not_decide_the_state(self):
        found = self.claude_session([assistant('end_turn', 'text'), user(isSidechain=True), assistant('tool_use', 'tool_use', isSidechain=True)], 300)
        self.assertEqual(found[0]['state'], 'ready')                      # the sub-agent's tool call is not the main turn

    def test_no_message_text_ever_reaches_the_output(self):
        self.claude_session([user(None), assistant('tool_use', 'text', 'tool_use'), user(), assistant('end_turn', 'text')], 30)
        self.write(self.codex / '2026' / '11' / '25' / 'rollout-a.jsonl',
                   [{'type': 'session_meta', 'payload': {'cwd': '/Users/example/work/app', 'git': {'branch': 'main'}, 'instructions': SECRET}},
                    {'type': 'response_item', 'payload': {'type': 'message', 'content': SECRET}},
                    {'type': 'event_msg', 'payload': {'type': 'task_complete', 'last_agent_message': SECRET}}], 20)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(scan.main(['--json']), 0)
        self.assertNotIn(SECRET, output.getvalue())
        self.assertEqual(len(json.loads(output.getvalue())['sessions']), 2)
        self.assertEqual({k for s in json.loads(output.getvalue())['sessions'] for k in s}, {'agent', 'cwd', 'branch', 'state', 'age'})

    def test_codex_states_come_from_the_last_event_about_the_turn(self):
        meta = {'type': 'session_meta', 'payload': {'cwd': '/Users/example/work/app', 'git': {'branch': 'feature'}}}
        done = [meta, {'type': 'response_item', 'payload': {'type': 'message'}}, {'type': 'event_msg', 'payload': {'type': 'task_complete'}},
                {'type': 'event_msg', 'payload': {'type': 'thread_settings_applied'}}, {'type': 'event_msg', 'payload': {'type': 'token_count'}}]
        working = done[:3] + [{'type': 'response_item', 'payload': {'type': 'function_call'}}, {'type': 'event_msg', 'payload': {'type': 'token_count'}}]
        cases = [('ready', done, 600, 'ready'), ('working', working, 12, 'working'), ('stalled', working, 600, 'stalled'),
                 ('aborted counts as ready', [meta, {'type': 'event_msg', 'payload': {'type': 'turn_aborted'}}], 100, 'ready'),
                 ('unknown', [meta, {'type': 'event_msg', 'payload': {'type': 'token_count'}}], 5, 'unknown')]
        for label, records, age, expected in cases:
            with self.subTest(label):
                self.write(self.codex / '2026' / '11' / '25' / 'rollout-x.jsonl', records, age)
                found = [s for s in scan.scan(now=self.now) if s['agent'] == 'codex']
                self.assertEqual([(s['state'], s['cwd'], s['branch']) for s in found], [(expected, '/Users/example/work/app', 'feature')], label)

    def test_old_unreadable_and_folderless_files_are_left_out(self):
        self.claude_session([assistant('end_turn', 'text')], 4 * 3600, name='old')                   # älter als die Zeitspanne
        self.write(self.claude / 'x' / 'garbage.jsonl', [], 10, raw_lines=['{kein json', '[1, 2]', '"text"'])   # nichts Lesbares: kein Ordner
        self.write(self.claude / 'x' / 'nofolder.jsonl', [{'type': 'assistant', 'message': {'stop_reason': 'end_turn', 'content': []}}], 10)
        self.write(self.codex / '2026' / '11' / '25' / 'rollout-nometa.jsonl', [{'type': 'event_msg', 'payload': {'type': 'task_complete'}}], 10)
        self.assertEqual(scan.scan(now=self.now), [])
        self.assertEqual([s['age'] for s in scan.scan(hours=6, now=self.now)], [4 * 3600])             # mit längerer Spanne ist die alte da

    def test_a_huge_file_is_read_from_its_end_and_the_cut_first_line_is_ignored(self):
        filler = [dict(user(None), padding='x' * 2000) for _ in range(200)]                             # mehr als TAIL_BYTES davor
        found = self.claude_session(filler + [assistant('end_turn', 'text')], 30)
        self.assertGreater((self.claude / '-Users-example-work-app' / 'one.jsonl').stat().st_size, scan.TAIL_BYTES)
        self.assertEqual([s['state'] for s in found], ['ready'])

    def test_roots_can_be_configured_and_a_missing_one_is_harmless(self):
        second = self.tmp / 'codex2' / 'sessions'
        meta = {'type': 'session_meta', 'payload': {'cwd': '/Users/example/work/two'}}
        self.write(second / '2026' / '11' / '25' / 'rollout-two.jsonl', [meta, {'type': 'event_msg', 'payload': {'type': 'task_complete'}}], 10)
        with patch.dict(os.environ, {'VIBECODE_CODEX_SESSIONS': os.pathsep.join([str(self.codex), str(second), str(self.tmp / 'gibt-es-nicht')])}):
            self.assertEqual([s['cwd'] for s in scan.scan(now=self.now)], ['/Users/example/work/two'])
        with patch.dict(os.environ, {'VIBECODE_CODEX_SESSIONS': '', 'VIBECODE_CLAUDE_PROJECTS': ''}):
            self.assertEqual(scan.scan(now=self.now), [])                                           # leer = nichts suchen, nicht „der Standard“

    def test_the_session_count_is_capped_and_newest_first(self):
        for n in range(5):
            self.claude_session([assistant('end_turn', 'text')], 100 + n * 10, name=f's{n}')
        found = scan.scan(limit=3, now=self.now)
        self.assertEqual([s['age'] for s in found], [100, 110, 120])

    def test_command_line_arguments_are_checked(self):
        for bad in (['--hours'], ['--hours', 'x'], ['--hours', '0'], ['--hours', '99999'], ['--limit', '-1'], ['--anders']):
            with self.subTest(bad), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(scan.main(bad), 2)
        with contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(scan.main(['--json', '--hours', '1', '--limit', '5']), 0)
        self.assertEqual(json.loads(out.getvalue()), {'sessions': []})


if __name__ == '__main__':
    unittest.main()
