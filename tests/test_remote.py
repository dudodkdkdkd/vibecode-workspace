"""No launchd, pmset mutations, apps or real caffeinate processes in these tests."""
import datetime as dt
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock, call

spec = importlib.util.spec_from_file_location('remote', Path(__file__).resolve().parents[1] / 'remote.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


class RemoteTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = patch.object(r, 'BASE', Path(self.tmp.name))
        self.base.start()
        self.addCleanup(self.base.stop)
        self.c = r.config()
        self.c.update(enabled=True, keep_awake=True, open_control_terminal=False, apps=[])
        r.write('config.json', self.c)

    def ts(self, day, hour, minute=0):
        return dt.datetime(2026, 9, day, hour, minute).timestamp()

    def test_boundaries_and_weekend(self):
        self.assertEqual(r.window(self.c, {}, self.ts(8, 13)), 0)
        self.assertEqual(r.window(self.c, {}, self.ts(8, 14)), self.ts(8, 19))
        self.assertEqual(r.window(self.c, {}, self.ts(8, 19)), 0)
        self.assertEqual(r.window(self.c, {}, self.ts(12, 14)), 0)

    def test_overnight(self):
        self.c.update(start='23:00', duration='5h')
        self.assertEqual(r.window(self.c, {}, self.ts(12, 2)), self.ts(12, 4))

    def test_stop_skips_current_but_not_next_slot(self):
        with patch.object(r.time, 'time', return_value=self.ts(8, 15)):
            r.stop()
        state = r.read('request.json')
        self.assertEqual(r.window(self.c, state, self.ts(8, 16)), 0)
        self.assertEqual(r.window(self.c, state, self.ts(9, 14)), self.ts(9, 19))

    def test_disabled_and_manual(self):
        now = self.ts(12, 14)
        self.assertEqual(r.window(self.c, {'manual_until': now + 60}, now), now + 60)
        self.assertEqual(r.window(self.c, {'manual_until': now + 60, 'disabled': True}, now), 0)
        self.assertEqual(r.window(self.c, {'manual_on': True}, now), r.MANUAL_END)
        self.c['keep_awake'] = False
        self.assertEqual(r.window(self.c, {'manual_on': True}, now), 0)

    def test_validation(self):
        for v in ['0h', '-5h', '25h', '1.5h', '1h;echo bad']:
            with self.assertRaises(ValueError):
                r.duration(v)
        self.assertEqual(r.duration('90m'), 5400)
        self.c['keep_awake'] = 'false'
        r.write('config.json', self.c)
        with self.assertRaises(ValueError):
            r.config()

    def test_foreign_repeat_never_modified(self):
        with patch.object(r, 'repeat_settings', return_value={'RepeatingPowerOn': {'time': 1}}), \
             patch.object(r.subprocess, 'run') as command:
            with self.assertRaises(ValueError):
                r.wake_plan(self.c)
            command.assert_not_called()

    def test_cancel_only_owned_repeat(self):
        owned = {'RepeatingPowerOn': {'time': 840}}
        r.write('wake.json', owned)
        with patch.object(r, 'repeat_settings', return_value=owned), \
             patch.object(r.subprocess, 'run') as command:
            r.wake_plan(self.c, remove=True)
            command.assert_called_once_with(['sudo', '/usr/bin/pmset', 'repeat', 'cancel'], check=True)
        self.assertIsNone(r.read('wake.json'))

    def test_controller_releases_at_end_and_bounds_caffeinate(self):
        coffee = Mock()
        coffee.poll.return_value = None
        now = self.ts(8, 18, 59)
        loops = [now, self.ts(8, 19)]
        def advance(_):
            if len(loops) > 1:
                loops.pop(0)
            else:
                raise KeyboardInterrupt
        with patch.object(r.time, 'time', side_effect=lambda: loops[0]), \
             patch.object(r.time, 'sleep', side_effect=advance), \
             patch.object(r.subprocess, 'Popen', return_value=coffee) as launch:
            with self.assertRaises(KeyboardInterrupt):
                r.controller()
        self.assertEqual(launch.call_args.args[0][0:4], ['/usr/bin/caffeinate', '-is', '-t', '60'])
        self.assertIn('-w', launch.call_args.args[0])
        coffee.terminate.assert_called_once()
        self.assertFalse(r.read('health.json')['awake'])

    def test_apps_closed_after_window_ends(self):
        self.c.update(apps=['Claude', 'Cursor'])
        r.write('config.json', self.c)
        coffee = Mock()
        coffee.poll.return_value = None
        now = self.ts(8, 18, 59)
        loops = [now, self.ts(8, 19)]
        def advance(_):
            if len(loops) > 1:
                loops.pop(0)
            else:
                raise KeyboardInterrupt
        with patch.object(r.time, 'time', side_effect=lambda: loops[0]), \
             patch.object(r.time, 'sleep', side_effect=advance), \
             patch.object(r.subprocess, 'Popen', return_value=coffee), \
             patch.object(r, 'app_running', return_value=True), \
             patch.object(r, 'quit_apps') as quit_apps:
            with self.assertRaises(KeyboardInterrupt):
                r.controller()
        quit_apps.assert_called_once_with(['Claude', 'Cursor'])
        self.assertEqual(r.read('managed-apps.json'), [])

    def test_apps_never_open_while_wake_mode_is_off(self):
        self.c.update(apps=['Codex', 'Claude'], keep_awake=False)
        r.write('config.json', self.c)
        with patch.object(r.time, 'time', return_value=self.ts(8, 15)), \
             patch.object(r.time, 'sleep', side_effect=KeyboardInterrupt), \
             patch.object(r, 'app_running') as app_running, \
             patch.object(r, 'quit_apps') as quit_apps, \
             patch.object(r.subprocess, 'Popen') as launch:
            with self.assertRaises(KeyboardInterrupt):
                r.controller()
        app_running.assert_not_called()
        quit_apps.assert_not_called()
        launch.assert_not_called()

    def test_off_cleans_persisted_apps_after_controller_restart(self):
        r.write('config.json', {'keep_awake': False, 'apps': ['Claude']})
        r.write('managed-apps.json', ['Claude'])
        with patch.object(r.time, 'sleep', side_effect=KeyboardInterrupt), \
             patch.object(r, 'quit_apps') as quit_apps:
            with self.assertRaises(KeyboardInterrupt):
                r.controller()
        quit_apps.assert_called_once_with(['Claude'])
        self.assertEqual(r.read('managed-apps.json'), [])

    def test_on_off_state_is_indefinite_and_persisted(self):
        with patch.object(r, 'install') as install:
            r.activate()
        install.assert_called_once_with()
        self.assertTrue(r.config()['keep_awake'])
        self.assertTrue(r.read('request.json')['manual_on'])
        self.assertEqual(r.window(r.config(), r.read('request.json'), self.ts(8, 15)), r.MANUAL_END)

        r.deactivate()
        self.assertFalse(r.config()['keep_awake'])
        self.assertFalse(r.read('request.json')['manual_on'])
        self.assertEqual(r.window(r.config(), r.read('request.json'), self.ts(8, 15)), 0)

    def test_control_terminal_only_changes_on_off_and_apps(self):
        self.c.update(keep_awake=False, apps=[])
        r.write('config.json', self.c)
        answers = iter(['2', '1', '2', '3', '4', 'b', 'q'])
        output = []
        with patch.object(r, 'status'):
            r.control_loop(lambda _prompt: next(answers), output.append)
        self.assertEqual(r.config()['apps'], ['Claude', 'Claude Code', 'Codex', 'OpenCode'])
        self.assertFalse(r.config()['keep_awake'])
        rendered = '\n'.join(output)
        self.assertIn('Wachhalten + Apps', rendered)
        self.assertNotIn('Zeitplan', rendered)

    def test_optional_opencode_terminal_is_started_and_closed_with_wake_mode(self):
        self.c.update(apps=['OpenCode'])
        r.write('config.json', self.c)
        handle = {'tty': '/dev/ttys999', 'token': 'a' * 32}
        coffee = Mock()
        coffee.poll.return_value = None
        loops = [self.ts(8, 18, 59), self.ts(8, 19)]

        def advance(_):
            if len(loops) > 1:
                loops.pop(0)
            else:
                raise KeyboardInterrupt

        with patch.object(r.time, 'time', side_effect=lambda: loops[0]), \
             patch.object(r.time, 'sleep', side_effect=advance), \
             patch.object(r.subprocess, 'Popen', return_value=coffee), \
             patch.object(r, 'launch_cli_platform', return_value=handle) as launch, \
             patch.object(r, 'cli_handle_alive', return_value=False), \
             patch.object(r, 'close_cli_platform') as close:
            with self.assertRaises(KeyboardInterrupt):
                r.controller()
        launch.assert_called_once_with('OpenCode')
        close.assert_called_once_with(handle)
        self.assertEqual(r.read('cli-terminals.json'), {})

    def test_stale_cli_handle_never_kills_an_unrelated_reused_tty(self):
        handle = {'tty': '/dev/ttys999', 'token': 'a' * 32}
        rows = [(123, 'ttys999', '/bin/zsh unrelated-command')]
        with patch.object(r, 'process_rows', return_value=rows), \
             patch.object(r.os, 'kill') as kill, \
             patch.object(r, 'close_terminal_tab') as close_tab:
            r.close_cli_platform(handle)
        kill.assert_not_called()
        close_tab.assert_not_called()

    def test_complete_app_quit_escalates_from_quit_to_term_and_kill(self):
        with patch.object(r, 'run') as run, \
             patch.object(r, 'app_pids', return_value=[123]), \
             patch.object(r.time, 'monotonic', side_effect=[0, 5, 5, 8]), \
             patch.object(r.os, 'kill') as kill:
            r.quit_apps(['Claude'])
        self.assertEqual(run.call_args.args[-1], 'Claude')
        self.assertEqual(kill.call_args_list,
                         [call(123, r.signal.SIGTERM), call(123, r.signal.SIGKILL)])

    def test_app_error_does_not_block_control_terminal(self):
        self.c.update(apps=['Codex', 'Claude'], open_control_terminal=True)
        r.write('config.json', self.c)
        coffee = Mock()
        coffee.poll.return_value = None
        with patch.object(r.time, 'time', return_value=self.ts(8, 15)), \
             patch.object(r.time, 'sleep', side_effect=KeyboardInterrupt), \
             patch.object(r.subprocess, 'Popen', return_value=coffee), \
             patch.object(r, 'app_running', return_value=False), \
             patch.object(r, 'run', side_effect=ValueError('app missing')), \
             patch.object(r, 'quit_apps'), \
             patch.object(r, 'terminal') as terminal:
            with self.assertRaises(KeyboardInterrupt):
                r.controller()
            terminal.assert_called_once()


if __name__ == '__main__':
    unittest.main()
