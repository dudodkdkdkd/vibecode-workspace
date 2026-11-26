"""No launchd, pmset mutations, apps or real caffeinate processes in these tests."""
import contextlib
import datetime as dt
import getpass
import importlib.util
import io
import json
import os
import shlex
import socket
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch, Mock, call

spec = importlib.util.spec_from_file_location(
    'remote', Path(__file__).resolve().parents[1] / 'remote' / 'remote.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


FP = 'SHA256:' + 'A' * 43


class RemoteTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = patch.object(r, 'BASE', Path(self.tmp.name))
        self.base.start()
        self.addCleanup(self.base.stop)
        # ~/.ssh is never touched: key files, authorized_keys and known_hosts live here.
        self.ssh_dir = Path(self.tmp.name) / 'dot-ssh'
        ssh_dir = patch.object(r, 'SSH_DIR', self.ssh_dir)
        ssh_dir.start()
        self.addCleanup(ssh_dir.stop)
        # Kein echtes Tailscale: sonst stünde der echte Tailnet-Name in den join-Zeilen (wie VIBECODE_MAC_LABEL im Kern).
        tailscale = patch.dict(os.environ, {'VIBECODE_TAILSCALE': ''})
        tailscale.start()
        self.addCleanup(tailscale.stop)
        username = patch.object(r.getpass, 'getuser', return_value='user')
        username.start()
        self.addCleanup(username.stop)
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
        end = self.ts(8, 19)
        r.save_settings(keep_awake=True, switch_at=int(end))
        loops = [now, end]
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

    def test_wake_only_never_manages_or_starts_apps(self):
        r.save_settings(keep_awake=True, start_apps=False, apps=['Claude Code', 'Codex'])
        handle = {'tty': '/dev/ttys999', 'token': 'a' * 32}
        r.save_cli_handles({'Claude Code': handle})
        r.save_managed_apps({'Codex'})
        coffee = Mock()
        coffee.poll.return_value = None
        with patch.object(r.time, 'sleep', side_effect=KeyboardInterrupt), \
             patch.object(r.subprocess, 'Popen', return_value=coffee) as launch, \
             patch.object(r, 'run') as run, patch.object(r, 'launch_cli_platform') as cli, \
             patch.object(r, 'close_cli_platform') as close, patch.object(r, 'quit_apps') as quit_apps, \
             patch.object(r, 'terminal') as terminal:
            with self.assertRaises(KeyboardInterrupt):
                r.controller()
        launch.assert_called_once()
        self.assertEqual(launch.call_args.args[0][:2], ['/usr/bin/caffeinate', '-is'])
        for operation in (run, cli, close, quit_apps, terminal):
            operation.assert_not_called()
        self.assertEqual(r.cli_handles(), {'Claude Code': handle})
        self.assertEqual(r.saved_managed_apps(), {'Codex'})
        self.assertEqual(r.config()['apps'], ['Claude Code', 'Codex'])

    def test_wake_with_apps_opens_codex_desktop_and_starts_claude_code_in_terminal(self):
        r.save_settings(keep_awake=True, start_apps=True, close_apps_on_off=False, apps=['Claude Code', 'Codex'])
        handle = {'tty': '/dev/ttys999', 'token': 'a' * 32}
        with patch.object(r.time, 'sleep', side_effect=KeyboardInterrupt), \
             patch.object(r.subprocess, 'Popen', return_value=Mock(poll=Mock(return_value=None))), \
             patch.object(r, 'app_running', return_value=False), patch.object(r, 'run') as run, \
             patch.object(r, 'launch_cli_platform', return_value=handle) as cli, patch.object(r, 'terminal'):
            with self.assertRaises(KeyboardInterrupt):
                r.controller()
        run.assert_called_once_with('/usr/bin/open', '-b', 'com.openai.codex')
        cli.assert_called_once_with('Claude Code')

    def test_wake_with_apps_brings_existing_codex_forward_once_without_owning_it(self):
        r.save_settings(keep_awake=True, start_apps=True, apps=['Codex'])
        now = self.ts(8, 15)
        loops = [now, now + 60]

        def advance(_):
            if len(loops) == 1:
                raise KeyboardInterrupt
            loops.pop(0)

        with patch.object(r.time, 'time', side_effect=lambda: loops[0]), \
             patch.object(r.time, 'sleep', side_effect=advance), \
             patch.object(r.subprocess, 'Popen', return_value=Mock(poll=Mock(return_value=None))), \
             patch.object(r, 'app_running', return_value=True), patch.object(r, 'run') as run, \
             patch.object(r, 'quit_apps') as quit_apps:
            with self.assertRaises(KeyboardInterrupt):
                r.controller()
        run.assert_called_once_with('/usr/bin/open', '-b', 'com.openai.codex')
        quit_apps.assert_not_called()

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
        r.save_settings(keep_awake=False, switch_at=int(self.ts(8, 16)))
        with patch.object(r, 'install') as install:
            r.activate()
        install.assert_called_once_with()
        self.assertTrue(r.config()['keep_awake'])
        self.assertEqual(r.config()['switch_at'], 0)
        self.assertEqual(r.window(r.config(), {}, self.ts(8, 17)), r.MANUAL_END)

        r.save_settings(keep_awake=False, switch_at=int(self.ts(8, 18)))
        r.deactivate()
        self.assertFalse(r.config()['keep_awake'])
        self.assertEqual(r.config()['switch_at'], 0)
        self.assertEqual(r.window(r.config(), {}, self.ts(8, 19)), 0)

    def test_control_terminal_preserves_app_choice_when_setting_a_timer(self):
        self.c.update(keep_awake=False, apps=[])
        r.write('config.json', self.c)
        answers = iter(['2', '1', '2', '3', '4', 'b', '3', '4', '90m', 'q'])
        output = []
        now = self.ts(8, 15)
        with patch.object(r.time, 'time', return_value=now), patch.object(r, 'install'):
            r.control(lambda _prompt: next(answers), output.append)
        c = r.config()
        self.assertEqual(c['apps'], ['Claude', 'Claude Code', 'Codex', 'OpenCode'])
        self.assertFalse(c['close_apps_on_off'])
        self.assertEqual(r.window(c, {}, now), now + 5400)
        self.assertEqual(r.window(c, {}, now + 5400), 0)
        rendered = '\n'.join(output)
        self.assertIn('Timer           AUS am', rendered)
        self.assertIn('Apps bei AUS schließen (NEIN)', rendered)

    def test_control_terminal_schedules_and_cancels_a_delayed_restart(self):
        begin = self.ts(8, 15)
        with patch.object(r.time, 'time', return_value=begin), patch.object(r, 'install'):
            answers = iter(['5', '3', 'q'])
            r.control_loop(lambda _: next(answers), lambda _: None)
            c = r.config()
            end = begin + 3 * 3600
            self.assertEqual(r.window(c, {}, end - 1), 0)
            self.assertEqual(r.window(c, {}, end), r.MANUAL_END)
            self.assertEqual(r.window(c, {}, end + 3600), r.MANUAL_END)
            answers = iter(['6', 'q'])
            r.control_loop(lambda _: next(answers), lambda _: None)
        self.assertEqual(r.config()['switch_at'], 0)
        self.assertEqual(r.window(r.config(), {}, end), 0)

    def test_control_terminal_cycles_from_off_with_different_durations(self):
        begin = self.ts(8, 15)
        r.save_settings(keep_awake=False, apps=[])
        with patch.object(r.time, 'time', return_value=begin) as clock, patch.object(r, 'install'):
            answers = iter(['7', '1m', '2m', 'q'])
            r.control_loop(lambda _: next(answers), lambda _: None)

            c = r.config()
            for offset, enabled, next_offset in [(0, False, 120), (119, False, 120), (120, True, 180),
                                                  (180, False, 300), (300, True, 360), (720, False, 840)]:
                with self.subTest(offset=offset):
                    self.assertEqual(r.timer_phase(c, begin + offset), (enabled, begin + next_offset))
                    self.assertEqual(r.window(c, {}, begin + offset), begin + next_offset if enabled else 0)

            clock.return_value = begin + 300
            output = []
            answers = iter(['6', 'q'])
            r.control_loop(lambda _: next(answers), output.append)
        rendered = '\n'.join(output)
        self.assertIn('Timer           AUS am', rendered)
        self.assertIn('Automatik       AN 1 min · AUS 2 min', rendered)
        self.assertIsNone(r.config()['cycle'])
        self.assertEqual(r.window(r.config(), {}, begin + 360), r.MANUAL_END)

    def test_control_terminal_cycles_from_on_with_the_same_duration(self):
        begin = self.ts(8, 15)
        r.save_settings(keep_awake=True, apps=[])
        with patch.object(r.time, 'time', return_value=begin), patch.object(r, 'install'):
            answers = iter(['7', '90m', '', 'q'])
            r.control_loop(lambda _: next(answers), lambda _: None)
        c = r.config()
        self.assertEqual(r.timer_phase(c, begin), (True, begin + 5400))
        self.assertEqual(r.timer_phase(c, begin + 5400), (False, begin + 10800))
        self.assertEqual(r.timer_phase(c, begin + 10800), (True, begin + 16200))
        r.deactivate()
        self.assertIsNone(r.config()['cycle'])
        self.assertEqual(r.window(r.config(), {}, begin + 16200), 0)

    def test_repeated_pauses_keep_apps_and_reuse_their_cli_session(self):
        handle = {'tty': '/dev/ttys999', 'token': 'a' * 32}
        now = self.ts(8, 15)
        r.save_settings(keep_awake=False, switch_at=int(now + 60),
                        cycle={'on_seconds': 120, 'off_seconds': 60},
                        close_apps_on_off=False, apps=['Claude', 'OpenCode'])
        r.save_cli_handles({'OpenCode': handle})
        r.save_managed_apps({'Claude'})
        coffee = Mock()
        coffee.poll.return_value = None

        loops = [now, now + 60, now + 180, now + 240]
        def advance(_):
            if len(loops) == 1:
                raise KeyboardInterrupt
            loops.pop(0)

        with patch.object(r.time, 'time', side_effect=lambda: loops[0]), \
             patch.object(r.time, 'sleep', side_effect=advance), \
             patch.object(r.subprocess, 'Popen', return_value=coffee) as launch, \
             patch.object(r, 'quit_apps') as quit_apps, \
             patch.object(r, 'app_running', return_value=True), \
             patch.object(r, 'launch_cli_platform') as launch_cli, \
             patch.object(r, 'close_cli_platform') as close_cli, \
             patch.object(r, 'cli_handle_alive', return_value=True) as cli_alive:
            with self.assertRaises(KeyboardInterrupt):
                r.controller()
        quit_apps.assert_not_called()
        close_cli.assert_not_called()
        launch_cli.assert_not_called()
        self.assertEqual(cli_alive.call_args_list, [call(handle), call(handle)])
        self.assertEqual(r.cli_handles(), {'OpenCode': handle})
        self.assertEqual(r.saved_managed_apps(), {'Claude'})
        self.assertEqual([process.args[0][:4] for process in launch.call_args_list],
                         [['/usr/bin/caffeinate', '-is', '-t', '120']] * 2)

    def test_install_refreshes_an_already_loaded_controller_once_upgraded(self):
        target = f'gui/{os.getuid()}/{r.LABEL}'
        with patch.object(r, 'run', return_value=Mock(returncode=0)) as run, \
             patch.object(r, 'wake_plan') as wake_plan:
            r.install(only_if_loaded=True)
            r.write('health.json', {'version': r.CONTROLLER_VERSION})
            r.install(only_if_loaded=True)
        self.assertEqual(run.call_args_list, [
            call('/bin/launchctl', 'print', target, check=False),
            call('/bin/launchctl', 'kickstart', '-k', target),
            call('/bin/launchctl', 'print', target, check=False),
        ])
        wake_plan.assert_not_called()

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

    def test_cli_host_preserves_errors_for_the_terminal_wrapper(self):
        executable = self.ssh_dir.parent / 'test-agent'
        executable.write_text('#!/bin/sh\nexit 7\n')
        executable.chmod(0o755)
        with self.assertRaises(SystemExit) as result:
            r.main(['_cli_host', 'a' * 32, str(executable)])
        self.assertEqual(result.exception.code, 7)

    def test_claude_code_terminal_starts_remote_control(self):
        with patch.object(r, 'cli_executable', return_value='/example/claude'), \
             patch.object(r, 'cli_handle_alive', return_value=True), \
             patch.object(r, 'run', return_value=Mock(stdout='/dev/ttys999\n')) as run:
            r.launch_cli_platform('Claude Code')
        self.assertEqual(shlex.split(run.call_args.args[-1])[-2:], ['/example/claude', 'remote-control'])

    def test_automatic_control_terminal_uses_the_real_remote_entrypoint(self):
        with patch.object(r, 'control_running', return_value=False), patch.object(r, 'run') as run:
            r.terminal()
        self.assertEqual(shlex.split(run.call_args.args[-1]),
                         ['exec', sys.executable, str(r.ROOT / 'remote.py'), 'control'])

    def test_complete_app_quit_escalates_from_quit_to_term_and_kill(self):
        with patch.object(r, 'run') as run, \
             patch.object(r, 'app_pids', return_value=[123]), \
             patch.object(r.time, 'monotonic', side_effect=[0, 5, 5, 8]), \
             patch.object(r.os, 'kill') as kill:
            r.quit_apps(['Claude'])
        self.assertEqual(run.call_args.args[-1], 'Claude')
        self.assertEqual(kill.call_args_list,
                         [call(123, r.signal.SIGTERM), call(123, r.signal.SIGKILL)])

    def test_ssh_target_accepts_user_host_and_port(self):
        self.assertEqual(r.ssh_target('user@remote-mac.local', 2222),
                         {'user': 'user', 'host': 'remote-mac.local', 'port': 2222})
        self.assertEqual(r.ssh_target('192.0.2.7')['user'], '')

    def test_ssh_target_rejects_values_ssh_would_read_as_options(self):
        for value in ['-oProxyCommand=evil', 'user@-oProxyCommand=evil',
                      '-oProxyCommand=evil@host', 'user@host name', 'user@', '', '@host']:
            with self.assertRaises(ValueError, msg=value):
                r.ssh_target(value)
        for port in [0, 65536, '22', True, None]:
            with self.assertRaises(ValueError, msg=repr(port)):
                r.ssh_target('user@host', port)

    def test_ssh_set_persists_target_outside_config_json(self):
        r.write('config.json', {'keep_awake': True, 'apps': ['Claude']})
        r.ssh_set(['user@remote-mac.local', '2222'])
        self.assertEqual(r.read('ssh.json'),
                         {'user': 'user', 'host': 'remote-mac.local', 'port': 2222})
        # SSH settings must survive migration of the wake settings.
        self.assertEqual(r.read('config.json'), {'keep_awake': True, 'apps': ['Claude']})
        self.assertEqual(r.ssh_command(r.saved_ssh_target())[-1], 'user@remote-mac.local')
        with self.assertRaises(ValueError):
            r.ssh_set(['user@remote-mac.local', 'abc'])
        with self.assertRaises(ValueError):
            r.ssh_set([])

    def test_ssh_connect_hands_over_to_ssh_when_reachable(self):
        r.ssh_set(['user@remote-mac.local', '2222'])
        with patch.object(r, 'unreachable_reason', return_value=None) as reach, \
             patch.object(r.os, 'execv') as execv:
            r.ssh_connect()
        reach.assert_called_once_with('remote-mac.local', 2222)
        argv = execv.call_args.args[1]
        self.assertEqual(execv.call_args.args[0], '/usr/bin/ssh')
        self.assertEqual(argv[:3], ['/usr/bin/ssh', '-p', '2222'])
        self.assertEqual(argv[-1], 'user@remote-mac.local')

    def test_ssh_connect_explains_unreachable_mac_and_never_execs(self):
        r.ssh_set(['user@remote-mac.local'])
        with patch.object(r, 'unreachable_reason', return_value='keine Antwort innerhalb von 5 Sekunden'), \
             patch.object(r.os, 'execv') as execv:
            with self.assertRaises(ValueError) as caught:
                r.ssh_connect()
        execv.assert_not_called()
        self.assertIn('workspace remote on', str(caught.exception))
        self.assertIn('keine Antwort innerhalb von 5 Sekunden', str(caught.exception))
        self.assertNotIn('Der Name wird nicht gefunden', str(caught.exception))      # kein Namensproblem: kein Namenshinweis

    def test_the_reachability_probe_uses_apples_nc_so_names_resolve_like_they_do_for_ssh(self):
        done = lambda code, out='', err='': subprocess.CompletedProcess([], code, stdout=out, stderr=err)
        with patch.object(r.subprocess, 'run', return_value=done(0)) as run:
            self.assertIsNone(r.unreachable_reason('Example-Remote-Mac.local', 22))
        self.assertEqual(run.call_args.args[0], ['/usr/bin/nc', '-z', '-G', '5', '--', 'Example-Remote-Mac.local', '22'])
        self.assertEqual(run.call_args.kwargs['timeout'], 15)                                    # nie hängen bleiben
        for stderr, expected in [('nc: getaddrinfo: nodename nor servname provided, or not known\n',
                                  'getaddrinfo: nodename nor servname provided, or not known'),
                                 ('nc: connectx to h port 22 (tcp) failed: Connection refused\n', 'connectx to h port 22 (tcp) failed: Connection refused'),
                                 ('', 'keine Antwort innerhalb von 5 Sekunden')]:          # nc -z meldet einen Zeitablauf nicht
            with patch.object(r.subprocess, 'run', return_value=done(1, err=stderr)):
                self.assertEqual(r.unreachable_reason('h', 22), expected)
        for failure in (subprocess.TimeoutExpired('nc', 15), FileNotFoundError('/usr/bin/nc')):
            with patch.object(r.subprocess, 'run', side_effect=failure):
                self.assertTrue(r.unreachable_reason('h', 22))                                   # ein Grund, kein Absturz

    def test_the_probe_really_connects_to_an_open_port_and_reports_a_closed_one(self):
        with socket.socket() as server:
            server.bind(('127.0.0.1', 0))
            server.listen()
            self.assertIsNone(r.unreachable_reason('127.0.0.1', server.getsockname()[1]))
            port = server.getsockname()[1]
        self.assertIsNotNone(r.unreachable_reason('127.0.0.1', port))                           # jetzt geschlossen
        self.assertIn('nodename nor servname', r.unreachable_reason('gibt-es-nicht.invalid', 22))

    def test_an_unknown_name_says_what_to_do_and_names_tailscale(self):
        r.ssh_set(['user@remote-mac.local'])
        with patch.object(r, 'unreachable_reason', return_value='getaddrinfo: nodename nor servname provided, or not known'):
            with self.assertRaises(ValueError) as caught:
                r.ssh_require_reachable(r.saved_ssh_target())
        text = str(caught.exception)
        self.assertIn('remote-mac.local:22 nicht erreichbar', text)
        self.assertIn('Der Name wird nicht gefunden', text)
        self.assertIn('Tailscale', text)
        self.assertIn('100.x-Adresse', text)

    def test_ssh_run_is_a_non_interactive_one_shot(self):
        r.ssh_set(['user@remote-mac.local', '2222'])
        with patch.object(r, 'unreachable_reason', return_value=None), patch.object(r.os, 'execv') as execv:
            r.main(['ssh', 'run', '--', 'uname', '-a'])
            run_argv = execv.call_args.args[1]
            r.main(['ssh'])
            login_argv = execv.call_args.args[1]
        self.assertIn('BatchMode=yes', run_argv)
        self.assertEqual(run_argv[-2:], ['user@remote-mac.local', 'uname -a'])
        # The interactive login must keep allowing a password / host-key prompt.
        self.assertNotIn('BatchMode=yes', login_argv)
        self.assertEqual(login_argv[-1], 'user@remote-mac.local')

    def test_ssh_run_needs_a_command(self):
        r.ssh_set(['user@remote-mac.local'])
        with patch.object(r, 'unreachable_reason', return_value=None), patch.object(r.os, 'execv') as execv:
            for words in (['ssh', 'run'], ['ssh', 'run', '--'], ['ssh', 'run', '  ']):
                with self.assertRaises(ValueError, msg=repr(words)):
                    r.main(words)
        execv.assert_not_called()

    def test_ssh_pair_installs_the_key_with_the_saved_port(self):
        r.ssh_set(['user@remote-mac.local', '2222'])
        with patch.object(r, 'unreachable_reason', return_value=None), patch.object(r.os, 'execv') as execv:
            r.main(['ssh', 'pair'])
            execv.assert_called_once_with(
                '/usr/bin/ssh-copy-id',
                ['/usr/bin/ssh-copy-id', '-p', '2222', 'user@remote-mac.local'])
            with self.assertRaises(ValueError):
                r.main(['ssh', 'pair', 'extra'])

    def test_ssh_run_and_pair_never_exec_when_unreachable(self):
        r.ssh_set(['user@remote-mac.local'])
        with patch.object(r, 'unreachable_reason', return_value='down'), \
             patch.object(r.os, 'execv') as execv:
            for words in (['ssh', 'run', '--', 'true'], ['ssh', 'pair'], ['ssh']):
                with self.assertRaises(ValueError, msg=repr(words)):
                    r.main(words)
        execv.assert_not_called()

    def test_ssh_connect_requires_a_saved_target_and_rejects_corrupt_one(self):
        with self.assertRaisesRegex(ValueError, 'ssh join'):
            r.saved_ssh_target()
        for bad in [{'host': '-oProxyCommand=evil'}, {'host': 5}, ['host'], {'host': 'h', 'port': 0}]:
            r.write('ssh.json', bad)
            with self.assertRaises(ValueError, msg=repr(bad)):
                r.saved_ssh_target()

    def test_ssh_info_reports_login_and_wake_state_with_next_steps(self):
        lines = []
        with patch.object(r, 'ssh_listening', return_value=False), \
             patch.object(r, 'wake_active', return_value=False):
            self.assertEqual(r.ssh_info(lines.append), '')
        text = '\n'.join(lines)
        self.assertIn('Entfernte Anmeldung  AUS', text)
        self.assertIn('ssh share --wake', text)
        self.assertNotIn('ssh join', text)   # nothing to join while Remote Login is off
        lines.clear()
        with patch.object(r, 'ssh_listening', return_value=True), \
             patch.object(r, 'wake_active', return_value=True), \
             patch.object(r, 'host_fingerprint', return_value=FP):
            line = r.ssh_info(lines.append)
        text = '\n'.join(lines)
        self.assertIn('AN (Port 22)', text)
        self.assertNotIn('Aktivieren', text)
        self.assertNotIn('share --wake', text)
        self.assertTrue(line.startswith('workspace remote ssh join ' + getpass.getuser() + '@'))
        self.assertTrue(line.endswith(' ' + FP))

    # --- Freigeben (Remote-Mac) / Zugriff holen (Client-Mac) ---------------------------------

    def make_key(self, name='id_ed25519', comment='user@client'):
        """A real throwaway key pair in the isolated ssh dir; returns the public key line."""
        self.ssh_dir.mkdir(exist_ok=True)
        path = self.ssh_dir / name
        subprocess.run(['/usr/bin/ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-C', comment,
                        '-f', str(path)], check=True)
        return path.with_name(name + '.pub').read_text().strip()

    def out(self, function, *args):
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            function(*args)
        return buffer.getvalue()

    def test_public_key_validation_accepts_only_a_plain_key_line(self):
        key = self.make_key()
        line, fingerprint = r.checked_public_key(key + '\n')
        self.assertEqual(line, key)
        self.assertRegex(fingerprint, r'^SHA256:[A-Za-z0-9+/]{43}$')
        blob = key.split()[1]
        for bad in ['command="touch /tmp/pwned" ' + key,       # authorized_keys option smuggling
                    'from="*" ' + key,
                    '-----BEGIN OPENSSH PRIVATE KEY-----',
                    key + '\n' + key,                           # two lines
                    'ssh-ed25519 AAAAnonsense',                 # right shape, not a key
                    key + ' \x07', 'ssh-ed25519', '', '   ',
                    'sk-ssh-ed25519@openssh.com ' + blob]:
            with self.assertRaises(ValueError, msg=repr(bad)):
                r.checked_public_key(bad)

    def test_allow_appends_with_owner_only_permissions_and_never_duplicates(self):
        key = self.make_key(comment='user@client')
        shutil.rmtree(self.ssh_dir)          # first run on a Mac without ~/.ssh: allow creates it
        keys = self.ssh_dir / 'authorized_keys'
        shown = self.out(r.ssh_allow, [key, '--yes'])
        self.assertIn('user@client', shown)
        self.assertIn('Fingerprint: SHA256:', shown)
        self.assertEqual(keys.read_text(), key + '\n')
        self.assertEqual(stat.S_IMODE(keys.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.ssh_dir.stat().st_mode), 0o700)
        self.assertIn('Schon freigegeben', self.out(r.ssh_allow, [key, '--yes']))
        self.assertEqual(keys.read_text().count(key), 1)

    def test_allow_keeps_existing_keys_even_without_trailing_newline(self):
        key = self.make_key()
        self.ssh_dir.mkdir(exist_ok=True)
        (self.ssh_dir / 'authorized_keys').write_text('ssh-ed25519 AAAAexisting old@host')
        self.out(r.ssh_allow, ['--yes'] + key.split(' ', 2))   # key may arrive as several words
        self.assertEqual((self.ssh_dir / 'authorized_keys').read_text(),
                         'ssh-ed25519 AAAAexisting old@host\n' + key + '\n')

    def test_revoke_removes_only_the_selected_plain_key_and_preserves_other_lines(self):
        selected = self.make_key(comment='user@client')
        other = self.make_key('other_key', 'user@other')
        fingerprint = r.checked_public_key(selected)[1]
        other_fp = r.checked_public_key(other)[1]
        keys = self.ssh_dir / 'authorized_keys'
        header = b'# Local comment\r\n\n'
        restricted = f'from="192.0.2.5" {selected}\r\n'.encode()
        original = header + (selected + '\r\n').encode() + restricted + (selected + '\n' + other).encode()
        keys.write_bytes(original)
        keys.chmod(0o640)

        self.assertEqual(json.loads(self.out(r.ssh_access)), [
            {'name': 'user@client', 'fingerprint': fingerprint},
            {'name': 'user@other', 'fingerprint': other_fp},
        ])
        with self.assertRaisesRegex(ValueError, 'Bestätigung'):
            r.ssh_revoke([fingerprint])
        self.assertEqual(keys.read_bytes(), original)

        self.assertIn('widerrufen', self.out(r.ssh_revoke, ['--yes', fingerprint]))
        expected = header + restricted + other.encode()
        self.assertEqual(keys.read_bytes(), expected)
        self.assertEqual(stat.S_IMODE(keys.stat().st_mode), 0o640)
        self.assertEqual(json.loads(self.out(r.ssh_access)), [{'name': 'user@other', 'fingerprint': other_fp}])
        self.assertIn('bereits entfernt', self.out(r.ssh_revoke, ['--yes', fingerprint]))
        self.assertEqual(keys.read_bytes(), expected)

    def test_allow_refuses_without_confirmation_and_rejects_smuggled_options(self):
        key = self.make_key()
        keys = self.ssh_dir / 'authorized_keys'
        with patch.object(r.sys, 'stdin', Mock(isatty=lambda: False)):
            with self.assertRaisesRegex(ValueError, '--yes'):
                self.out(r.ssh_allow, [key])
        with patch.object(r.sys, 'stdin', Mock(isatty=lambda: True)), \
             patch('builtins.input', return_value='n'):
            with self.assertRaisesRegex(ValueError, 'Abgebrochen'):
                self.out(r.ssh_allow, [key])
        with self.assertRaises(ValueError):
            self.out(r.ssh_allow, ['command="rm -rf ~" ' + key, '--yes'])
        self.assertFalse(keys.exists())
        with patch.object(r.sys, 'stdin', Mock(isatty=lambda: True)), \
             patch('builtins.input', return_value='j'):
            self.out(r.ssh_allow, [key])
        self.assertEqual(keys.read_text(), key + '\n')

    def fake_host(self, known=False, scan=True):
        """Replace ssh-keygen -F / ssh-keyscan; returns (host key line, its fingerprint)."""
        for name in ('host_key', 'host_key.pub'):
            (self.ssh_dir / name).unlink(missing_ok=True)               # ssh-keygen would ask before overwriting and wait forever
        host_key = self.make_key('host_key', 'root@remote-mac')
        kind, blob = host_key.split()[:2]

        def fake_run(*args, check=True):
            if args[1] == '-F':
                return Mock(returncode=0 if known else 1, stdout='')
            return Mock(returncode=0, stdout=f'127.0.0.1 {kind} {blob}\n' if scan else '')
        patcher = patch.object(r, 'run', side_effect=fake_run)
        patcher.start()
        self.addCleanup(patcher.stop)
        return f'127.0.0.1 {kind} {blob}', r.keygen_fingerprint(f'{kind} {blob}')

    def test_join_pins_the_host_key_only_when_the_fingerprint_matches(self):
        entry, fingerprint = self.fake_host()
        target = r.ssh_target('user@127.0.0.1')
        known_hosts = self.ssh_dir / 'known_hosts'
        with self.assertRaisesRegex(ValueError, 'NICHT'):
            r.pin_host_key(target, FP)
        self.assertFalse(known_hosts.exists())
        r.pin_host_key(target, fingerprint)
        self.assertEqual(known_hosts.read_text(), entry + '\n')
        self.assertEqual(stat.S_IMODE(known_hosts.stat().st_mode), 0o600)

    def test_join_never_overrides_an_already_known_host_key(self):
        self.fake_host(known=True)
        r.pin_host_key(r.ssh_target('user@127.0.0.1'), FP)   # wrong fingerprint, but host is known
        self.assertFalse((self.ssh_dir / 'known_hosts').exists())

    def test_join_fails_when_the_host_key_cannot_be_read(self):
        self.fake_host(scan=False)
        with self.assertRaisesRegex(ValueError, 'gelesen'):
            r.pin_host_key(r.ssh_target('user@127.0.0.1'), FP)

    def test_join_saves_target_pins_key_and_confirms_the_login(self):
        probe = Mock(returncode=0, stderr='')
        with patch.object(r, 'ssh_require_reachable') as reachable, \
             patch.object(r, 'pin_host_key') as pin, \
             patch.object(r.subprocess, 'run', return_value=probe) as ssh:
            shown = self.out(r.ssh_join, ['user@remote-mac.local', FP, '2222'])
        target = {'user': 'user', 'host': 'remote-mac.local', 'port': 2222}
        reachable.assert_called_once_with(target)
        pin.assert_called_once_with(target, FP)
        self.assertEqual(r.read('ssh.json'), target)
        self.assertIn('✔ Verbunden', shown)
        argv = ssh.call_args.args[0]
        self.assertIn('BatchMode=yes', argv)
        self.assertEqual(argv[-2:], ['user@remote-mac.local', 'true'])

    def test_join_without_arguments_rechecks_the_saved_target(self):
        r.ssh_set(['user@remote-mac.local'])
        with patch.object(r, 'ssh_require_reachable'), patch.object(r, 'pin_host_key') as pin, \
             patch.object(r.subprocess, 'run', return_value=Mock(returncode=0, stderr='')):
            self.assertIn('✔ Verbunden', self.out(r.ssh_join, []))
        pin.assert_not_called()

    def test_join_not_yet_allowed_prints_the_allow_line_and_exits_2(self):
        key = self.make_key(comment='user@client')
        denied = Mock(returncode=255, stderr='user@h: Permission denied (publickey).\n')
        with patch.object(r, 'ssh_require_reachable'), \
             patch.object(r.subprocess, 'run', return_value=denied), \
             patch.object(r, 'keygen_fingerprint', return_value=FP), \
             patch.object(r, 'clipboard', return_value=True) as clip:
            with self.assertRaises(SystemExit) as caught:
                shown = io.StringIO()
                with contextlib.redirect_stdout(shown):
                    r.ssh_join(['user@remote-mac.local'])
        self.assertEqual(caught.exception.code, 2)
        text = shown.getvalue()
        line = f"workspace remote ssh allow '{key}'"
        self.assertIn(line, text)
        self.assertIn(FP, text)
        self.assertIn('ssh-add --apple-use-keychain ' + str(self.ssh_dir / 'id_ed25519'), text)
        clip.assert_called_once_with(line)

    def test_join_explains_host_key_and_other_failures(self):
        for stderr, expected in [('Host key verification failed.\n', 'share'),
                                 ('ssh: connect to host x: Connection reset\n', 'Connection reset')]:
            with patch.object(r, 'ssh_require_reachable'), \
                 patch.object(r.subprocess, 'run', return_value=Mock(returncode=255, stderr=stderr)):
                with self.assertRaisesRegex(ValueError, expected):
                    self.out(r.ssh_join, ['user@remote-mac.local'])

    def test_join_rejects_bad_arguments_before_touching_the_network(self):
        with patch.object(r, 'ssh_require_reachable') as reachable:
            for args in (['user@h', 'nonsense'], ['user@h', 'SHA256:short'], ['-oProxyCommand=x']):
                with self.assertRaises(ValueError, msg=repr(args)):
                    self.out(r.ssh_join, args)
        reachable.assert_not_called()
        self.assertIsNone(r.read('ssh.json'))

    def test_share_opens_settings_when_remote_login_is_off(self):
        with patch.object(r, 'ssh_listening', return_value=False), \
             patch.object(r, 'wake_active', return_value=True), \
             patch.object(r, 'run', return_value=Mock(stdout='Remote-Mac\n')) as run, \
             patch.object(r, 'clipboard') as clip:
            shown = self.out(r.ssh_share, [])
        run.assert_any_call('/usr/bin/open', r.SHARING_PANE, check=False)
        clip.assert_not_called()
        self.assertIn('Entfernte Anmeldung', shown)

    def test_share_copies_the_join_line_with_fingerprint_when_ready(self):
        with patch.object(r, 'ssh_listening', return_value=True), \
             patch.object(r, 'wake_active', return_value=True), \
             patch.object(r, 'host_fingerprint', return_value=FP), \
             patch.object(r, 'run', return_value=Mock(stdout='Remote-Mac\n')) as run, \
             patch.object(r, 'clipboard', return_value=True) as clip:
            shown = self.out(r.ssh_share, [])
        line = f'workspace remote ssh join {getpass.getuser()}@Remote-Mac.local {FP}'
        clip.assert_called_once_with(line)
        self.assertIn(line, shown)
        self.assertIn('Zwischenablage', shown)
        self.assertNotIn(call('/usr/bin/open', r.SHARING_PANE, check=False), run.call_args_list)

    def test_share_wake_flag_turns_keep_awake_on_and_rejects_unknown_flags(self):
        with patch.object(r, 'ssh_listening', return_value=True), \
             patch.object(r, 'wake_active', return_value=False), \
             patch.object(r, 'host_fingerprint', return_value=FP), \
             patch.object(r, 'run', return_value=Mock(stdout='Remote-Mac\n')), \
             patch.object(r, 'clipboard', return_value=False), \
             patch.object(r, 'activate') as activate:
            shown = self.out(r.ssh_share, ['--wake'])
            activate.assert_called_once_with(start_apps=False)
            self.assertIn('Wachhalten           AN', shown)
            with self.assertRaises(ValueError):
                self.out(r.ssh_share, ['--wirklich'])
            activate.assert_called_once_with(start_apps=False)

    def share_json(self, args, listening=True, awake=True, fingerprint=FP, copied=True):
        with patch.object(r, 'ssh_listening', return_value=listening), patch.object(r, 'wake_active', return_value=awake), \
             patch.object(r, 'host_fingerprint', return_value=fingerprint), \
             patch.object(r, 'run', return_value=Mock(stdout='Remote-Mac\n')) as run, \
             patch.object(r, 'clipboard', return_value=copied) as clip, patch.object(r, 'activate') as activate:
            shown = self.out(r.ssh_share, args)
        return json.loads(shown), run, clip, activate

    def test_share_json_gives_the_window_the_state_instead_of_terminal_text(self):
        data, run, clip, _ = self.share_json(['--json'])
        line = f'workspace remote ssh join {getpass.getuser()}@Remote-Mac.local {FP}'
        self.assertEqual(data, {'remoteLogin': True, 'awake': True, 'line': line, 'fingerprint': True, 'copied': True,
                                'settingsOpened': False, 'via': 'local', 'localLine': '', 'tailscale': 'missing'})
        clip.assert_called_once_with(line)
        self.assertNotIn(call('/usr/bin/open', r.SHARING_PANE, check=False), run.call_args_list)

    def test_share_json_reports_a_failed_copy_and_an_unreadable_host_key(self):
        data, _, _, _ = self.share_json(['--json'], fingerprint='', copied=False)
        self.assertEqual((data['copied'], data['fingerprint']), (False, False))
        self.assertTrue(data['line'].endswith('@Remote-Mac.local'))                          # ohne Fingerprint, aber die Zeile gibt es

    def test_share_json_opens_settings_while_login_is_off_unless_told_not_to(self):
        data, run, clip, _ = self.share_json(['--json'], listening=False, awake=False)
        self.assertEqual((data['remoteLogin'], data['line'], data['copied'], data['settingsOpened']), (False, '', False, True))
        run.assert_any_call('/usr/bin/open', r.SHARING_PANE, check=False)
        clip.assert_not_called()
        data, run, clip, _ = self.share_json(['--json', '--no-open'], listening=False)         # „Erneut prüfen“
        self.assertEqual((data['remoteLogin'], data['settingsOpened']), (False, False))
        self.assertNotIn(call('/usr/bin/open', r.SHARING_PANE, check=False), run.call_args_list)
        data, _, clip, _ = self.share_json(['--json', '--no-open'])                            # jetzt an: Zeile wird kopiert
        self.assertEqual((data['remoteLogin'], data['copied']), (True, True))
        clip.assert_called_once()

    def test_share_json_with_wake_turns_keep_awake_on_and_reports_it(self):
        data, _, _, activate = self.share_json(['--json', '--wake'], awake=False)
        activate.assert_called_once_with(start_apps=False)
        self.assertTrue(data['awake'])                                                          # --wake gilt sofort als an

    def test_share_flags_are_checked_and_the_terminal_text_is_unchanged(self):
        for bad in (['--json', '--json'], ['--wake', '--wirklich'], ['--json', 'x']):
            with patch.object(r, 'activate') as activate, self.assertRaises(ValueError, msg=repr(bad)):
                self.out(r.ssh_share, bad)
            activate.assert_not_called()                                                         # nichts geschieht bei falschem Aufruf
        with patch.object(r, 'ssh_listening', return_value=False), patch.object(r, 'wake_active', return_value=True), \
             patch.object(r, 'run', return_value=Mock(stdout='Remote-Mac\n')) as run:
            text = self.out(r.ssh_share, ['--no-open'])
        self.assertNotIn(call('/usr/bin/open', r.SHARING_PANE, check=False), run.call_args_list)
        self.assertIn('Entfernte Anmeldung  AUS', text)
        self.assertNotIn('Systemeinstellungen geöffnet', text)

    # --- Tailscale: die join-Zeile nennt den Tailnet-Host, Fehler nennen den Grund ----------------------------------------
    # Nie das echte Tailscale: eine Attrappe gibt fertiges JSON aus und schreibt Argumente und Umgebung in eine Logdatei.

    TAILNET = 'remote-mac.example-tailnet.ts.net'

    def tailnet_status(self, state='Running', magic=True, name=TAILNET, ips=('100.64.0.5', 'fd7a:115c:a1e0::5'), peers=None, owner=1001):
        """Peers are (name, ip, online) plus optionally the owner's user id and True if the node was shared in from another account."""
        peers = [('laptop.example-tailnet.ts.net', '100.64.0.9', True)] if peers is None else peers
        nodes = {}
        for n, (host, ip, online, *extra) in enumerate(peers):
            nodes[f'nodekey:{n}'] = {'DNSName': host + '.', 'TailscaleIPs': [ip, 'fd7a:115c:a1e0::9'], 'Online': online,
                                     'UserID': extra[0] if extra else owner, **({'ShareeNode': True} if len(extra) > 1 and extra[1] else {})}
        return {'BackendState': state, 'CurrentTailnet': {'Name': 'example-tailnet.ts.net', 'MagicDNSEnabled': magic},
                'Self': {'DNSName': name + '.', 'TailscaleIPs': list(ips), 'Online': True, 'UserID': owner}, 'Peer': nodes}

    def tailscale_stub(self, status=None, raw=None, exit_code=0):
        """A fake `tailscale`; returns a context manager that points VIBECODE_TAILSCALE at it. self.stub_log has its calls."""
        base = Path(self.tmp.name)
        (base / 'status.json').write_text(raw if raw is not None else json.dumps(status))
        self.stub_log = base / 'stub.log'
        stub = base / 'tailscale'
        stub.write_text(f'#!/bin/sh\necho "BE_CLI=$TAILSCALE_BE_CLI $*" >> {shlex.quote(str(self.stub_log))}\n'
                        f'cat {shlex.quote(str(base / "status.json"))}\nexit {exit_code}\n')
        stub.chmod(0o755)
        return patch.dict(os.environ, {'VIBECODE_TAILSCALE': str(stub)})

    def stub_calls(self):
        return self.stub_log.read_text().splitlines() if self.stub_log.exists() else []

    def test_share_gives_the_tailnet_name_when_tailscale_runs_and_keeps_the_local_line_as_fallback(self):
        with self.tailscale_stub(self.tailnet_status()):
            data, _, clip, _ = self.share_json(['--json'])
        self.assertEqual(data['line'], f'workspace remote ssh join {getpass.getuser()}@{self.TAILNET} {FP}')
        self.assertEqual(data['localLine'], f'workspace remote ssh join {getpass.getuser()}@Remote-Mac.local {FP}')
        self.assertEqual((data['via'], data['tailscale']), ('tailscale', 'running'))
        clip.assert_called_once_with(data['line'])                                            # in die Zwischenablage kommt die Tailnet-Zeile
        self.assertEqual(self.stub_calls(), ['BE_CLI=1 status --json'])                      # als CLI gestartet, nicht als App

    def test_share_uses_the_100_address_when_magicdns_is_off_and_ignores_ipv6(self):
        with self.tailscale_stub(self.tailnet_status(magic=False)):
            data, _, _, _ = self.share_json(['--json'])
        self.assertEqual(data['line'], f'workspace remote ssh join {getpass.getuser()}@100.64.0.5 {FP}')   # ein Name ginge ohne MagicDNS nirgends auf
        self.assertEqual(data['via'], 'tailscale')

    def test_share_falls_back_to_the_local_name_whenever_tailscale_gives_nothing_usable(self):
        broken = [('Stopped', self.tailnet_status(state='Stopped'), 'off'), ('NeedsLogin', self.tailnet_status(state='NeedsLogin'), 'off'),
                  ('nur IPv6', self.tailnet_status(magic=False, ips=('fd7a:115c:a1e0::5',)), 'running'),
                  ('Müll', None, 'off'), ('Liste', [], 'off'),
                  ('Name mit Optionszeichen', self.tailnet_status(magic=True, name='-oProxyCommand=x.ts.net', ips=()), 'running')]
        for label, status, kind in broken:
            raw = 'kein json' if label == 'Müll' else None
            with self.subTest(label), self.tailscale_stub(status, raw=raw):
                data, _, _, _ = self.share_json(['--json'])
            self.assertEqual((data['via'], data['localLine'], data['tailscale']), ('local', '', kind))
            self.assertTrue(data['line'].endswith(f'@Remote-Mac.local {FP}'))
        with patch.dict(os.environ, {'VIBECODE_TAILSCALE': str(Path(self.tmp.name) / 'gibt-es-nicht')}):
            self.assertEqual(r.tailscale_kind(r.tailscale_state()), 'missing')

    def test_a_hanging_or_failing_tailscale_never_breaks_share(self):
        with self.tailscale_stub(self.tailnet_status()):
            with patch.object(r.subprocess, 'run', side_effect=r.subprocess.TimeoutExpired('tailscale', 4)):
                state = r.tailscale_state()
            self.assertEqual((state['state'], state['peers']), ('', []))
            self.assertEqual(r.tailscale_kind(state), 'off')                                   # installiert, aber keine Antwort
        with self.tailscale_stub(raw='', exit_code=1):
            self.assertEqual(r.tailscale_state()['state'], '')                                # Daemon läuft nicht: Exit 1, keine Ausgabe

    def test_info_text_says_how_tailscale_stands_and_offers_both_lines(self):
        cases = [(self.tailnet_status(), 'verbunden: dieser Mac', True), (self.tailnet_status(state='Stopped'), 'installiert, aber nicht verbunden', False),
                 (None, 'nicht installiert', False)]
        for status, expect, tailnet_line in cases:
            lines = []
            context = self.tailscale_stub(status) if status else patch.dict(os.environ, {'VIBECODE_TAILSCALE': ''})
            with self.subTest(expect), context, patch.object(r, 'ssh_listening', return_value=True), \
                 patch.object(r, 'wake_active', return_value=True), patch.object(r, 'host_fingerprint', return_value=FP), \
                 patch.object(r, 'run', return_value=Mock(stdout='Remote-Mac\n')):
                line = r.ssh_info(lines.append)
            text = '\n'.join(lines)
            self.assertIn('Tailscale            ' + expect, text)
            self.assertEqual('Nur im selben Netz geht auch:' in text, tailnet_line)           # die .local-Zeile nur neben einer Tailnet-Zeile
            self.assertEqual(f'@{self.TAILNET} ' in line, tailnet_line)
            self.assertEqual('@Remote-Mac.local' in text, True)

    def test_an_unreachable_tailscale_host_names_the_actual_reason(self):
        offline = [('laptop.example-tailnet.ts.net', '100.64.0.9', True), (self.TAILNET, '100.64.0.5', False)]
        cases = [
            (f'user@{self.TAILNET}', self.tailnet_status(peers=offline), 'im Tailnet offline'),                  # Mac schläft
            ('user@100.64.0.5', self.tailnet_status(peers=offline), 'im Tailnet offline'),                       # dieselbe Prüfung per IP
            ('user@remote-mac', self.tailnet_status(peers=offline), 'im Tailnet offline'),                       # und per kurzem Namen
            (f'user@{self.TAILNET}', self.tailnet_status(peers=[(self.TAILNET, '100.64.0.5', True)]), 'SSH-Port antwortet nicht'),
            ('user@other.example-tailnet.ts.net', self.tailnet_status(), 'kennt dieses Gerät'),
            (f'user@{self.TAILNET}', self.tailnet_status(state='Stopped'), 'nicht verbunden (Stopped)'),
            (f'user@{self.TAILNET}', self.tailnet_status(state='NeedsLogin'), 'nicht verbunden (NeedsLogin)'),
        ]
        for destination, status, expected in cases:
            with self.subTest(destination=destination, expected=expected), self.tailscale_stub(status):
                r.ssh_set([destination])
                with patch.object(r, 'unreachable_reason', return_value='Operation timed out'), self.assertRaises(ValueError) as caught:
                    r.ssh_require_reachable(r.saved_ssh_target())
            self.assertIn(expected, str(caught.exception))
            self.assertIn('nicht erreichbar (Operation timed out)', str(caught.exception))
        with patch.dict(os.environ, {'VIBECODE_TAILSCALE': ''}):
            r.ssh_set([f'user@{self.TAILNET}'])
            with patch.object(r, 'unreachable_reason', return_value='x'), self.assertRaisesRegex(ValueError, 'Tailscale ist auf diesem Mac nicht installiert'):
                r.ssh_require_reachable(r.saved_ssh_target())

    def test_a_plain_alias_gets_no_tailscale_claims_unless_tailscale_knows_the_name(self):
        specific = ('Tailscale-Gerät', 'nicht verbunden', 'kennt dieses Gerät', 'im Tailnet', 'Tailscale kennt')
        for label, status in (('fehlt', None), ('Stopped', self.tailnet_status(state='Stopped')),
                              ('läuft ohne Treffer', self.tailnet_status())):
            context = self.tailscale_stub(status) if status else patch.dict(os.environ, {'VIBECODE_TAILSCALE': ''})
            with self.subTest(label), context:
                r.ssh_set(['user@spark'])
                with patch.object(r, 'unreachable_reason', return_value='Operation timed out'), self.assertRaises(ValueError) as caught:
                    r.ssh_require_reachable(r.saved_ssh_target())
            for sentence in specific:
                self.assertNotIn(sentence, str(caught.exception), msg=label)
        with self.tailscale_stub(self.tailnet_status(peers=[('spark.example-tailnet.ts.net', '100.64.0.7', False)])):
            r.ssh_set(['user@spark'])                                                          # kennt Tailscale den kurzen Namen, gilt er als Tailnet-Gerät
            with patch.object(r, 'unreachable_reason', return_value='Operation timed out'), self.assertRaises(ValueError) as caught:
                r.ssh_require_reachable(r.saved_ssh_target())
        self.assertIn('im Tailnet offline', str(caught.exception))

    def test_a_tailnet_name_that_does_not_resolve_points_to_the_100_address_not_to_the_ssh_port(self):
        unresolved = 'getaddrinfo: nodename nor servname provided, or not known'
        online = [(self.TAILNET, '100.64.0.5', True)]
        with self.tailscale_stub(self.tailnet_status(peers=online)):
            r.ssh_set([f'user@{self.TAILNET}'])
            with patch.object(r, 'unreachable_reason', return_value=unresolved), self.assertRaises(ValueError) as caught:
                r.ssh_require_reachable(r.saved_ssh_target())
        text = str(caught.exception)
        self.assertIn('lässt sich auf diesem Mac nicht auflösen', text)
        self.assertIn('100.64.0.5', text)
        self.assertNotIn('SSH-Port antwortet nicht', text)
        self.assertNotIn('Unterwegs hilft Tailscale', text)                                    # kein widersprüchlicher Allgemeintipp
        with self.tailscale_stub(self.tailnet_status(peers=[(self.TAILNET, '100.64.0.5', False)])):
            with patch.object(r, 'unreachable_reason', return_value=unresolved), self.assertRaises(ValueError) as caught:
                r.ssh_require_reachable(r.saved_ssh_target())
        self.assertIn('100.64.0.5', str(caught.exception))
        self.assertIn('Außerdem ist der Remote-Mac im Tailnet offline', str(caught.exception))   # beides gesagt, nichts verschwiegen

    # --- Gerät aus dem eigenen Tailnet als SSH-Ziel: ohne Zeilen, Host-Schlüssel per Tailscale bestätigt ---------------------

    STUDIO = 'studio.example-tailnet.ts.net'

    def own_device(self, **options):
        peers = options.pop('peers', [(self.STUDIO, '100.64.0.9', True)])
        return self.tailscale_stub(self.tailnet_status(peers=peers, **options))

    def known_hosts_text(self):
        file = self.ssh_dir / 'known_hosts'
        return file.read_text() if file.exists() else None

    def connect_tailnet(self, destination, probe='ok', **options):
        """Run `ssh tailnet` against the fake CLI; returns (output, host key line, its fingerprint)."""
        with self.own_device(**options):
            entry, fingerprint = self.fake_host()
            with patch.object(r, 'unreachable_reason', return_value=None), patch.object(r, 'probe_login', return_value=probe):
                return self.out(r.ssh_tailnet, [destination]), entry, fingerprint

    def test_tailnet_connect_trusts_an_own_device_and_writes_name_and_address(self):
        for destination, magic, saved_host, written_names in (
                ('user@100.64.0.9', True, self.STUDIO, f'{self.STUDIO},100.64.0.9'),          # nach Adresse gewählt, MagicDNS an: der Name
                ('user@studio', True, self.STUDIO, f'{self.STUDIO},100.64.0.9'),               # kurzer Name
                ('user@100.64.0.9', False, '100.64.0.9', '100.64.0.9')):                       # ohne MagicDNS löst ein Name nirgends auf
            with self.subTest(destination=destination, magic=magic):
                (self.ssh_dir / 'known_hosts').unlink(missing_ok=True)
                shown, entry, fingerprint = self.connect_tailnet(destination, magic=magic)
                kind, blob = entry.split()[1:3]
                self.assertEqual(r.read('ssh.json'), {'user': 'user', 'host': saved_host, 'port': 22})
                self.assertEqual(self.known_hosts_text(), f'{written_names} {kind} {blob}\n')    # beide Schreibweisen: ssh, join und der Editor finden sie
                self.assertIn(fingerprint, shown)
                self.assertIn('Tailscale hat das Gerät als dein eigenes bestätigt', shown)
                self.assertIn(f'✔ Verbunden mit user@{saved_host}', shown)

    def test_tailnet_connect_refuses_what_is_not_your_own_online_tailscale_device(self):
        stranger = [(self.STUDIO, '100.64.0.9', True, 2002)]                                     # anderes Konto im selben Tailnet
        shared = [(self.STUDIO, '100.64.0.9', True, 1001, True)]                                  # von außen hereingeteiltes Gerät
        elsewhere = [(self.STUDIO, '192.0.2.5', True)]                                            # keine Tailscale-Adresse
        cases = [('fremdes Konto', dict(peers=stranger), 'user@100.64.0.9', 'gehört nicht zu deinem Tailscale-Konto'),
                 ('geteilt', dict(peers=shared), 'user@100.64.0.9', 'gehört nicht zu deinem Tailscale-Konto'),
                 ('unbekannt', dict(), 'user@100.64.0.77', 'kennt Tailscale in deinem Tailnet nicht'),
                 ('keine 100.x-Adresse', dict(peers=elsewhere), 'user@192.0.2.5', 'keine Tailscale-Adresse'),
                 ('Tailscale aus', dict(state='Stopped'), 'user@100.64.0.9', 'nicht verbunden'),
                 ('ohne Konto-Kennung', dict(owner=None), 'user@100.64.0.9', 'gehört nicht zu deinem Tailscale-Konto')]
        for label, options, destination, expected in cases:
            with self.subTest(label):
                status = self.tailnet_status(peers=options.get('peers', [(self.STUDIO, '100.64.0.9', True)]),
                                             state=options.get('state', 'Running'), owner=options.get('owner', 1001))
                if label == 'ohne Konto-Kennung':
                    del status['Self']['UserID']
                with self.tailscale_stub(status), patch.object(r, 'probe_login') as probe, patch.object(r, 'run') as run:
                    with self.assertRaisesRegex(ValueError, expected):
                        r.ssh_tailnet([destination])
                probe.assert_not_called()
                run.assert_not_called()                                                          # kein Schlüssel wird gelesen oder eingetragen
                self.assertIsNone(self.known_hosts_text())
                self.assertIsNone(r.read('ssh.json'))                                            # und nichts als Ziel gespeichert

    def test_tailnet_connect_never_overwrites_a_known_host_and_reports_a_missing_key(self):
        with self.own_device(), patch.object(r, 'unreachable_reason', return_value=None), patch.object(r, 'probe_login', return_value='ok'):
            self.fake_host(known=True)
            shown = self.out(r.ssh_tailnet, ['user@100.64.0.9'])
        self.assertIsNone(self.known_hosts_text())                                               # bekannt: unangetastet
        self.assertNotIn('Host-Schlüssel von', shown)
        self.assertEqual(r.read('ssh.json')['host'], self.STUDIO)
        with self.assertRaises(SystemExit) as caught:                                            # Gerät kennt unseren Schlüssel noch nicht
            shown = self.connect_tailnet('user@100.64.0.9', probe='denied')
        self.assertEqual(caught.exception.code, 2)

    def test_tailnet_connect_exit_2_says_how_to_install_the_key(self):
        shown = io.StringIO()
        with self.own_device(), patch.object(r, 'unreachable_reason', return_value=None), patch.object(r, 'probe_login', return_value='denied'):
            self.fake_host()
            with self.assertRaises(SystemExit) as caught, contextlib.redirect_stdout(shown):
                r.ssh_tailnet(['user@100.64.0.9'])
        self.assertEqual(caught.exception.code, 2)
        self.assertIn('ssh pair --verify', shown.getvalue())
        self.assertEqual(r.read('ssh.json')['user'], 'user')                                     # das Ziel ist gespeichert, nur der Schlüssel fehlt

    def test_tailnet_connect_rejects_bad_arguments_before_touching_anything(self):
        with self.tailscale_stub(self.tailnet_status()):
            for bad in ([], ['100.64.0.9'], ['user@100.64.0.9', 'x'], ['-oProxyCommand=x@100.64.0.9'], ['user@-oProxyCommand=x'], ['@100.64.0.9']):
                with self.subTest(bad), patch.object(r, 'run') as run, self.assertRaises(ValueError):
                    r.ssh_tailnet(bad)
                run.assert_not_called()
        self.assertEqual(self.ts_calls(), [])
        self.assertIsNone(r.read('ssh.json'))

    def test_pair_with_verify_ends_with_a_clear_result_and_plain_pair_still_replaces_the_process(self):
        r.ssh_set(['user@studio.example-tailnet.ts.net'])
        with patch.object(r, 'unreachable_reason', return_value=None), patch.object(r.os, 'execv') as execv, \
             patch.object(r.subprocess, 'run') as run:
            r.main(['ssh', 'pair'])
        execv.assert_called_once()
        run.assert_not_called()                                                                  # ohne --verify unverändert: kein zweites Programm
        for copy_status, probe, expected in ((0, 'ok', '✔ Verbunden mit user@studio'), (0, 'denied', 'Permission denied'), (1, 'ok', None)):
            with self.subTest(copy_status=copy_status, probe=probe), patch.object(r, 'unreachable_reason', return_value=None), \
                 patch.object(r, 'ensure_client_key'), patch.object(r, 'key_needs_passphrase', return_value=False), \
                 patch.object(r, 'own_public_key', return_value=(self.ssh_dir / 'id_ed25519.pub', 'ssh-ed25519 AAAA x', FP)), patch.object(r.os, 'execv') as execv, patch.object(r.subprocess, 'run', return_value=Mock(returncode=copy_status)) as run, \
                 patch.object(r, 'probe_login', return_value=probe):
                if expected is None:
                    with self.assertRaises(SystemExit) as caught:
                        r.main(['ssh', 'pair', '--verify'])
                    self.assertEqual(caught.exception.code, 1)                                    # ssh-copy-id scheiterte: derselbe Status
                elif probe == 'denied':
                    with self.assertRaisesRegex(ValueError, expected):
                        r.main(['ssh', 'pair', '--verify'])
                else:
                    self.assertIn(expected, self.out(r.main, ['ssh', 'pair', '--verify']))
            execv.assert_not_called()
            self.assertEqual(run.call_args.args[0][:3], ['/usr/bin/ssh-copy-id', '-p', '22'])
        with self.assertRaises(ValueError):
            r.main(['ssh', 'pair', '--anders'])
        with self.assertRaises(ValueError):
            r.main(['ssh', 'tailnet'])

    def pair_run(self, probes, needs_passphrase=False, keygen_ok=True, have_key=True, copy_status=0):
        """Run `ssh pair --verify` with every program stubbed; returns (outcome, the programs that were started in order)."""
        r.ssh_set(['user@studio.example-tailnet.ts.net'])
        started = []
        public = self.ssh_dir / 'id_ed25519.pub'
        self.ssh_dir.mkdir(exist_ok=True)
        public.unlink(missing_ok=True)
        if have_key:
            public.write_text('ssh-ed25519 AAAA user@client\n')

        def fake_own_key():
            if not public.is_file():
                raise ValueError('Kein SSH-Schlüssel gefunden.')
            return public, 'ssh-ed25519 AAAA user@client', FP

        def fake_run(command, *args, **kwargs):
            tool = command[0].rsplit('/', 1)[-1]
            started.append(tool + (' ' + command[1] if tool == 'ssh-add' else ''))
            if tool == 'ssh-keygen' and '-y' in command:
                return Mock(returncode=1 if needs_passphrase else 0, stdout='', stderr='incorrect passphrase supplied to decrypt private key')
            if tool == 'ssh-keygen':
                if keygen_ok:
                    public.write_text('ssh-ed25519 AAAA VibeCode Workspace\n')
                return Mock(returncode=0 if keygen_ok else 1)
            return Mock(returncode=copy_status)
        sequence = list(probes)
        with patch.object(r, 'unreachable_reason', return_value=None), patch.object(r.subprocess, 'run', side_effect=fake_run), \
             patch.object(r, 'own_public_key', side_effect=fake_own_key), patch.object(r, 'probe_login', side_effect=lambda target: sequence.pop(0)):
            try:
                return self.out(r.ssh_pair, True), started
            except (ValueError, SystemExit) as exc:
                return exc, started

    def test_pair_creates_a_missing_key_first_so_a_fresh_mac_works_in_the_same_terminal(self):
        outcome, started = self.pair_run(['ok'], have_key=False)
        self.assertEqual(started, ['ssh-keygen', 'ssh-copy-id'])                                  # erst der Schlüssel, dann das Eintragen
        self.assertIn('✔ Verbunden', outcome)
        outcome, started = self.pair_run(['ok'], have_key=True)
        self.assertEqual(started, ['ssh-copy-id'])                                                 # ein vorhandener Schlüssel wird nie neu erzeugt
        outcome, started = self.pair_run(['ok'], have_key=False, keygen_ok=False)
        self.assertIsInstance(outcome, ValueError)
        self.assertIn('nicht erzeugt', str(outcome))
        self.assertEqual(started, ['ssh-keygen'])                                                  # ohne Schlüssel wird nichts eingetragen

    def test_pair_asks_for_the_passphrase_once_when_the_copy_worked_but_the_login_is_still_refused(self):
        outcome, started = self.pair_run(['denied', 'ok'], needs_passphrase=True)
        self.assertEqual(started, ['ssh-copy-id', 'ssh-keygen', 'ssh-add --apple-use-keychain'])
        self.assertIn('✔ Verbunden', outcome)
        outcome, started = self.pair_run(['denied', 'denied'], needs_passphrase=True)              # auch danach nicht: klare Meldung, kein Dauerlauf
        self.assertIsInstance(outcome, ValueError)
        self.assertEqual(started.count('ssh-add --apple-use-keychain'), 1)
        outcome, started = self.pair_run(['denied'], needs_passphrase=False)                       # ohne Passphrase ist es etwas anderes: nicht ssh-add
        self.assertIsInstance(outcome, ValueError)
        self.assertIn('Entfernte Anmeldung', str(outcome))
        self.assertNotIn('ssh-add --apple-use-keychain', started)

    def test_tailnet_connect_falls_back_to_the_address_when_the_name_does_not_resolve_here(self):
        reasons = iter(['nodename nor servname provided, or not known', None])
        with self.own_device(), patch.object(r, 'unreachable_reason', side_effect=lambda host, port, timeout=5: next(reasons)), \
             patch.object(r, 'probe_login', return_value='ok'):
            self.fake_host()
            shown = self.out(r.ssh_tailnet, ['user@100.64.0.9'])
        self.assertEqual(r.read('ssh.json')['host'], '100.64.0.9')                                # gespeichert wird die Adresse, die geht immer
        self.assertIn('✔ Verbunden mit user@100.64.0.9', shown)
        self.assertEqual(self.known_hosts_text().split()[0], '100.64.0.9')
        with self.own_device(), patch.object(r, 'unreachable_reason', return_value='Operation timed out'), patch.object(r, 'probe_login') as probe:
            self.fake_host()
            with self.assertRaisesRegex(ValueError, 'nicht erreichbar'):                               # andere Gründe: kein Ausweichen
                r.ssh_tailnet(['user@100.64.0.9'])
        probe.assert_not_called()

    def test_show_gives_the_dialog_the_local_user_and_the_query_knows_owner_and_sharing(self):
        shared = [('a.example-tailnet.ts.net', '100.64.0.7', True, 1001, True), ('b.example-tailnet.ts.net', '100.64.0.8', True, 2002)]
        with self.tailscale_stub(self.tailnet_status(peers=shared)):
            self.assertEqual(self.ts_show()['localUser'], 'user')
            info = r.tailscale_state()
        self.assertEqual(info['owner'], 1001)
        self.assertEqual([(p['name'], p['owner'], p['shared']) for p in info['peers']],
                         [('a.example-tailnet.ts.net', 1001, True), ('b.example-tailnet.ts.net', 2002, False)])

    # --- Agenten auf dem anderen Mac: das feste Skript per SSH, nur lesend ----------------------------------------------------------

    def test_the_agent_scan_runs_on_the_saved_mac_over_stdin_in_batch_mode(self):
        r.ssh_set(['user@studio.example-tailnet.ts.net'])
        report = json.dumps({'sessions': [{'agent': 'claude', 'cwd': '/srv/git/app', 'branch': 'main', 'state': 'ready', 'age': 5}]})
        with patch.object(r, 'unreachable_reason', return_value=None), \
             patch.object(r.subprocess, 'run', return_value=Mock(returncode=0, stdout=report, stderr='')) as run:
            shown = self.out(r.main, ['ssh', 'agents'])
        self.assertEqual(json.loads(shown), json.loads(report))
        command = run.call_args.args[0]
        self.assertIn('BatchMode=yes', command)                                                    # nie auf eine Passwortabfrage warten
        self.assertEqual(command[-2], 'user@studio.example-tailnet.ts.net')
        self.assertTrue(command[-1].startswith('/bin/sh -c '))
        self.assertEqual(run.call_args.kwargs['input'], r.AGENT_SCRIPT.read_text(encoding='utf-8'))   # genau dieses Skript, über stdin
        self.assertIn('xcode-select -p', command[-1])                                              # erst prüfen, dann python3 (kein Installationsdialog)

    def test_agent_scan_problems_say_what_is_wrong(self):
        r.ssh_set(['user@studio.example-tailnet.ts.net'])
        cases = [('python3 fehlt', Mock(returncode=3, stdout='', stderr='python3 fehlt (Command Line Tools: xcode-select --install)\n'), 'Command Line Tools'),
                 ('ssh scheitert', Mock(returncode=255, stdout='', stderr='ssh: connect to host x port 22: Operation timed out\n'), 'antwortet nicht lesbar'),
                 ('kein JSON', Mock(returncode=0, stdout='Willkommen!', stderr=''), 'kein Agenten-Bericht'),
                 ('falsche Form', Mock(returncode=0, stdout='{"sessions": 5}', stderr=''), 'kein Agenten-Bericht')]
        for label, outcome, expected in cases:
            with self.subTest(label), patch.object(r, 'unreachable_reason', return_value=None), patch.object(r.subprocess, 'run', return_value=outcome):
                with self.assertRaisesRegex(ValueError, expected):
                    r.ssh_agents()
        with patch.object(r, 'unreachable_reason', return_value='down'), patch.object(r.subprocess, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'nicht erreichbar'):
                r.ssh_agents()
        run.assert_not_called()                                                                    # ein schlafender Mac wird nicht erst versucht
        with self.assertRaises(ValueError):
            r.main(['ssh', 'agents', 'extra'])
        (Path(self.tmp.name) / 'ssh.json').unlink()
        with self.assertRaisesRegex(ValueError, 'Kein SSH-Ziel'):
            r.ssh_agents()

    def test_the_remote_agent_command_is_valid_sh_and_works_end_to_end_with_a_synthetic_session(self):
        script = Path(self.tmp.name) / 'remote.sh'
        script.write_text(r.AGENT_REMOTE)
        self.assertEqual(subprocess.run(['/bin/sh', '-n', str(script)]).returncode, 0)
        if subprocess.run(['/usr/bin/xcode-select', '-p'], capture_output=True).returncode:
            self.skipTest('Command Line Tools fehlen: dort würde python3 einen Installationsdialog öffnen')
        projects = Path(self.tmp.name) / 'claude'
        folder = projects / '-Users-example-work-app'
        folder.mkdir(parents=True)
        (folder / 'one.jsonl').write_text(json.dumps({'type': 'assistant', 'cwd': '/Users/example/work/app', 'gitBranch': 'main',
                                                      'message': {'role': 'assistant', 'stop_reason': 'end_turn',
                                                                  'content': [{'type': 'text', 'text': 'GEHEIMER-TEXT'}]}}) + '\n')
        # Wie bei einem SSH-Befehl ohne Terminal: nur der Standard-PATH, also das System-Python (3.9), nicht das aus dem Test.
        env = dict(os.environ, PATH='/usr/bin:/bin:/usr/sbin:/sbin', VIBECODE_CLAUDE_PROJECTS=str(projects),
                   VIBECODE_CODEX_SESSIONS=str(Path(self.tmp.name) / 'keine'))
        result = subprocess.run(['/bin/sh', '-c', r.AGENT_REMOTE], input=r.AGENT_SCRIPT.read_text(encoding='utf-8'),
                                capture_output=True, text=True, timeout=30, env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        sessions = json.loads(result.stdout)['sessions']
        self.assertEqual([(s['agent'], s['state'], s['cwd'], s['branch']) for s in sessions], [('claude', 'ready', '/Users/example/work/app', 'main')])
        self.assertNotIn('GEHEIMER-TEXT', result.stdout)

    # --- Einladung per Taildrop (der freigebende Mac wählt das Gerät): zwei simulierte Macs ---------------------------------------
    # Ein Attrappen-Tailscale pro Mac: `file cp` legt die Datei in den Posteingang des anderen, `file get` leert den eigenen in einen Ordner.

    BOOK = 'book.example-tailnet.ts.net'

    def two_macs(self):
        root = Path(self.tmp.name) / 'macs'
        names = {'studio': ('100.64.0.9', self.STUDIO, 'studio_user'), 'book': ('100.64.0.5', self.BOOK, 'book_user')}
        self.macs = {}
        for name, (ip, dns, user) in names.items():
            folder = root / name
            for sub in ('inbox', 'base', 'downloads'):
                (folder / sub).mkdir(parents=True)
            (folder / 'ssh').mkdir(mode=0o700)
            self.macs[name] = {'dir': folder, 'ip': ip, 'dns': dns, 'user': user}
        # echte Schlüssel: der Host-Schlüssel des Studios und der Benutzerschlüssel des MacBooks
        for key, where, comment in (('studio_host', root / 'studio', 'root@studio'), ('id_ed25519', root / 'book' / 'ssh', 'user@book')):
            subprocess.run(['/usr/bin/ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-C', comment, '-f', str(where / key)], check=True)
        self.macs['studio']['host_key_file'] = root / 'studio' / 'studio_host.pub'
        for name, other in (('studio', 'book'), ('book', 'studio')):
            mac, peer = self.macs[name], self.macs[other]
            status = self.tailnet_status(name=mac['dns'], ips=(mac['ip'],), peers=[(peer['dns'], peer['ip'], True)])
            (mac['dir'] / 'status.json').write_text(json.dumps(status))
            script = mac['dir'] / 'tailscale'
            script.write_text(f"""#!/bin/sh
echo "$*" >> {shlex.quote(str(mac['dir'] / 'calls.log'))}
case "$1" in
  status) cat {shlex.quote(str(mac['dir'] / 'status.json'))} ;;
  file)
    if [ "$2" = cp ]; then cp "$3" {shlex.quote(str(peer['dir'] / 'inbox'))}/; fi
    if [ "$2" = get ]; then
      for a; do dest="$a"; done
      for f in {shlex.quote(str(mac['dir'] / 'inbox'))}/*; do [ -e "$f" ] && mv "$f" "$dest"/; done
      echo "moved"
    fi ;;
esac
exit 0
""")
            script.chmod(0o755)
            mac['cli'] = script

    @contextlib.contextmanager
    def as_mac(self, name):
        mac = self.macs[name]
        with patch.object(r, 'BASE', mac['dir'] / 'base'), patch.object(r, 'SSH_DIR', mac['dir'] / 'ssh'), \
             patch.object(r.getpass, 'getuser', return_value=mac['user']), \
             patch.dict(os.environ, {'VIBECODE_TAILSCALE': str(mac['cli']), 'VIBECODE_DOWNLOADS': str(mac['dir'] / 'downloads')}):
            studio_key = self.macs['studio']['host_key_file']
            kind, blob = studio_key.read_text().split()[:2]

            def fake_run(*args, check=True):
                if args[1] == '-F':
                    return Mock(returncode=1, stdout='')
                return Mock(returncode=0, stdout=f'{self.macs["studio"]["ip"]} {kind} {blob}\n')
            with patch.object(r, 'run', side_effect=fake_run), patch.object(r, 'HOST_KEY_FILE', studio_key), \
                 patch.object(r, 'ssh_listening', return_value=(name == 'studio')):
                yield mac

    def inbox_json(self):
        return json.loads(self.out(r.ssh_inbox))

    def test_the_whole_invitation_works_between_two_macs_and_ends_with_exactly_one_confirmed_key(self):
        self.two_macs()
        book_key = (self.macs['book']['dir'] / 'ssh' / 'id_ed25519.pub').read_text().strip()
        with self.as_mac('studio'):
            self.assertIn('Einladung an book geschickt', self.out(r.ssh_invite, ['100.64.0.5']))
            self.assertEqual(len(r.read('taildrop.json')['sent']), 1)
        sent = list((self.macs['book']['dir'] / 'inbox').glob('vibecode-invite-*.json'))
        self.assertEqual(len(sent), 1)
        (self.macs['book']['dir'] / 'inbox' / 'urlaub.jpg').write_bytes(b'\xff\xd8 ein Foto, das nichts mit uns zu tun hat')
        with self.as_mac('book'):
            found = self.inbox_json()
            self.assertEqual((found['foreign'], found['invalid'], len(found['answers'])), (1, 0, 0))
            self.assertEqual([(i['device'], i['user'], i['host']) for i in found['invites']], [('studio', 'studio_user', self.STUDIO)])
            code = found['invites'][0]['nonce']
            shown = self.out(r.ssh_accept, [code])
            self.assertIn('✔ Einladung von studio angenommen', shown)
            self.assertEqual(r.read('ssh.json'), {'user': 'studio_user', 'host': self.STUDIO, 'port': 22})
            known = (self.macs['book']['dir'] / 'ssh' / 'known_hosts').read_text().split()
            self.assertEqual((known[0], known[1]), (f'{self.STUDIO},100.64.0.9', 'ssh-ed25519'))             # Name und Adresse
            self.assertEqual(r.read('taildrop.json')['invites'], {})                                       # die Einladung ist verbraucht
        self.assertEqual((self.macs['book']['dir'] / 'downloads' / 'urlaub.jpg').read_bytes()[:2], b'\xff\xd8')   # das fremde Foto: unverändert
        with self.as_mac('studio'):
            found = self.inbox_json()
            self.assertEqual([(a['nonce'], a['device']) for a in found['answers']], [(code, 'book')])
            check = json.loads(self.out(r.ssh_grant, ['--check', code]))
            self.assertEqual((check['name'], check['known'], check['comment']), ('book', False, 'user@book'))
            self.assertEqual(check['fingerprint'], r.keygen_fingerprint(' '.join(book_key.split()[:2])))
            self.assertFalse((self.macs['studio']['dir'] / 'ssh' / 'authorized_keys').exists())              # prüfen schreibt nichts
            self.assertIn('Freigegeben: book', self.out(r.ssh_grant, ['--yes', code]))
            keys = (self.macs['studio']['dir'] / 'ssh' / 'authorized_keys').read_text().splitlines()
            self.assertEqual(keys, [book_key])                                                             # genau dieser eine Schlüssel
            self.assertEqual(json.loads(self.out(r.ssh_access)), [{'name': 'user@book', 'fingerprint': check['fingerprint']}])
            with self.assertRaisesRegex(ValueError, 'keine offene Einladung'):                              # ein Code gilt nur einmal
                r.ssh_grant(['--yes', code])
            self.assertEqual(r.read('taildrop.json'), {'version': 1, 'sent': {}, 'invites': {}, 'answers': {}})

    def test_inviting_refuses_foreign_offline_or_unprepared_cases_and_sends_nothing(self):
        self.two_macs()
        with self.as_mac('studio'):
            for label, patches, args, expected in (
                    ('fremdes Gerät', [], ['100.64.0.77'], 'kennt Tailscale in deinem Tailnet nicht'),
                    ('Entfernte Anmeldung aus', [patch.object(r, 'ssh_listening', return_value=False)], ['100.64.0.5'], 'Entfernte Anmeldung'),
                    ('ohne Argument', [], [], 'Aufruf'), ('zwei Argumente', [], ['a', 'b'], 'Aufruf')):
                with self.subTest(label), contextlib.ExitStack() as stack:
                    for each in patches:
                        stack.enter_context(each)
                    with self.assertRaisesRegex(ValueError, expected):
                        r.ssh_invite(args)
            status = self.tailnet_status(name=self.STUDIO, ips=('100.64.0.9',), peers=[(self.BOOK, '100.64.0.5', False)])
            (self.macs['studio']['dir'] / 'status.json').write_text(json.dumps(status))
            with self.assertRaisesRegex(ValueError, 'book ist offline'):
                r.ssh_invite(['100.64.0.5'])
            self.assertEqual(list((self.macs['book']['dir'] / 'inbox').iterdir()), [])                      # nichts verschickt
            self.assertIsNone(r.read('taildrop.json'))                                                      # und nichts vorgemerkt

    def test_the_inbox_sets_everything_it_does_not_understand_aside_and_never_deletes_other_files(self):
        self.two_macs()
        inbox = self.macs['book']['dir'] / 'inbox'
        code = 'a' * 32
        now = int(time.time())
        good = {'version': 1, 'nonce': code, 'host': self.STUDIO, 'user': 'studio_user', 'expires': now + 600,
                'hostKey': 'ssh-ed25519 ' + 'A' * 68}
        files = {'dokument.pdf': b'%PDF fremd', f'vibecode-invite-{"b" * 32}.json': b'{kaputt', f'vibecode-invite-{"c" * 32}.json': b'x' * 20000,
                 f'vibecode-invite-{"d" * 32}.json': json.dumps(dict(good, nonce='e' * 32)).encode(),                 # Name und Inhalt passen nicht zusammen
                 f'vibecode-invite-{"f" * 32}.json': json.dumps(dict(good, nonce='f' * 32, expires=now - 5)).encode(),  # abgelaufen
                 f'vibecode-invite-{"1" * 32}.json': json.dumps(dict(good, nonce='1' * 32, extra='x')).encode(),        # fremdes Feld
                 f'vibecode-invite-{"2" * 32}.json': json.dumps(dict(good, nonce='2' * 32, host='-oProxyCommand=x')).encode(),
                 f'vibecode-invite-{"3" * 32}.json': json.dumps(dict(good, nonce='3' * 32, user='a b')).encode(),
                 f'vibecode-invite-{"4" * 32}.json': json.dumps(dict(good, nonce='4' * 32, hostKey='ssh-rsa AAAA')).encode(),
                 f'vibecode-answer-{"5" * 32}.json': json.dumps({'version': 1, 'nonce': '5' * 32, 'publicKey': 'ssh-ed25519 AAAA x'}).encode()}
        for name, data in files.items():
            (inbox / name).write_bytes(data)
        with self.as_mac('book'):
            found = self.inbox_json()
        self.assertEqual((found['invites'], found['answers']), ([], []))
        self.assertEqual(found['foreign'], 1)                                                              # das PDF
        self.assertEqual(found['invalid'] + found['unknown'], len(files) - 1)                              # alles andere: zur Seite gelegt
        downloads = {p.name: p.read_bytes() for p in (self.macs['book']['dir'] / 'downloads').iterdir()}
        for name, data in files.items():
            if name.startswith('vibecode-answer-5'):
                continue                                                                                   # eine unbekannte, aber gültig aussehende Antwort wird verworfen
            self.assertEqual(downloads.get(name), data, name)                                              # unverändert, nichts gelöscht
        self.assertEqual(list(inbox.iterdir()), [])

    def test_a_stranger_who_is_not_your_device_is_never_offered_and_a_name_clash_in_downloads_is_numbered(self):
        self.two_macs()
        inbox, downloads = self.macs['book']['dir'] / 'inbox', self.macs['book']['dir'] / 'downloads'
        (downloads / 'foto.jpg').write_bytes(b'alt')
        (inbox / 'foto.jpg').write_bytes(b'neu')
        now = int(time.time())
        stranger = {'version': 1, 'nonce': '6' * 32, 'host': 'evil.example-tailnet.ts.net', 'user': 'x', 'expires': now + 600, 'hostKey': 'ssh-ed25519 ' + 'A' * 68}
        (inbox / f'vibecode-invite-{"6" * 32}.json').write_text(json.dumps(stranger))
        with self.as_mac('book'):
            found = self.inbox_json()
        self.assertEqual(found['invites'], [])                                                             # kein eigenes Gerät: nie angeboten
        self.assertEqual((found['invalid'], found['rejected']), (0, 1))                                     # verworfen, nicht „nach Downloads gelegt“
        self.assertEqual(found['variant'], 'cli')
        self.assertEqual((downloads / 'foto.jpg').read_bytes(), b'alt')                                    # nichts überschrieben
        self.assertEqual((downloads / 'foto (2).jpg').read_bytes(), b'neu')

    def test_accepting_checks_the_host_key_the_key_and_the_code_before_saving_anything(self):
        self.two_macs()
        with self.as_mac('studio'):
            self.out(r.ssh_invite, ['100.64.0.5'])
        with self.as_mac('book'):
            code = self.inbox_json()['invites'][0]['nonce']
            book_dir = self.macs['book']['dir']
            # 1. Host-Schlüssel stimmt nicht mit der Einladung überein
            state = r.read('taildrop.json')
            state['invites'][code]['hostKey'] = 'ssh-ed25519 ' + 'B' * 68
            r.write('taildrop.json', state)
            with self.assertRaisesRegex(ValueError, 'stimmt NICHT mit dem der Einladung überein'):
                r.ssh_accept([code])
            self.assertIsNone(r.read('ssh.json'))
            self.assertFalse((book_dir / 'ssh' / 'known_hosts').exists())
            # 2. kein eigener Schlüssel: Exit 4, nichts gespeichert, Einladung bleibt
            pub = book_dir / 'ssh' / 'id_ed25519.pub'
            saved = pub.read_text()
            pub.unlink()
            with self.assertRaises(SystemExit) as caught:
                self.out(r.ssh_accept, [code])
            self.assertEqual(caught.exception.code, 4)
            self.assertIsNone(r.read('ssh.json'))
            pub.write_text(saved)
            # 3. unbekannter oder abgelaufener Code, schlechte Eingabe
            for bad in (['0' * 32], [], ['kein-code'], [code, 'extra']):
                with self.assertRaises(ValueError, msg=repr(bad)):
                    r.ssh_accept(bad)
            state = r.read('taildrop.json')
            state['invites'][code]['expires'] = 1
            r.write('taildrop.json', state)
            with self.assertRaisesRegex(ValueError, 'gibt es nicht'):
                r.ssh_accept([code])

    def test_if_the_answer_cannot_be_sent_the_target_stays_saved_and_the_invitation_can_be_accepted_again(self):
        self.two_macs()
        with self.as_mac('studio'):
            self.out(r.ssh_invite, ['100.64.0.5'])
        with self.as_mac('book'):
            code = self.inbox_json()['invites'][0]['nonce']
            offline = self.tailnet_status(name=self.BOOK, ips=('100.64.0.5',), peers=[(self.STUDIO, '100.64.0.9', False)])
            (self.macs['book']['dir'] / 'status.json').write_text(json.dumps(offline))
            with self.assertRaisesRegex(ValueError, 'studio ist offline'):
                r.ssh_accept([code])
            self.assertIn(code, r.read('taildrop.json')['invites'])                                         # noch da: später noch einmal
            online = self.tailnet_status(name=self.BOOK, ips=('100.64.0.5',), peers=[(self.STUDIO, '100.64.0.9', True)])
            (self.macs['book']['dir'] / 'status.json').write_text(json.dumps(online))
            self.assertIn('✔ Einladung von studio angenommen', self.out(r.ssh_accept, [code]))

    def test_an_answer_nobody_asked_for_and_a_wrong_nonce_never_reach_authorized_keys(self):
        self.two_macs()
        book_key = (self.macs['book']['dir'] / 'ssh' / 'id_ed25519.pub').read_text().strip()
        studio_inbox = self.macs['studio']['dir'] / 'inbox'
        (studio_inbox / f'vibecode-answer-{"7" * 32}.json').write_text(json.dumps({'version': 1, 'nonce': '7' * 32, 'publicKey': book_key}))
        with self.as_mac('studio'):
            found = self.inbox_json()
            self.assertEqual((found['answers'], found['unknown']), ([], 1))                                  # nie eingeladen: verworfen
            self.assertFalse((self.macs['studio']['dir'] / 'ssh' / 'authorized_keys').exists())
            for bad in (['--yes'], ['--check'], ['--ja', '7' * 32], ['--yes', 'zu-kurz'], []):
                with self.assertRaises(ValueError, msg=repr(bad)):
                    r.ssh_grant(bad)
            with self.assertRaisesRegex(ValueError, 'keine offene Einladung'):
                r.ssh_grant(['--yes', '7' * 32])

    def test_a_corrupt_state_file_is_reported_and_never_replaced_and_taildrop_errors_are_readable(self):
        self.two_macs()
        with self.as_mac('studio'):
            (self.macs['studio']['dir'] / 'base' / 'taildrop.json').write_text('{kaputt')
            with self.assertRaisesRegex(ValueError, 'taildrop.json ist ungültig'):
                r.ssh_invite(['100.64.0.5'])
            self.assertEqual(list((self.macs['book']['dir'] / 'inbox').iterdir()), [])                       # nichts verschickt, bevor der Zustand lesbar ist
            self.assertEqual((self.macs['studio']['dir'] / 'base' / 'taildrop.json').read_text(), '{kaputt')
            (self.macs['studio']['dir'] / 'base' / 'taildrop.json').unlink()
        real_run = subprocess.run

        def only_file_get(outcome):
            def run(command, *args, **kwargs):
                if 'file' in command[:3]:                                                  # nur `file get` ist ersetzt, der Status bleibt echt
                    if isinstance(outcome, Exception):
                        raise outcome
                    return outcome
                return real_run(command, *args, **kwargs)
            return run
        with self.as_mac('book'), patch.object(r.subprocess, 'run', side_effect=only_file_get(Mock(returncode=1, stdout='', stderr='Taildrop is not enabled'))):
            with self.assertRaisesRegex(ValueError, 'Taildrop ist auf diesem Mac nicht verfügbar'):
                r.ssh_inbox()
        with self.as_mac('book'), patch.object(r.subprocess, 'run', side_effect=only_file_get(Mock(returncode=1, stdout='', stderr='Access denied: file get'))):
            with self.assertRaisesRegex(ValueError, 'set --operator'):
                r.ssh_inbox()
        with self.as_mac('book'), patch.object(r.subprocess, 'run', side_effect=only_file_get(subprocess.TimeoutExpired('x', 25))):
            with self.assertRaisesRegex(ValueError, 'nicht rechtzeitig'):
                r.ssh_inbox()

    def test_keygen_and_routing(self):
        with patch.object(r, 'ensure_client_key') as ensure, patch.object(r, 'own_public_key', return_value=(Path('x.pub'), 'ssh-ed25519 AAAA x', FP)):
            self.assertIn('✔ SSH-Schlüssel vorhanden', self.out(r.main, ['ssh', 'keygen']))
        ensure.assert_called_once_with()
        for bad in (['ssh', 'keygen', 'x'], ['ssh', 'inbox', 'x'], ['ssh', 'invite'], ['ssh', 'accept'], ['ssh', 'grant']):
            with self.assertRaises(ValueError, msg=repr(bad)):
                r.main(bad)

    def test_a_local_name_never_asks_tailscale_and_a_tailnet_line_is_a_valid_target(self):
        with self.tailscale_stub(self.tailnet_status()):
            r.ssh_set(['user@remote-mac.local'])
            with patch.object(r, 'unreachable_reason', return_value='nodename nor servname provided, or not known'), \
                 self.assertRaises(ValueError) as caught:
                r.ssh_require_reachable(r.saved_ssh_target())
            self.assertNotIn('Tailnet', str(caught.exception))
            self.assertEqual(self.stub_calls(), [])                                           # .local fragt Tailscale gar nicht erst
        for host in (self.TAILNET, '100.64.0.5'):
            self.assertEqual(r.ssh_target(f'user@{host}'), {'user': 'user', 'host': host, 'port': 22})

    # --- Tailscale steuern: Anzeige, Verbinden, Anmelden, „mit VibeCode starten und beenden“ -----------------------------
    # Wieder nur die Attrappe: kein echtes up/down/logout, kein echter Browser, nie sudo.

    def fake_tailscale(self, payload=None, /, **commands):
        """A fake CLI: `status` prints status.json; any other command prints <cmd>.err, exits with <cmd>.exit and, if
        <cmd>.after exists, replaces the status (so `up` can turn Stopped into Running). commands: name=(exit, stderr, after)."""
        base = Path(self.tmp.name) / 'fake-ts'
        base.mkdir(exist_ok=True)
        for old in base.iterdir():                                      # every call starts from a clean stub and an empty call log
            old.unlink()
        self.fake_dir, self.stub_log = base, base / 'calls.log'
        (base / 'status.json').write_text(json.dumps(payload) if payload is not None else '')
        for name, (code, err, after) in commands.items():
            (base / f'{name}.exit').write_text(str(code))
            (base / f'{name}.err').write_text(err)
            if after is not None:
                (base / f'{name}.after').write_text(json.dumps(after))
        stub = base / 'tailscale'
        d = shlex.quote(str(base))
        stub.write_text(f"""#!/bin/sh
echo "BE_CLI=$TAILSCALE_BE_CLI $*" >> {d}/calls.log
if [ "$1" = status ]; then
  [ -f {d}/status.exit ] && {{ cat {d}/status.err >&2; exit "$(cat {d}/status.exit)"; }}
  cat {d}/status.json; exit 0
fi
[ -f {d}/$1.err ] && cat {d}/$1.err >&2
[ -f {d}/$1.after ] && cp {d}/$1.after {d}/status.json
[ -f {d}/$1.exit ] && exit "$(cat {d}/$1.exit)"
exit 0
""")
        stub.chmod(0o755)
        return patch.dict(os.environ, {'VIBECODE_TAILSCALE': str(stub)})

    def ts_calls(self):
        """Calls of the fake CLI except `status`."""
        return [line for line in (self.stub_log.read_text().splitlines() if self.stub_log.exists() else []) if ' status' not in line]

    def ts_show(self):
        return json.loads(self.out(r.tailscale_main, ['show']))

    def test_show_maps_every_state_and_lists_devices_cleaned_and_online_first(self):
        peers = [('zeta', '100.64.0.9', False, '2026-11-20T10:00:00Z'), ('alpha\x1b[31m', '100.64.0.8', True, '0001-01-01T00:00:00Z'),
                 ('beta', '100.64.0.7', True, '')]
        status = self.tailnet_status(peers=[(f'{n}.example-tailnet.ts.net', ip, on) for n, ip, on, _ in peers])
        for key, (_, _, _, seen) in zip(status['Peer'], peers):
            status['Peer'][key].update(HostName='x' * 200 if seen == '' else peers[0][0], OS='macOS\x07', LastSeen=seen)
        with self.fake_tailscale(status):
            data = self.ts_show()
        self.assertEqual((data['variant'], data['state'], data['name'], data['ip'], data['tailnet']),
                         ('cli', 'running', self.TAILNET, '100.64.0.5', 'example-tailnet.ts.net'))
        self.assertEqual([d['online'] for d in data['devices']], [True, True, False])                       # online zuerst
        self.assertTrue(all(len(d['name']) <= 60 and '\x1b' not in d['name'] and '\x07' not in d['os'] for d in data['devices']))
        self.assertEqual([d['lastSeen'] for d in data['devices']], ['', '', '2026-11-20T10:00:00Z'])       # „0001-…“ ist „nie“
        for backend, expected in (('Stopped', 'stopped'), ('NeedsLogin', 'needs-login'), ('NeedsMachineAuth', 'needs-approval'),
                                  ('Starting', 'starting'), ('Seltsam', 'unknown')):
            with self.subTest(backend), self.fake_tailscale(self.tailnet_status(state=backend)):
                self.assertEqual(self.ts_show()['state'], expected)
        with self.fake_tailscale(None, status=(1, 'failed to connect to local tailscaled; it does not appear to be running', None)):
            self.assertEqual(self.ts_show()['state'], 'daemon-down')
        with self.fake_tailscale(None, status=(1, 'Access denied: status access denied', None)):
            self.assertEqual(self.ts_show()['state'], 'denied')
        with patch.dict(os.environ, {'VIBECODE_TAILSCALE': ''}):
            data = self.ts_show()
        self.assertEqual((data['variant'], data['state'], data['devices']), ('missing', 'missing', []))

    def test_the_app_variant_is_told_apart_from_the_cli_one(self):
        self.assertEqual((r.tailscale_variant('/Applications/Tailscale.app/Contents/MacOS/Tailscale'), r.tailscale_variant('/opt/homebrew/bin/tailscale'),
                          r.tailscale_variant(None)), ('app', 'cli', 'missing'))

    def test_the_autostart_switch_is_stored_apart_and_a_corrupt_file_is_never_read_as_off(self):
        self.assertEqual(r.tailscale_settings(), {'auto': False})
        before = (Path(self.tmp.name) / 'config.json').read_text() if (Path(self.tmp.name) / 'config.json').exists() else None
        self.out(r.tailscale_main, ['auto', 'on'])
        self.assertEqual(json.loads((Path(self.tmp.name) / 'tailscale.json').read_text()), {'version': 1, 'auto': True})
        after = (Path(self.tmp.name) / 'config.json').read_text() if (Path(self.tmp.name) / 'config.json').exists() else None
        self.assertEqual(before, after)                                                                    # config.json bleibt unberührt
        self.out(r.tailscale_main, ['auto', 'off'])
        self.assertEqual(r.tailscale_settings(), {'auto': False})
        for bad in ('{', '[]', '{"auto": "ja"}', '{"version": 2, "auto": true}', '{"auto": true, "x": 1}'):
            (Path(self.tmp.name) / 'tailscale.json').write_text(bad)
            with self.assertRaises(ValueError, msg=bad):
                r.tailscale_settings()
            with self.fake_tailscale(self.tailnet_status()):
                self.assertIn('ungültig', self.ts_show()['autoError'])                                    # das Fenster warnt …
                self.assertEqual(r.tailscale_ensure(), 'aus')                                            # … und ein Start bricht nicht ab
                self.assertEqual(self.ts_calls(), [])
        with self.assertRaises(ValueError):
            self.out(r.tailscale_main, ['auto', 'vielleicht'])

    def test_connect_is_a_bare_up_and_refuses_when_it_would_hang_or_cannot_work(self):
        with self.fake_tailscale(self.tailnet_status(state='Stopped'), up=(0, '', self.tailnet_status())):
            r.write('tailscale-ours.json', {'boot': 'b', 'launched': 1})
            self.assertIn('verbunden', self.out(r.tailscale_main, ['up']))
            self.assertEqual(self.ts_calls(), ['BE_CLI=1 up'])                                           # ohne jede Option
            self.assertFalse((Path(self.tmp.name) / 'tailscale-ours.json').exists())                     # von Hand: nicht mehr „von uns“
            self.out(r.tailscale_main, ['up'])
            self.assertEqual(self.ts_calls(), ['BE_CLI=1 up'])                                           # läuft schon: nichts zu tun
        with self.fake_tailscale(self.tailnet_status(state='NeedsLogin')), self.assertRaisesRegex(ValueError, 'nicht angemeldet'):
            r.tailscale_up()                                                                             # ein up würde ewig warten
        self.assertEqual(self.ts_calls(), [])
        with self.fake_tailscale(None, status=(1, 'Access denied: status access denied', None)), self.assertRaisesRegex(ValueError, 'set --operator'):
            r.tailscale_up()
        with self.fake_tailscale(self.tailnet_status(state='Stopped'), up=(1, 'Access denied: checkprefs access denied', None)), \
             self.assertRaisesRegex(ValueError, 'set --operator'):
            r.tailscale_up()
        with patch.dict(os.environ, {'VIBECODE_TAILSCALE': ''}), self.assertRaisesRegex(ValueError, 'nicht installiert'):
            r.tailscale_down()

    def test_disconnect_and_logout_run_exactly_those_commands(self):
        with self.fake_tailscale(self.tailnet_status(), down=(0, '', self.tailnet_status(state='Stopped'))):
            r.write('tailscale-ours.json', {'boot': 'b', 'launched': 1})
            self.out(r.tailscale_main, ['down'])
            self.assertEqual(self.ts_calls(), ['BE_CLI=1 down'])
            self.assertFalse((Path(self.tmp.name) / 'tailscale-ours.json').exists())
        with self.fake_tailscale(self.tailnet_status(state='Stopped'), logout=(0, '', None)):
            self.out(r.tailscale_main, ['logout'])
            self.assertEqual(self.ts_calls(), ['BE_CLI=1 logout'])

    def test_login_opens_only_an_https_auth_link_and_never_waits_forever(self):
        url = 'https://login.example.invalid/a/abc123'
        waiting = self.tailnet_status(state='NeedsLogin')
        waiting['AuthURL'] = url
        with self.fake_tailscale(waiting), patch.object(r, 'run') as run, patch.object(r, 'detached') as popen:
            popen.return_value.pid = 4242
            shown = self.out(r.tailscale_login)
        self.assertEqual(json.loads(shown), {'url': url})
        run.assert_called_once_with('/usr/bin/open', url, check=False)
        self.assertEqual(popen.call_args.args[0][1:], ['up'])                                            # ein ungebundenes up wartet auf den Browser
        self.assertEqual(r.read('tailscale-login.json'), {'pid': 4242})
        for bad in ('http://login.example.invalid/a/x', 'javascript:alert(1)', 'https://x y', 'file:///etc/passwd', '', 5):
            odd = self.tailnet_status(state='NeedsLogin')
            odd['AuthURL'] = bad
            with self.subTest(repr(bad)), self.fake_tailscale(odd), patch.object(r, 'run') as run, patch.object(r, 'detached') as popen:
                popen.return_value.pid = 1
                with self.assertRaisesRegex(ValueError, 'keinen Anmelde-Link'):
                    r.tailscale_login(wait=0)
            self.assertEqual([c for c in run.call_args_list if c.args[0] == '/usr/bin/open'], [])        # nichts wird geöffnet
        with self.fake_tailscale(self.tailnet_status()), patch.object(r, 'detached') as popen:
            self.assertEqual(json.loads(self.out(r.tailscale_login)), {'url': ''})                      # schon verbunden: kein up, kein Link
            popen.assert_not_called()

    def test_login_falls_back_to_the_link_that_up_itself_prints(self):
        url = 'https://login.example.invalid/a/zzz999'

        def fake_up(command, out, env=None):                                                       # `up` schreibt den Link in sein Log
            out.write(f'\nTo authenticate, visit:\n\n\t{url}\n\n')
            out.flush()
            return Mock(pid=9)
        waiting = self.tailnet_status(state='NeedsLogin')                                          # der Status nennt ihn (noch) nicht
        with self.fake_tailscale(waiting), patch.object(r, 'run') as run, patch.object(r, 'detached', side_effect=fake_up):
            self.assertEqual(json.loads(self.out(r.tailscale_login)), {'url': url})
        run.assert_any_call('/usr/bin/open', url, check=False)
        with self.fake_tailscale(waiting), patch.object(r, 'run') as run, patch.object(r, 'detached', side_effect=lambda c, out, env=None: Mock(pid=9)):
            (Path(self.tmp.name) / 'tailscale-login.log').write_text('')
            with self.assertRaisesRegex(ValueError, 'keinen Anmelde-Link'):
                r.tailscale_login(wait=0)
        self.assertEqual([c for c in run.call_args_list if c.args[0] == '/usr/bin/open'], [])

    def test_a_stale_login_process_is_ended_only_if_it_really_is_our_up(self):
        waiting = self.tailnet_status(state='NeedsLogin')
        waiting['AuthURL'] = 'https://login.example.invalid/a/abc'
        for ours, killed in ((True, True), (False, False)):
            r.write('tailscale-login.json', {'pid': 777})
            with self.subTest(ours), self.fake_tailscale(waiting), patch.object(r, 'run'), patch.object(r, 'detached') as popen, \
                 patch.object(r, 'pid_runs', return_value=ours) as check, patch.object(r.os, 'kill') as kill:
                popen.return_value.pid = 5
                self.out(r.tailscale_login)
            self.assertTrue(check.call_args.args[1].endswith(' up'))
            self.assertEqual(kill.called, killed)                                                        # eine wiederverwendete pid bleibt unberührt

    def test_ensure_only_acts_when_the_switch_is_on_and_tailscale_can_be_controlled(self):
        r.tailscale_auto(['on'])
        stopped, running = self.tailnet_status(state='Stopped'), self.tailnet_status()
        with patch.object(r, 'spawn_watcher') as spawn, patch.object(r, 'boot_id', return_value='boot-1'):
            # aus -> nichts
            r.tailscale_auto(['off'])
            with self.fake_tailscale(stopped, up=(0, '', running)):
                self.assertEqual(r.tailscale_ensure(), 'aus')
                self.assertEqual(self.ts_calls(), [])
            r.tailscale_auto(['on'])
            # Stopped -> up mit Wartezeit, Marke, Wächter
            with self.fake_tailscale(stopped, up=(0, '', running)):
                self.assertEqual(r.tailscale_ensure(wait=5), 'verbunden')
                self.assertEqual(self.ts_calls(), ['BE_CLI=1 up'])
            marker = r.read('tailscale-ours.json')
            self.assertEqual((marker['boot'], marker['seen']), ('boot-1', False))
            spawn.assert_called_once_with()
            # schon an, ohne Marke: nicht unseres -> nichts, kein Wächter
            spawn.reset_mock()
            (Path(self.tmp.name) / 'tailscale-ours.json').unlink()
            with self.fake_tailscale(running):
                self.assertEqual(r.tailscale_ensure(), 'lief schon')
                self.assertEqual(self.ts_calls(), [])
            self.assertFalse((Path(self.tmp.name) / 'tailscale-ours.json').exists())
            spawn.assert_not_called()
            # schon an, mit Marke: neuer Start -> Marke frisch, Wächter sicherstellen
            r.write('tailscale-ours.json', {'boot': 'boot-1', 'launched': 5.0, 'seen': True, 'lastSeen': 6.0})
            with self.fake_tailscale(running):
                self.assertEqual(r.tailscale_ensure(), 'wird verbunden')
            marker = r.read('tailscale-ours.json')
            self.assertFalse(marker['seen'])
            self.assertGreater(marker['launched'], 5.0)
            spawn.assert_called_once_with()
            # Marke aus einem früheren Start des Macs: ungültig, nicht unseres
            spawn.reset_mock()
            r.write('tailscale-ours.json', {'boot': 'boot-0', 'launched': 5.0})
            with self.fake_tailscale(running):
                self.assertEqual(r.tailscale_ensure(), 'lief schon')
            self.assertFalse((Path(self.tmp.name) / 'tailscale-ours.json').exists())
            # nicht steuerbar oder nicht angemeldet -> überspringen, nichts anfassen, nichts werfen
            for label, context in (('NeedsLogin', self.fake_tailscale(self.tailnet_status(state='NeedsLogin'))),
                                   ('Dienst aus', self.fake_tailscale(None, status=(1, 'not running', None))),
                                   ('verweigert', self.fake_tailscale(None, status=(1, 'Access denied', None))),
                                   ('fehlt', patch.dict(os.environ, {'VIBECODE_TAILSCALE': ''}))):
                with self.subTest(label), context:
                    self.assertEqual(r.tailscale_ensure(), 'übersprungen')
                    self.assertFalse((Path(self.tmp.name) / 'tailscale-ours.json').exists())
            spawn.assert_not_called()

    def test_ensure_without_wait_starts_up_detached_and_a_slow_up_does_not_stop_the_watcher(self):
        r.tailscale_auto(['on'])
        with self.fake_tailscale(self.tailnet_status(state='Stopped')), patch.object(r, 'spawn_watcher') as spawn, \
             patch.object(r, 'boot_id', return_value='b'), patch.object(r, 'detached') as popen:
            self.assertEqual(r.tailscale_ensure(), 'wird verbunden')                                    # kein Warten: der Start bleibt flott
        self.assertEqual(popen.call_args.args[0][1:], ['up'])
        spawn.assert_called_once_with()
        real = subprocess.run

        def slow_up(command, *args, **kwargs):
            if list(command[1:]) == ['up']:
                raise subprocess.TimeoutExpired(command, 1)
            return real(command, *args, **kwargs)
        with self.fake_tailscale(self.tailnet_status(state='Stopped')), patch.object(r, 'spawn_watcher') as spawn, \
             patch.object(r, 'boot_id', return_value='b'), patch.object(r.subprocess, 'run', side_effect=slow_up):
            self.assertEqual(r.tailscale_ensure(wait=1), 'verbunden')
        spawn.assert_called_once_with()                                                                 # verbindet noch: der Wächter läuft trotzdem

    def heartbeat(self, name, age, now):
        folder = Path(self.tmp.name) / 'tailscale-sessions'
        folder.mkdir(exist_ok=True)
        file = folder / f'{name}.json'
        file.write_text('{}')
        os.utime(file, (now - age, now - age))
        return file

    def watch(self, steps, status=None, marker=True, boot='b', **options):
        """Run the watcher on a fake clock. `steps` is called after every poll with (clock, advance) and may end the run."""
        clock = {'now': 1000.0}
        if marker:
            r.write('tailscale-ours.json', {'boot': boot, 'launched': 1000.0, 'seen': False, 'lastSeen': 0})

        class Stop(Exception):
            pass

        def sleep(seconds):
            clock['now'] += seconds
            if steps(clock) is False:
                raise Stop()
        with self.fake_tailscale(status or self.tailnet_status(), down=(0, '', self.tailnet_status(state='Stopped'))), \
             patch.object(r, 'boot_id', return_value='b'):
            try:
                result = r.tailscale_watch(clock=lambda: clock['now'], sleep=sleep, **options)
            except Stop:
                result = 'läuft noch'
        self.watch_end = clock['now']                                                            # die Uhr beim Ende: wann wurde getrennt?
        return result

    def test_the_watcher_disconnects_after_the_last_window_closed_and_only_then(self):
        state = {'closed': False}

        def steps(clock):
            if clock['now'] < 1100:
                self.heartbeat('window-1', 5, clock['now'])                                     # ein Fenster meldet sich
            elif not state['closed']:
                state['closed'] = True
                (Path(self.tmp.name) / 'tailscale-sessions' / 'window-1.json').unlink()         # Fenster zu
        self.assertEqual(self.watch(steps), 'getrennt')
        self.assertEqual(self.ts_calls(), ['BE_CLI=1 down'])
        self.assertFalse((Path(self.tmp.name) / 'tailscale-ours.json').exists())
        self.assertFalse((Path(self.tmp.name) / 'tailscale-sessions').exists())                  # Wächter räumt auf

    def test_the_watcher_waits_for_the_grace_period_and_a_second_window_keeps_tailscale_on(self):
        calls = {'n': 0}

        def steps(clock):
            calls['n'] += 1
            if calls['n'] < 4:
                self.heartbeat('window-1', 5, clock['now'])
            elif calls['n'] < 40:
                self.heartbeat('window-2', 5, clock['now'])                                      # Fenster 1 zu, Fenster 2 lebt
            else:
                return False
        self.assertEqual(self.watch(steps), 'läuft noch')
        self.assertEqual(self.ts_calls(), [])
        self.assertTrue((Path(self.tmp.name) / 'tailscale-ours.json').exists())
        self.assertFalse((Path(self.tmp.name) / 'tailscale-sessions').exists() and any((Path(self.tmp.name) / 'tailscale-sessions').iterdir()))

    def test_waking_from_sleep_never_disconnects_while_the_windows_reconnect(self):
        state = {'phase': 0, 'jumped': False}

        def steps(clock):
            if state['phase'] < 3:
                state['phase'] += 1
                self.heartbeat('window-1', 5, clock['now'])                                     # vor dem Schlaf: ein Fenster meldet sich
            elif not state['jumped']:
                state['jumped'] = True
                clock['now'] += 3600                                                            # Deckel zu, eine Stunde später: alles pausierte
            elif clock['now'] < 1000 + 3600 + 40:
                pass                                                                            # der Wächter ist vor der Erweiterung wach: keine frische Datei
            elif clock['now'] < 1000 + 3600 + 100:
                self.heartbeat('window-1', 2, clock['now'])                                     # die Erweiterung meldet sich wieder
            else:
                return False
        self.assertEqual(self.watch(steps), 'läuft noch')
        self.assertEqual(self.ts_calls(), [])                                                   # kein down, obwohl lastSeen eine Stunde alt war

    def test_a_window_closed_during_sleep_is_noticed_after_a_full_grace_period_not_at_once(self):
        state = {'polls': 0, 'jumped_at': None}

        def steps(clock):
            state['polls'] += 1
            if state['polls'] <= 3:
                self.heartbeat('window-1', 5, clock['now'])
            elif state['polls'] == 4:
                (Path(self.tmp.name) / 'tailscale-sessions' / 'window-1.json').unlink()         # das Fenster ist im Schlaf zugegangen
                clock['now'] += 3600
                state['jumped_at'] = clock['now']
        self.assertEqual(self.watch(steps), 'getrennt')
        self.assertEqual(self.ts_calls(), ['BE_CLI=1 down'])
        self.assertGreaterEqual(self.watch_end - state['jumped_at'], 60)                        # erst nach einer vollen Schonfrist, nicht sofort

    def test_the_watcher_never_disconnects_when_no_window_ever_reported(self):
        self.assertEqual(self.watch(lambda clock: None, patience=300), 'keine Fenstermeldung')
        self.assertEqual(self.ts_calls(), [])                                                    # im Zweifel bleibt Tailscale an
        self.assertFalse((Path(self.tmp.name) / 'tailscale-ours.json').exists())

    def test_the_watcher_leaves_foreign_stale_and_manually_changed_states_alone(self):
        self.assertEqual(self.watch(lambda clock: False, marker=False), 'keine Marke')           # nicht von uns gestartet
        self.assertEqual(self.watch(lambda clock: False, boot='anderer-start'), 'keine Marke')   # Marke aus einem früheren Start
        self.assertEqual(self.watch(lambda clock: False, status=self.tailnet_status(state='Stopped')), 'nicht mehr verbunden')
        self.assertFalse((Path(self.tmp.name) / 'tailscale-ours.json').exists())
        self.assertEqual(self.ts_calls(), [])                                                    # keiner dieser Fälle ruft down auf

    def test_a_stale_heartbeat_counts_as_closed_and_a_new_launch_starts_the_wait_again(self):
        now = 5000.0
        folder = Path(self.tmp.name) / 'tailscale-sessions'
        self.assertEqual(r.live_sessions(now), [])
        self.heartbeat('alt', r.HEARTBEAT_FRESH + 1, now)
        self.heartbeat('neu', 3, now)
        self.heartbeat('zukunft', -500, now)                                                     # Uhrfehler: nie „lebendig“
        self.assertEqual([f.name for f in r.live_sessions(now)], ['neu.json'])
        (folder / 'notiz.txt').write_text('x')
        self.assertEqual([f.name for f in r.live_sessions(now)], ['neu.json'])
        # nach einem neuen Start steht „gesehen“ wieder auf aus: ohne neue Meldung wird nicht getrennt
        r.write('tailscale-ours.json', {'boot': 'b', 'launched': 1000.0, 'seen': False, 'lastSeen': 900.0})
        with patch.object(r, 'boot_id', return_value='b'):
            self.assertEqual(self.watch(lambda clock: False if clock['now'] > 1200 else None, marker=False, patience=10000), 'läuft noch')
        self.assertEqual(self.ts_calls(), [])

    def test_only_one_watcher_runs_and_it_starts_detached_without_a_terminal(self):
        import fcntl
        with (Path(self.tmp.name) / 'tailscale-watch.lock').open('a+') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertTrue(r.watcher_running())
            self.assertEqual(r.tailscale_watch(sleep=lambda s: None), 'läuft schon')
            with patch.object(r, 'detached') as popen:
                r.spawn_watcher()
            popen.assert_not_called()
        self.assertFalse(r.watcher_running())
        with patch.object(r, 'detached') as popen:
            r.spawn_watcher()
        self.assertEqual(popen.call_args.args[0][1:], [str(Path(r.__file__).resolve()), 'tailscale', 'watch'])
        self.assertTrue((Path(self.tmp.name) / 'tailscale-sessions').is_dir())                   # ab jetzt melden sich die Fenster
        with patch.object(r.subprocess, 'Popen') as popen:
            r.detached(['/bin/echo'])
        self.assertTrue(popen.call_args.kwargs['start_new_session'])
        self.assertEqual((popen.call_args.kwargs['stdin'], popen.call_args.kwargs['stdout']), (subprocess.DEVNULL, subprocess.DEVNULL))   # kein Terminal

    def test_the_setup_script_is_valid_sh_runs_sudo_only_for_the_two_steps_and_interpolates_nothing(self):
        script = Path(self.tmp.name) / 'setup.sh'
        script.write_text(r.TAILSCALE_SETUP)
        self.assertEqual(subprocess.run(['/bin/sh', '-n', str(script)]).returncode, 0)
        sudo_lines = [line.strip() for line in r.TAILSCALE_SETUP.splitlines() if line.strip().startswith('sudo ')]
        self.assertEqual(sudo_lines, ['sudo "$BREW" services start tailscale || exit 1', 'sudo "$TAILSCALE" set --operator="$USER" || exit 1'])
        self.assertIn('/Applications/Tailscale.app', r.TAILSCALE_SETUP)                          # die App und der Dienst vertragen sich nicht
        self.assertIn('brew.sh', r.TAILSCALE_SETUP)
        with patch.object(r.os, 'execv') as execv:
            self.out(r.tailscale_main, ['setup'])
        execv.assert_called_once_with('/bin/sh', ['/bin/sh', '-c', r.TAILSCALE_SETUP])
        for bad in (['show', 'x'], ['gibt-es-nicht'], ['ensure', '--wait'], ['ensure', '--wait', 'x'], ['auto']):
            with self.assertRaises(ValueError, msg=repr(bad)):
                self.out(r.tailscale_main, bad)

    def test_summary_is_one_json_line_for_the_window(self):
        self.c.update(apps=['Codex', 'Claude'])
        r.write('config.json', self.c)
        for active, text, level in [(True, 'Wachhalten AN · Apps: Codex, Claude', 'ok'),
                                    (False, 'Wachhalten AUS · Apps: Codex, Claude', 'off')]:
            with patch.object(r, 'wake_active', return_value=active):
                shown = self.out(r.summary)
            self.assertEqual(json.loads(shown), {'text': text, 'level': level})
        self.c.update(apps=[])
        r.write('config.json', self.c)
        with patch.object(r, 'wake_active', return_value=False):
            self.assertIn('keine Apps gewählt', json.loads(self.out(r.summary))['text'])

    def test_window_switch_reflects_requested_mode_even_if_controller_is_down(self):
        r.write('config.json', {'keep_awake': True, 'apps': ['Codex']})
        with patch.object(r, 'wake_active', return_value=False):
            pending = json.loads(self.out(r.main, ['wake-state']))
        self.assertTrue(pending['enabled'])
        self.assertFalse(pending['active'])
        self.assertEqual(pending['level'], 'warn')
        self.assertIn('Controller', pending['text'])
        self.assertIn('Apps: Codex', pending['text'])
        with patch.object(r, 'wake_active', return_value=True):
            active = json.loads(self.out(r.wake_state))
        self.assertEqual(active['level'], 'ok')
        r.deactivate()
        with patch.object(r, 'wake_active', return_value=True):
            stopped = json.loads(self.out(r.wake_state))
        self.assertFalse(stopped['enabled'])
        self.assertEqual(stopped['level'], 'off')

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
