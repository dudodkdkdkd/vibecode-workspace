"""Terminal lifetime without touching the user's Terminal tabs or preferences."""
import contextlib
import io
import json
import os
from pathlib import Path
import pty
import select
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from core import terminal_session as session


class TerminalSessionTests(unittest.TestCase):
    def test_each_direct_shell_entrypoint_hands_its_exact_arguments_to_the_shared_wrapper(self):
        root = Path(__file__).resolve().parents[1]
        for relative in ['workspaces/VibeCode Workspace.command', 'workspaces/Setup VibeCode Workspace.command',
                         'local-dev/launcher.zsh', 'local-dev/ollama-opencode.command', 'local-dev/reset-ollama.command']:
            with self.subTest(script=relative), tempfile.TemporaryDirectory() as directory:
                repo = Path(directory)
                script = repo / relative
                script.parent.mkdir()
                script.write_text((root / relative).read_text())
                helper = repo / 'core' / 'terminal_session.py'
                helper.parent.mkdir()
                helper.write_text('import json,os,sys; open(os.environ["TEST_OUTPUT"],"w").write(json.dumps(sys.argv[1:]))')
                output = repo / 'arguments.json'
                master, slave = pty.openpty()
                try:
                    env = dict(os.environ, TERM_PROGRAM='Apple_Terminal', TEST_OUTPUT=str(output))
                    env.pop(session.SESSION_TTY, None)
                    arguments = ["Für 'GitHub' & Co", '-x']
                    result = subprocess.run(['/bin/zsh', str(script)] + arguments, stdin=slave,
                                            capture_output=True, text=True, timeout=5, env=env)
                finally:
                    os.close(master)
                    os.close(slave)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(output.read_text()), ['/bin/zsh', str(script.resolve())] + arguments)

    def test_success_preserves_arguments_and_marks_only_its_own_tty(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'result.json'
            code = 'import json,os,sys; open(sys.argv[1],"w").write(json.dumps([sys.argv[2:],os.environ.get("VIBECODE_TERMINAL_SESSION_TTY")]))'
            values = ["Für 'GitHub' & Co", '$(touch should-not-exist)', '-x']
            with patch.object(session, 'terminal_tty', return_value='/dev/ttys999'), \
                 patch.object(session, 'schedule_close') as close:
                result = session.run_command([sys.executable, '-c', code, str(output)] + values)
            self.assertEqual(result, 0)
            self.assertEqual(json.loads(output.read_text()), [values, '/dev/ttys999'])
            close.assert_called_once_with('/dev/ttys999')

    def test_failure_keeps_the_diagnosis_and_exit_status_without_closing(self):
        for status in [7, 130]:
            with patch.object(session, 'terminal_tty', return_value='/dev/ttys999'), \
                 patch.object(session, 'schedule_close') as close, patch('builtins.input') as acknowledge, \
                 contextlib.redirect_stderr(io.StringIO()) as shown:
                code = session.run_command([sys.executable, '-c', f'raise SystemExit({status})'])
            self.assertEqual(code, status)
            close.assert_not_called()
            acknowledge.assert_called_once()
            self.assertIn(f'Exit-Code {status}', shown.getvalue())

    def test_failure_really_waits_for_acknowledgement_on_a_pseudo_terminal(self):
        master, slave = pty.openpty()
        self.addCleanup(os.close, master)
        self.addCleanup(os.close, slave)
        process = subprocess.Popen([sys.executable, str(Path(session.__file__)), sys.executable, '-c',
                                    'print("TEST-DIAGNOSE", flush=True); raise SystemExit(9)'],
                                   stdin=slave, stdout=slave, stderr=slave,
                                   env=dict(os.environ, TERM_PROGRAM='Apple_Terminal'))
        def cleanup():
            if process.poll() is None:
                process.kill()
            process.wait()
        self.addCleanup(cleanup)
        shown = b''
        deadline = time.monotonic() + 5
        while b'Zum Beenden' not in shown and time.monotonic() < deadline:
            if select.select([master], [], [], 0.1)[0]:
                shown += os.read(master, 8192)
        self.assertIn(b'TEST-DIAGNOSE', shown)
        self.assertIn(b'Zum Beenden', shown)
        self.assertIsNone(process.poll())
        os.write(master, b'\n')
        self.assertEqual(process.wait(timeout=5), 9)

    def test_pipes_and_vscode_terminals_never_close_or_wait(self):
        with patch.dict(os.environ, {'TERM_PROGRAM': 'vscode'}):
            self.assertIsNone(session.terminal_tty())
        result = subprocess.run([sys.executable, str(Path(session.__file__)), sys.executable, '-c',
                                 'print("output"); raise SystemExit(3)'],
                                stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=5,
                                env=dict(os.environ, TERM_PROGRAM='Apple_Terminal'))
        self.assertEqual(result.returncode, 3)
        self.assertEqual(result.stdout, 'output\n')
        self.assertNotIn('Zum Beenden', result.stderr)

    def test_nested_commands_share_one_wrapper_but_new_tabs_get_their_own(self):
        with patch.object(session, 'terminal_tty', return_value='/dev/ttys999'), \
             patch.object(session, 'run_command', return_value=0) as run:
            with patch.dict(os.environ, {session.SESSION_TTY: '/dev/ttys999'}):
                session.wrap_if_needed(['command'])
            run.assert_not_called()
            with patch.dict(os.environ, {session.SESSION_TTY: '/dev/ttys123'}):
                with self.assertRaises(SystemExit) as result:
                    session.wrap_if_needed(['command'])
            self.assertEqual(result.exception.code, 0)
            run.assert_called_once_with(['command'])

    @unittest.skipUnless(shutil.which('osacompile'), 'macOS AppleScript compiler required')
    def test_terminal_cleanup_script_compiles_with_the_terminal_dictionary(self):
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(['/usr/bin/osacompile', '-o', str(Path(directory) / 'close.scpt')],
                                    input=session.CLOSE_SCRIPT, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)

    @unittest.skipUnless(shutil.which('osascript'), 'macOS AppleScript required')
    def test_cleanup_closes_only_the_finished_target_window_and_preserves_shared_windows(self):
        # Run the actual AppleScript against records, never the real Terminal app.
        logic = (session.CLOSE_SCRIPT.replace('on run argv', 'on finishTab(argv)')
                 .replace('end run', 'end finishTab')
                 .replace('if application "Terminal" is not running then return', 'if false then return')
                 .replace('tell application "Terminal"', 'tell fakeTerminal')
                 .replace('in windows', 'in its testWindows').replace('tabs of terminalWindow', 'testTabs of terminalWindow')
                 .replace('delay 0.7', '-- no delay in tests').replace('delay 0.1', '-- no delay in tests'))
        prefix = '''using terms from application "Terminal"
script fakeTerminal
    property testWindows : {}
    property closedTTYs : {}
    on close targetWindow saving saveOption
        set end of closedTTYs to tty of item 1 of testTabs of targetWindow
    end close
end script
'''
        for windows, expected in [
            ('{{testTabs:{{tty:"/dev/ttys123", processes:{"zsh"}}, {tty:"/dev/ttys999", processes:{}}}}}', ''),
            ('{{testTabs:{{tty:"/dev/ttys999", processes:{}}}}}', '/dev/ttys999'),
            ('{{testTabs:{{tty:"/dev/ttys123", processes:{}}, {tty:"/dev/ttys999", processes:{"zsh"}}}}}', ''),
            ('{{testTabs:{{tty:"/dev/ttys123", processes:{}}}}}', ''),
            ('{{testTabs:{{tty:"/dev/ttys123", processes:{}}}}, {testTabs:{{tty:"/dev/ttys999", processes:{}}}}}', '/dev/ttys999'),
        ]:
            script = prefix + logic + f'''
on run
    set testWindows of fakeTerminal to {windows}
    finishTab({{"/dev/ttys999"}})
    return closedTTYs of fakeTerminal
end run
end using terms from
'''
            result = subprocess.run(['/usr/bin/osascript', '-'], input=script, capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), expected)


if __name__ == '__main__':
    unittest.main()
