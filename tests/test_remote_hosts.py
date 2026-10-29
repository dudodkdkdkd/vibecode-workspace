import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location('remote_hosts',
    Path(__file__).resolve().parents[1] / 'workspaces' / 'remote-hosts.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


class RemoteHostTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='vibecode-hosts-')
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name).resolve()
        self.config = self.base / 'config'

    def repo(self, path, worktree=False):
        path.mkdir(parents=True)
        marker = path / '.git'
        if worktree:
            marker.write_text('gitdir: /elsewhere/worktrees/test\n')
        else:
            marker.mkdir()
        return str(path)

    def fake_ssh(self):
        executable = self.base / 'bin' / 'ssh'
        executable.parent.mkdir()
        executable.write_text('''#!/usr/bin/env python3
import json, os, subprocess, sys
with open(os.environ['SSH_ARGS_CAPTURE'], 'w') as handle:
    json.dump(sys.argv[1:], handle)
sys.stdout.buffer.write(b'Login banner before scanner\\n')
sys.stdout.buffer.flush()
result = subprocess.run(['/bin/sh', '-c', sys.argv[-1]], input=sys.stdin.buffer.read())
raise SystemExit(result.returncode)
''')
        executable.chmod(0o755)
        args_file = self.base / 'ssh-args.json'
        return {'PATH': str(executable.parent) + os.pathsep + os.environ['PATH'],
                'SSH_ARGS_CAPTURE': str(args_file)}, args_file

    def test_recursive_scan_detects_nested_repos_and_worktrees_and_skips_dependencies(self):
        remote_home = self.base / 'server-home'
        a = self.repo(remote_home / 'projects' / "Repo 'ä' #1%")
        b = self.repo(remote_home / 'nested' / 'group' / 'worktree', worktree=True)
        self.repo(remote_home / 'projects' / 'node_modules' / 'vendor')
        self.repo(remote_home / '.cache' / 'clone')
        self.repo(remote_home / 'Library' / 'clone')
        self.repo(Path(a) / '.git' / 'nested')
        env, capture = self.fake_ssh()
        with patch.dict(os.environ, {**env, 'HOME': str(remote_home)}):
            paths, partial = r.scan('user@server', '~')
            self.assertEqual(paths, sorted([a, b]))
            self.assertFalse(partial)
            arguments = json.loads(capture.read_text())
            self.assertIn('BatchMode=yes', arguments)
            self.assertEqual(arguments[-3:-1], ['--', 'user@server'])
            self.assertEqual(r.scan('server', '~/projects')[0], [a])

    def test_remote_root_is_a_literal_argument_even_with_shell_syntax(self):
        marker = self.base / 'must-not-exist'
        # A relative marker also proves that $() is never expanded by the shell.
        root = self.base / "quoted ' $(touch must-not-exist)"
        repo = self.repo(root / 'app')
        env, _capture = self.fake_ssh()
        with patch.dict(os.environ, env):
            self.assertEqual(r.scan('server', str(root))[0], [repo])
        self.assertFalse(marker.exists())
        self.assertFalse(Path('must-not-exist').exists())

    def test_refresh_adds_new_repos_removes_deleted_repos_and_preserves_config(self):
        r.add_host(self.config, 'spark', '~/projects')
        settings = (self.config / 'remote-hosts.json').read_text()
        with patch.object(r, 'scan', return_value=(["/repos/Repo 'ä' #1%", '/repos/old'], False)):
            projects = r.discover(self.config)
        self.assertEqual(projects[0], ("Repo 'ä' #1% [SSH: spark]",
            "vscode-remote://ssh-remote+spark/repos/Repo%20'%C3%A4'%20%231%25"))
        with patch.object(r, 'scan', return_value=(['/repos/new'], False)):
            self.assertEqual(r.discover(self.config), [('new [SSH: spark]',
                'vscode-remote://ssh-remote+spark/repos/new')])
        self.assertEqual((self.config / 'remote-hosts.json').read_text(), settings)
        self.assertEqual(r.snapshot(self.config)['spark']['paths'], ['/repos/new'])

    def test_offline_timeout_and_cached_diagnostics_preserve_last_successful_inventory(self):
        r.add_host(self.config, 'spark', '~')
        with patch.object(r, 'scan', return_value=(['/repos/app'], False)):
            expected = r.discover(self.config)
        original = (self.config / 'remote-repositories.json').read_text()
        log = io.StringIO()
        with patch.object(r, 'scan', side_effect=subprocess.TimeoutExpired('ssh', 15)):
            self.assertEqual(r.discover(self.config, output=log), expected)
        self.assertIn('Verwende 1', log.getvalue())
        self.assertEqual((self.config / 'remote-repositories.json').read_text(), original)
        with patch.object(r, 'scan') as scan:
            self.assertEqual(r.discover(self.config, cached=True), expected)
            scan.assert_not_called()

    def test_partial_scan_merges_previous_repos_but_a_successful_empty_scan_clears_them(self):
        r.add_host(self.config, 'spark', '~')
        with patch.object(r, 'scan', return_value=(['/repos/old'], False)):
            r.discover(self.config)
        with patch.object(r, 'scan', return_value=(['/repos/new'], True)):
            self.assertEqual(len(r.discover(self.config, output=io.StringIO())), 2)
        with patch.object(r, 'scan', return_value=([], False)):
            self.assertEqual(r.discover(self.config), [])
        self.assertEqual(r.snapshot(self.config)['spark']['paths'], [])

    def test_update_host_root_does_not_reuse_repos_from_old_root_and_deduplicates_host(self):
        r.add_host(self.config, 'spark', '/old')
        with patch.object(r, 'scan', return_value=(['/old/app'], False)):
            r.discover(self.config)
        r.add_host(self.config, 'spark', '/new/')
        self.assertEqual(r.hosts(self.config), [{'host': 'spark', 'root': '/new'}])
        self.assertEqual(r.discover(self.config, cached=True), [])

    def test_unreachable_host_does_not_hide_another_hosts_repos(self):
        r.add_host(self.config, 'offline', '~')
        r.add_host(self.config, 'online', '~')
        def scan(host, _root, _interactive):
            if host == 'offline':
                raise ValueError('Host offline')
            return ['/repos/app'], False
        with patch.object(r, 'scan', side_effect=scan):
            self.assertEqual(r.discover(self.config, output=io.StringIO()),
                [('app [SSH: online]', 'vscode-remote://ssh-remote+online/repos/app')])

    def test_invalid_settings_are_rejected_without_overwriting_them(self):
        r.add_host(self.config, 'spark', '~')
        original = (self.config / 'remote-hosts.json').read_text()
        for host, root in [('-option', '~'), ('spark:22', '~'), ('spark', '../repo'),
                           ('spark', '/home/../repo'), ('spark', '/path\nother')]:
            with self.assertRaises(ValueError):
                r.add_host(self.config, host, root)
            self.assertEqual((self.config / 'remote-hosts.json').read_text(), original)
        for data in [[], {'version': 2, 'hosts': []}, {'version': 1, 'hosts': 'invalid'},
                     {'version': 1, 'hosts': [{'host': 'spark', 'root': None}]}]:
            contents = json.dumps(data)
            (self.config / 'remote-hosts.json').write_text(contents)
            with self.assertRaises(ValueError):
                r.add_host(self.config, 'other', '~')
            self.assertEqual((self.config / 'remote-hosts.json').read_text(), contents)

    def test_malformed_scan_protocol_never_becomes_a_successful_empty_snapshot(self):
        for result in [subprocess.CompletedProcess([], 0, stdout=b'banner only', stderr=b''),
                       subprocess.CompletedProcess([], 255, stdout=b'', stderr=b'SSH failed')]:
            with patch.object(r.subprocess, 'run', return_value=result):
                with self.assertRaises(ValueError):
                    r.scan('spark', '~')
        result = subprocess.CompletedProcess([], 3,
            stdout=b'VIBECODE_REMOTE_REPOS\0/repos/app/.git\0', stderr=b'Permission denied')
        with patch.object(r.subprocess, 'run', return_value=result):
            self.assertEqual(r.scan('spark', '~'), (['/repos/app'], True))

    def test_invalid_snapshot_is_not_silently_replaced_with_an_empty_inventory(self):
        r.add_host(self.config, 'spark', '~')
        for data in [[], {'version': 2, 'hosts': {}}, {'version': 1, 'hosts': []},
                     {'version': 1, 'hosts': {'spark': {'root': '~', 'paths': 'invalid'}}},
                     {'version': 1, 'hosts': {'spark': {'root': '~', 'paths': ['/repo\nother']}}}]:
            contents = json.dumps(data)
            cache = self.config / 'remote-repositories.json'
            cache.write_text(contents)
            with patch.object(r, 'scan') as scan:
                with self.assertRaises(ValueError):
                    r.discover(self.config)
                scan.assert_not_called()
            self.assertEqual(cache.read_text(), contents)


if __name__ == '__main__':
    unittest.main()
