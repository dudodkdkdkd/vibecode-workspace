import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location('ssh_setup',
    Path(__file__).resolve().parents[1] / 'workspaces' / 'ssh-setup.py')
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)


class SSHSetupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='vibecode-ssh-')
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name).resolve()
        self.ssh_dir = self.base / 'ssh folder'
        self.ssh_dir.mkdir(mode=0o700)
        self.config_dir = self.base / 'config'
        self.key = self.ssh_dir / 'test_key'

    def effective(self, alias):
        result = subprocess.run(['ssh', '-G', '-F', str(self.ssh_dir / 'config'), alias],
                                check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return dict(line.split(' ', 1) for line in result.stdout.decode().splitlines() if ' ' in line)

    def test_aliases_include_nested_files_without_running_match_commands(self):
        includes = self.ssh_dir / 'hosts'
        includes.mkdir()
        (self.ssh_dir / 'config').write_text('Include hosts/*\nHost first second *.example !excluded\n')
        (includes / 'one').write_text('Host=third\nInclude config\nMatch exec "touch must-not-exist"\n')
        self.assertEqual(s.aliases(self.ssh_dir), ['third', 'first', 'second'])
        self.assertFalse(Path('must-not-exist').exists())

    def test_new_connection_precedes_defaults_and_preserves_other_hosts_and_original_text(self):
        config = self.ssh_dir / 'config'
        original = '# Original\nHost *\n User fallback\n Port 2200\nHost keep\n HostName existing.example\n'
        config.write_text(original)
        before = self.effective('keep')
        backup = s.save_connection(self.ssh_dir, 'spark', 'ubuntu@192.0.2.5', '2222', self.key)
        self.assertTrue(config.read_text().endswith(original))
        self.assertEqual(backup.read_text(), original)
        actual = self.effective('spark')
        self.assertEqual(actual['hostname'], '192.0.2.5')
        self.assertEqual(actual['user'], 'ubuntu')
        self.assertEqual(actual['port'], '2222')
        self.assertEqual(actual['identitiesonly'], 'yes')
        for name in ['hostname', 'user', 'port', 'identityfile']:
            self.assertEqual(self.effective('keep')[name], before[name])
        self.assertEqual(config.stat().st_mode & 0o777, 0o600)

    def test_adding_connection_preserves_a_symlinked_config_and_supports_ipv6(self):
        target = self.base / 'dotfiles-config'
        target.write_text('Host keep\n HostName keep.example\n')
        config = self.ssh_dir / 'config'
        config.symlink_to(target)
        s.save_connection(self.ssh_dir, 'v6', 'user@[2001:db8::1]', 22, self.key)
        self.assertTrue(config.is_symlink())
        self.assertEqual(self.effective('v6')['hostname'], '2001:db8::1')
        self.assertIn('Host keep', target.read_text())

    def test_duplicate_and_invalid_configuration_never_overwrite_existing_config(self):
        config = self.ssh_dir / 'config'
        original = 'Host spark\n HostName keep.example\n'
        config.write_text(original)
        with self.assertRaises(ValueError):
            s.save_connection(self.ssh_dir, 'SPARK', 'user@new.example', 22, self.key)
        self.assertEqual(config.read_text(), original)
        config.write_text('InvalidSSHDirective yes\n')
        with self.assertRaises(ValueError):
            s.save_connection(self.ssh_dir, 'other', 'user@new.example', 22, self.key)
        self.assertEqual(config.read_text(), 'InvalidSSHDirective yes\n')
        self.assertEqual(list(self.ssh_dir.glob('config.vibecode-backup-*')), [])

    def test_invalid_connection_fields_fail_before_writing_any_files(self):
        for alias, target, port in [('bad name', 'u@host', 22), ('-flag', 'u@host', 22),
                                    ('ok', 'host', 22), ('ok', 'u@host\nProxyCommand evil', 22),
                                    ('ok', 'u@host', '22\n'), ('ok', 'u@host', 65536)]:
            with self.assertRaises(ValueError):
                s.save_connection(self.ssh_dir, alias, target, port, self.key)
        self.assertFalse((self.ssh_dir / 'config').exists())

    def test_existing_private_key_is_not_overwritten_and_missing_public_key_is_recovered(self):
        subprocess.run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(self.key)],
                       check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        private = self.key.read_bytes()
        public = Path(str(self.key) + '.pub')
        public.unlink()
        self.assertEqual(s.ensure_key(self.key, output=lambda _: None), public)
        self.assertEqual(self.key.read_bytes(), private)
        self.assertTrue(public.read_text().startswith('ssh-ed25519 '))

    def test_public_key_installation_is_idempotent_and_preserves_existing_keys(self):
        server = self.base / 'server'
        authorized = server / '.ssh' / 'authorized_keys'
        authorized.parent.mkdir(parents=True)
        original = 'ssh-ed25519 AAAA existing-without-newline'
        authorized.write_text(original)
        key = 'ssh-ed25519 AAAABBBB comment with \'quotes\' $(touch must-not-exist)'
        for _ in range(2):
            subprocess.run(['/bin/sh', '-c', s.INSTALL_KEY], input=(key + '\n').encode(),
                           env={**os.environ, 'HOME': str(server)}, check=True, stdout=subprocess.PIPE)
        self.assertTrue(authorized.read_text().startswith(original + '\n'))
        self.assertEqual(authorized.read_text().splitlines().count(key), 1)
        self.assertEqual(authorized.stat().st_mode & 0o777, 0o600)
        self.assertFalse(Path('must-not-exist').exists())

    def test_probe_requires_a_marker_and_a_fresh_connection(self):
        with patch.object(s.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, b'banner only')) as command:
            self.assertFalse(s.probe('spark'))
            self.assertIn('BatchMode=yes', command.call_args.args[0])
            self.assertIn('ControlPath=none', command.call_args.args[0])
        with patch.object(s.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, b'\nVIBECODE_CONNECTED\n')):
            self.assertTrue(s.probe('spark'))

    def test_new_wizard_registers_host_only_after_key_login_and_repo_scan_succeed(self):
        answers = iter(['', 'ubuntu@192.0.2.5', 'spark', '2222', '~/projects'])
        with patch.object(s, 'ensure_key', return_value=Path(str(self.key) + '.pub')), \
             patch.object(s, 'load_key'), patch.object(s, 'probe', side_effect=[False, True]), \
             patch.object(s, 'install_key') as install, \
             patch.object(s.remote_hosts, 'scan', return_value=(['/srv/app'], False)):
            self.assertEqual(s.wizard(self.config_dir, self.ssh_dir, lambda _: next(answers), lambda _: None), 'spark')
        install.assert_called_once()
        self.assertEqual(s.remote_hosts.hosts(self.config_dir), [{'host': 'spark', 'root': '~/projects'}])
        self.assertEqual(s.remote_hosts.snapshot(self.config_dir)['spark']['paths'], ['/srv/app'])
        self.assertEqual(self.effective('spark')['user'], 'ubuntu')

    def test_existing_connection_can_unlock_and_install_its_configured_key_without_rewriting_config(self):
        config = self.ssh_dir / 'config'
        original = 'Host spark\n HostName existing.example\n'
        config.write_text(original)
        self.key.write_text('test private key stand-in')
        answers = iter(['1', '~/projects', '1'])
        with patch.object(s, 'configured_keys', return_value=[self.key]), \
             patch.object(s, 'ensure_key', return_value=Path(str(self.key) + '.pub')), \
             patch.object(s, 'load_key'), patch.object(s, 'probe', side_effect=[False, False, True, False, True]), \
             patch.object(s, 'install_key') as install, \
             patch.object(s.remote_hosts, 'scan', return_value=([], False)):
            s.wizard(self.config_dir, self.ssh_dir, lambda _: next(answers), lambda _: None)
        install.assert_called_once()
        self.assertEqual(config.read_text(), original)

    def test_cancel_or_failed_login_never_registers_an_automatic_host(self):
        with self.assertRaises(KeyboardInterrupt):
            s.wizard(self.config_dir, self.ssh_dir, lambda _: 'q', lambda _: None)
        self.assertFalse(self.config_dir.exists())
        answers = iter(['', 'ubuntu@192.0.2.5', 'spark', '', ''])
        with patch.object(s, 'ensure_key', return_value=Path(str(self.key) + '.pub')), \
             patch.object(s, 'load_key'), patch.object(s, 'probe', return_value=False), \
             patch.object(s, 'install_key'), patch.object(s.remote_hosts, 'scan') as scan:
            with self.assertRaisesRegex(ValueError, 'weiterhin eine Anmeldung'):
                s.wizard(self.config_dir, self.ssh_dir, lambda _: next(answers), lambda _: None)
            scan.assert_not_called()
        self.assertFalse((self.config_dir / 'remote-hosts.json').exists())


if __name__ == '__main__':
    unittest.main()
