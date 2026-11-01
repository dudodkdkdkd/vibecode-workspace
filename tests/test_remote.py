"""No launchd, pmset mutations, apps or real caffeinate processes in these tests."""
import contextlib
import datetime as dt
import getpass
import importlib.util
import io
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
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

    def test_ssh_target_accepts_user_host_and_port(self):
        self.assertEqual(r.ssh_target('tobias@mac-studio.local', 2222),
                         {'user': 'tobias', 'host': 'mac-studio.local', 'port': 2222})
        self.assertEqual(r.ssh_target('100.64.0.7')['user'], '')

    def test_ssh_target_rejects_values_ssh_would_read_as_options(self):
        for value in ['-oProxyCommand=evil', 'tobias@-oProxyCommand=evil',
                      '-oProxyCommand=evil@host', 'tobias@host name', 'tobias@', '', '@host']:
            with self.assertRaises(ValueError, msg=value):
                r.ssh_target(value)
        for port in [0, 65536, '22', True, None]:
            with self.assertRaises(ValueError, msg=repr(port)):
                r.ssh_target('tobias@host', port)

    def test_ssh_set_persists_target_outside_config_json(self):
        r.write('config.json', {'keep_awake': True, 'apps': ['Claude']})
        r.ssh_set(['tobias@mac-studio.local', '2222'])
        self.assertEqual(r.read('ssh.json'),
                         {'user': 'tobias', 'host': 'mac-studio.local', 'port': 2222})
        # Extra keys in config.json would be migrated away by normalize_settings().
        self.assertEqual(r.read('config.json'), {'keep_awake': True, 'apps': ['Claude']})
        self.assertEqual(r.ssh_command(r.saved_ssh_target())[-1], 'tobias@mac-studio.local')
        with self.assertRaises(ValueError):
            r.ssh_set(['tobias@mac-studio.local', 'abc'])
        with self.assertRaises(ValueError):
            r.ssh_set([])

    def test_ssh_connect_hands_over_to_ssh_when_reachable(self):
        r.ssh_set(['tobias@mac-studio.local', '2222'])
        with patch.object(r.socket, 'create_connection') as reach, \
             patch.object(r.os, 'execv') as execv:
            r.ssh_connect()
        reach.assert_called_once_with(('mac-studio.local', 2222), timeout=5)
        argv = execv.call_args.args[1]
        self.assertEqual(execv.call_args.args[0], '/usr/bin/ssh')
        self.assertEqual(argv[:3], ['/usr/bin/ssh', '-p', '2222'])
        self.assertEqual(argv[-1], 'tobias@mac-studio.local')

    def test_ssh_connect_explains_unreachable_mac_and_never_execs(self):
        r.ssh_set(['tobias@mac-studio.local'])
        with patch.object(r.socket, 'create_connection', side_effect=OSError('timed out')), \
             patch.object(r.os, 'execv') as execv:
            with self.assertRaises(ValueError) as caught:
                r.ssh_connect()
        execv.assert_not_called()
        self.assertIn('workspace remote on', str(caught.exception))

    def test_ssh_run_is_a_non_interactive_one_shot(self):
        r.ssh_set(['tobias@mac-studio.local', '2222'])
        with patch.object(r.socket, 'create_connection'), patch.object(r.os, 'execv') as execv:
            r.main(['ssh', 'run', '--', 'uname', '-a'])
            run_argv = execv.call_args.args[1]
            r.main(['ssh'])
            login_argv = execv.call_args.args[1]
        self.assertIn('BatchMode=yes', run_argv)
        self.assertEqual(run_argv[-2:], ['tobias@mac-studio.local', 'uname -a'])
        # The interactive login must keep allowing a password / host-key prompt.
        self.assertNotIn('BatchMode=yes', login_argv)
        self.assertEqual(login_argv[-1], 'tobias@mac-studio.local')

    def test_ssh_run_needs_a_command(self):
        r.ssh_set(['tobias@mac-studio.local'])
        with patch.object(r.socket, 'create_connection'), patch.object(r.os, 'execv') as execv:
            for words in (['ssh', 'run'], ['ssh', 'run', '--'], ['ssh', 'run', '  ']):
                with self.assertRaises(ValueError, msg=repr(words)):
                    r.main(words)
        execv.assert_not_called()

    def test_ssh_pair_installs_the_key_with_the_saved_port(self):
        r.ssh_set(['tobias@mac-studio.local', '2222'])
        with patch.object(r.socket, 'create_connection'), patch.object(r.os, 'execv') as execv:
            r.main(['ssh', 'pair'])
            execv.assert_called_once_with(
                '/usr/bin/ssh-copy-id',
                ['/usr/bin/ssh-copy-id', '-p', '2222', 'tobias@mac-studio.local'])
            with self.assertRaises(ValueError):
                r.main(['ssh', 'pair', 'extra'])

    def test_ssh_run_and_pair_never_exec_when_unreachable(self):
        r.ssh_set(['tobias@mac-studio.local'])
        with patch.object(r.socket, 'create_connection', side_effect=OSError('down')), \
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

    # --- Freigeben (Studio) / Zugriff holen (MacBook) ---------------------------------

    def make_key(self, name='id_ed25519', comment='tobias@macbook'):
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
        key = self.make_key(comment='tobias@macbook')
        shutil.rmtree(self.ssh_dir)          # first run on a Mac without ~/.ssh: allow creates it
        keys = self.ssh_dir / 'authorized_keys'
        shown = self.out(r.ssh_allow, [key, '--yes'])
        self.assertIn('tobias@macbook', shown)
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
        host_key = self.make_key('host_key', 'root@studio')
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
        target = r.ssh_target('tobias@127.0.0.1')
        known_hosts = self.ssh_dir / 'known_hosts'
        with self.assertRaisesRegex(ValueError, 'NICHT'):
            r.pin_host_key(target, FP)
        self.assertFalse(known_hosts.exists())
        r.pin_host_key(target, fingerprint)
        self.assertEqual(known_hosts.read_text(), entry + '\n')
        self.assertEqual(stat.S_IMODE(known_hosts.stat().st_mode), 0o600)

    def test_join_never_overrides_an_already_known_host_key(self):
        self.fake_host(known=True)
        r.pin_host_key(r.ssh_target('tobias@127.0.0.1'), FP)   # wrong fingerprint, but host is known
        self.assertFalse((self.ssh_dir / 'known_hosts').exists())

    def test_join_fails_when_the_host_key_cannot_be_read(self):
        self.fake_host(scan=False)
        with self.assertRaisesRegex(ValueError, 'gelesen'):
            r.pin_host_key(r.ssh_target('tobias@127.0.0.1'), FP)

    def test_join_saves_target_pins_key_and_confirms_the_login(self):
        probe = Mock(returncode=0, stderr='')
        with patch.object(r, 'ssh_require_reachable') as reachable, \
             patch.object(r, 'pin_host_key') as pin, \
             patch.object(r.subprocess, 'run', return_value=probe) as ssh:
            shown = self.out(r.ssh_join, ['tobias@mac-studio.local', FP, '2222'])
        target = {'user': 'tobias', 'host': 'mac-studio.local', 'port': 2222}
        reachable.assert_called_once_with(target)
        pin.assert_called_once_with(target, FP)
        self.assertEqual(r.read('ssh.json'), target)
        self.assertIn('✔ Verbunden', shown)
        argv = ssh.call_args.args[0]
        self.assertIn('BatchMode=yes', argv)
        self.assertEqual(argv[-2:], ['tobias@mac-studio.local', 'true'])

    def test_join_without_arguments_rechecks_the_saved_target(self):
        r.ssh_set(['tobias@mac-studio.local'])
        with patch.object(r, 'ssh_require_reachable'), patch.object(r, 'pin_host_key') as pin, \
             patch.object(r.subprocess, 'run', return_value=Mock(returncode=0, stderr='')):
            self.assertIn('✔ Verbunden', self.out(r.ssh_join, []))
        pin.assert_not_called()

    def test_join_not_yet_allowed_prints_the_allow_line_and_exits_2(self):
        key = self.make_key(comment='tobias@macbook')
        denied = Mock(returncode=255, stderr='tobias@h: Permission denied (publickey).\n')
        with patch.object(r, 'ssh_require_reachable'), \
             patch.object(r.subprocess, 'run', return_value=denied), \
             patch.object(r, 'keygen_fingerprint', return_value=FP), \
             patch.object(r, 'clipboard', return_value=True) as clip:
            with self.assertRaises(SystemExit) as caught:
                shown = io.StringIO()
                with contextlib.redirect_stdout(shown):
                    r.ssh_join(['tobias@mac-studio.local'])
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
                    self.out(r.ssh_join, ['tobias@mac-studio.local'])

    def test_join_rejects_bad_arguments_before_touching_the_network(self):
        with patch.object(r, 'ssh_require_reachable') as reachable:
            for args in (['tobias@h', 'nonsense'], ['tobias@h', 'SHA256:short'], ['-oProxyCommand=x']):
                with self.assertRaises(ValueError, msg=repr(args)):
                    self.out(r.ssh_join, args)
        reachable.assert_not_called()
        self.assertIsNone(r.read('ssh.json'))

    def test_share_opens_settings_when_remote_login_is_off(self):
        with patch.object(r, 'ssh_listening', return_value=False), \
             patch.object(r, 'wake_active', return_value=True), \
             patch.object(r, 'run', return_value=Mock(stdout='Mac-Studio\n')) as run, \
             patch.object(r, 'clipboard') as clip:
            shown = self.out(r.ssh_share, [])
        run.assert_any_call('/usr/bin/open', r.SHARING_PANE, check=False)
        clip.assert_not_called()
        self.assertIn('Entfernte Anmeldung', shown)

    def test_share_copies_the_join_line_with_fingerprint_when_ready(self):
        with patch.object(r, 'ssh_listening', return_value=True), \
             patch.object(r, 'wake_active', return_value=True), \
             patch.object(r, 'host_fingerprint', return_value=FP), \
             patch.object(r, 'run', return_value=Mock(stdout='Mac-Studio\n')) as run, \
             patch.object(r, 'clipboard', return_value=True) as clip:
            shown = self.out(r.ssh_share, [])
        line = f'workspace remote ssh join {getpass.getuser()}@Mac-Studio.local {FP}'
        clip.assert_called_once_with(line)
        self.assertIn(line, shown)
        self.assertIn('Zwischenablage', shown)
        self.assertNotIn(call('/usr/bin/open', r.SHARING_PANE, check=False), run.call_args_list)

    def test_share_wake_flag_turns_keep_awake_on_and_rejects_unknown_flags(self):
        with patch.object(r, 'ssh_listening', return_value=True), \
             patch.object(r, 'wake_active', return_value=False), \
             patch.object(r, 'host_fingerprint', return_value=FP), \
             patch.object(r, 'run', return_value=Mock(stdout='Mac-Studio\n')), \
             patch.object(r, 'clipboard', return_value=False), \
             patch.object(r, 'activate') as activate:
            shown = self.out(r.ssh_share, ['--wake'])
            activate.assert_called_once_with()
            self.assertIn('Wachhalten           AN', shown)
            with self.assertRaises(ValueError):
                self.out(r.ssh_share, ['--wirklich'])
            activate.assert_called_once_with()

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
