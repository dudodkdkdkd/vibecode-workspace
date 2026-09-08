"""No launchd, pmset mutations, apps or real caffeinate processes in these tests."""
import datetime as dt
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock

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
        self.c.update(enabled=True, open_control_terminal=False, apps=[])
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
        self.c.update(apps=['Codex', 'Claude'], keep_awake=False)
        r.write('config.json', self.c)
        now = self.ts(8, 18, 59)
        loops = [now, self.ts(8, 19)]
        def advance(_):
            if len(loops) > 1:
                loops.pop(0)
            else:
                raise KeyboardInterrupt
        with patch.object(r.time, 'time', side_effect=lambda: loops[0]), \
             patch.object(r.time, 'sleep', side_effect=advance), \
             patch.object(r, 'app_running', return_value=True), \
             patch.object(r, 'quit_apps') as quit_apps:
            with self.assertRaises(KeyboardInterrupt):
                r.controller()
        quit_apps.assert_called_once_with(['Codex', 'Claude'])

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
             patch.object(r, 'terminal') as terminal:
            with self.assertRaises(KeyboardInterrupt):
                r.controller()
            terminal.assert_called_once()


if __name__ == '__main__':
    unittest.main()
