"""VibeCode Grundapp: Workspaces, Schreibtisch-Shortcuts, Module.

Echte Finder-Aliasse (macOS) in einem Wegwerf-"Schreibtisch"; ~/.config und der echte
Schreibtisch werden nie berührt.
"""
import importlib.util
import io
import json
import os
import shlex
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unicodedata
import unittest
from contextlib import redirect_stdout
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('vibecode_core', ROOT / 'core' / 'vibecode.py')
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)


class CoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='vibecode-core-'))
        self.addCleanup(lambda: subprocess.run(['/bin/rm', '-rf', str(self.tmp)]))
        self.config, self.desktop = self.tmp / 'config', self.tmp / 'desktop'
        self.desktop.mkdir()
        env = patch.dict(os.environ, {'VIBECODE_CONFIG_DIR': str(self.config),
                                      'VIBECODE_DESKTOP_DIR': str(self.desktop)})
        env.start()
        self.addCleanup(env.stop)

    def save(self, name='Demo', projects=('A', 'B'), shortcut=False, rename_from=None):
        return core.save_workspace(name, list(projects), shortcut, rename_from)

    def alias_target(self, name):
        state = core.alias_js('inspect', str(self.desktop / name))
        return Path(state[6:]) if state.startswith('alias ') else state

    # --- Validierung --------------------------------------------------------------

    def test_names_are_normalized_and_unsafe_names_rejected(self):
        self.assertEqual(core.clean_name('  Demo   Alle \t'), 'Demo Alle')
        self.assertEqual(core.clean_name('Für Demo'), 'Für Demo')
        for bad in ['', '   ', 'a/b', 'a:b', 'a\\b', '.versteckt', 'x' * 61, 'a\x07b', 5, None]:
            with self.assertRaises(ValueError, msg=repr(bad)):
                core.clean_name(bad)

    def test_projects_are_deduplicated_and_must_not_be_empty(self):
        self.assertEqual(core.clean_projects(['A', 'B', 'A']), ['A', 'B'])
        for bad in [[], ['A', ''], ['A\nB'], 'A', [1], None]:
            with self.assertRaises(ValueError, msg=repr(bad)):
                core.clean_projects(bad)

    def test_corrupt_store_is_rejected_never_replaced_by_an_empty_list(self):
        path = self.config / 'workspaces.json'
        self.config.mkdir()
        for bad in ['{', '[]', '{"version": 2, "workspaces": []}',
                    '{"version": 1, "workspaces": [{"name": "A", "projects": ["x"]}]}',
                    '{"version": 1, "workspaces": [{"name": "A", "projects": [], "shortcut": false}]}',
                    '{"version": 1, "workspaces": [{"name": "A", "projects": ["x"], "shortcut": "ja"}]}']:
            path.write_text(bad)
            with self.assertRaises(ValueError, msg=bad):
                core.read_store()
            with self.assertRaises(ValueError, msg=bad):
                self.save('Neu')
            self.assertEqual(path.read_text(), bad)

    # --- Speichern, Umbenennen, Löschen -----------------------------------------

    def test_save_rename_and_delete_keep_store_consistent(self):
        self.save('Demo', ['A'])
        self.save('Demo', ['A', 'B'], rename_from='Demo')          # nur Projekte ändern
        self.assertEqual(core.read_store()['workspaces'][0]['projects'], ['A', 'B'])
        self.save('Alle', ['A', 'B'], rename_from='Demo')
        self.assertEqual([w['name'] for w in core.read_store()['workspaces']], ['Alle'])
        with self.assertRaisesRegex(ValueError, 'schon einen Workspace'):
            self.save('alle', ['A'])                                      # Groß/Klein zählt als gleich
        with self.assertRaisesRegex(ValueError, 'nicht mehr'):
            self.save('X', ['A'], rename_from='Gibt es nicht')
        core.delete_workspace('ALLE')
        self.assertEqual(core.read_store()['workspaces'], [])
        with self.assertRaises(ValueError):
            core.delete_workspace('Alle')

    # --- Schreibtisch-Shortcut: echte Aliasse ------------------------------------

    def test_shortcut_creates_a_real_alias_to_an_executable_starter(self):
        self.save('Für Demo', ['A'], shortcut=True)
        starter = core.starter_path('Für Demo')
        self.assertEqual(self.alias_target('Für Demo').resolve(), starter.resolve())
        self.assertTrue(stat.S_IMODE(starter.stat().st_mode) & 0o100)
        self.assertIn("run 'Für Demo'", starter.read_text())
        self.assertTrue(core.read_store()['workspaces'][0]['shortcut'])

    def test_turning_the_shortcut_off_and_deleting_remove_only_our_files(self):
        self.save('Demo', ['A'], shortcut=True)
        self.save('Demo', ['A'], shortcut=False, rename_from='Demo')
        self.assertEqual(self.alias_target('Demo'), 'missing')
        self.assertFalse(core.starter_path('Demo').exists())
        self.save('Demo', ['A'], shortcut=True, rename_from='Demo')
        core.delete_workspace('Demo')
        self.assertEqual(self.alias_target('Demo'), 'missing')
        self.assertEqual(list((self.config / 'shortcuts').glob('*')), [])

    def test_renaming_moves_the_alias_and_case_only_renames_work(self):
        self.save('Alt', ['A'], shortcut=True)
        self.save('Neu', ['A'], shortcut=True, rename_from='Alt')
        self.assertEqual(self.alias_target('Alt'), 'missing')
        self.assertEqual(self.alias_target('Neu').resolve(), core.starter_path('Neu').resolve())
        self.save('NEU', ['A'], shortcut=True, rename_from='Neu')
        self.assertEqual([p.name for p in self.desktop.iterdir()], ['NEU'])
        self.assertEqual(self.alias_target('NEU').resolve(), core.starter_path('NEU').resolve())

    def test_a_foreign_file_on_the_desktop_is_never_overwritten_or_deleted(self):
        foreign = self.desktop / 'Demo'
        foreign.write_text('meine Datei')
        with self.assertRaisesRegex(ValueError, 'nicht von VibeCode'):
            self.save('Demo', ['A'], shortcut=True)
        self.assertEqual(core.read_store()['workspaces'], [])            # nichts gespeichert
        self.save('Demo', ['A'], shortcut=False)                      # ohne Shortcut ist es erlaubt
        core.delete_workspace('Demo')
        self.assertEqual(foreign.read_text(), 'meine Datei')

    def test_a_dead_alias_of_that_name_is_replaced(self):
        self.save('Demo', ['A'], shortcut=True)
        core.starter_path('Demo').unlink()
        self.assertEqual(core.alias_js('inspect', str(self.desktop / 'Demo')), 'alias-broken')
        self.assertEqual(core.sync_shortcuts(), 1)
        self.assertEqual(self.alias_target('Demo').resolve(), core.starter_path('Demo').resolve())

    def test_failed_shortcut_leaves_the_stored_configuration_unchanged(self):
        self.save('Demo', ['A'])
        (self.desktop / 'Neu').write_text('fremd')
        with self.assertRaises(ValueError):
            self.save('Neu', ['B'], shortcut=True, rename_from='Demo')
        self.assertEqual([w['name'] for w in core.read_store()['workspaces']], ['Demo'])

    def test_generated_starter_passes_the_exact_name_to_the_app(self):
        fake = self.tmp / 'repo'
        (fake / 'core').mkdir(parents=True)
        (fake / 'core' / 'vibecode.py').write_text('import sys, json; print(json.dumps(sys.argv[1:]))')
        self.config.mkdir(exist_ok=True)
        (self.config / 'home').write_text(str(fake) + '\n')
        for name in ["Für 'Demo' & Co", 'a b']:
            self.save(name, ['A'], shortcut=False)
            core.add_shortcut(name)
            out = subprocess.run(['/bin/zsh', str(core.starter_path(name))], capture_output=True, text=True,
                                 env=dict(os.environ), timeout=30)
            self.assertEqual(json.loads(out.stdout), ['run', name], out.stderr)

    def test_wake_setting_uses_only_on_off_and_reports_failures(self):
        with patch.object(core, 'call_module', return_value={'code': 0, 'out': '', 'err': ''}) as call:
            self.cli('settings', 'keep-awake', 'on')
            call.assert_called_once_with('remote', ['on'], timeout=30)
            call.reset_mock()
            core.setting_action('keep-awake', False)
            call.assert_called_once_with('remote', ['off'], timeout=30)
            for name, value in [('unknown', True), ('keep-awake', 'yes')]:
                with self.assertRaises(ValueError):
                    core.setting_action(name, value)
            self.assertEqual(call.call_count, 1)
        with patch.object(core, 'call_module', return_value={'code': 1, 'out': '', 'err': 'Start fehlgeschlagen'}):
            with self.assertRaisesRegex(ValueError, 'Start fehlgeschlagen'):
                core.setting_action('keep-awake', True)

    def test_wake_status_handles_missing_module_and_invalid_status(self):
        with patch.object(core, 'module_entries', return_value=[]):
            self.assertIsNone(core.wake_state())
        good = {'enabled': True, 'active': False, 'text': 'Controller startet', 'level': 'warn'}
        with patch.object(core, 'call_module', return_value={'code': 0, 'out': json.dumps(good), 'err': ''}) as call:
            self.assertEqual(core.wake_state(), good)
            call.assert_called_once_with('remote', ['wake-state'], timeout=20)
        for out in ['[]', '{', '{"enabled": "yes", "text": "AN", "level": "ok"}']:
            with patch.object(core, 'call_module', return_value={'code': 0, 'out': out, 'err': ''}):
                self.assertIsNone(core.wake_state()['enabled'])
                self.assertEqual(core.wake_state()['level'], 'warn')

    # --- Start ---------------------------------------------------------------------

    def test_run_executes_the_launcher_with_one_project_flag_per_project(self):
        self.save('Demo', ['A', 'B'])
        with patch.object(core.os, 'execv') as execv:
            core.run_workspace('demo')
        execv.assert_called_once_with(str(core.LAUNCHER), [str(core.LAUNCHER), '--project', 'A', '--project', 'B'])
        self.assertEqual((self.config / 'home').read_text().strip(), str(core.REPO))
        with self.assertRaises(ValueError):
            core.run_workspace('gibt es nicht')

    def test_start_is_detached_and_logs_instead_of_losing_output(self):
        self.save('Demo', ['A'])
        with patch.object(core.subprocess, 'Popen') as popen:
            core.start_workspace('Demo')
        self.assertEqual(popen.call_args.args[0], [str(core.LAUNCHER), '--project', 'A'])
        self.assertTrue(popen.call_args.kwargs['start_new_session'])
        self.assertTrue((self.config / 'last-start.log').exists())

    # --- Module ---------------------------------------------------------------------

    def test_repository_modules_register_themselves(self):
        entries = {e['id']: e for e in core.module_entries()}
        self.assertEqual(set(entries), {'launch', 'setup', 'preset-store', 'search-folders', 'hosts', 'remote', 'local'})
        self.assertFalse(entries['hosts'].get('menu'))        # Hilfseintrag, kein Menüpunkt
        argv = core.entry_argv(entries['remote'], ['ssh', 'share'])
        self.assertEqual(argv[0], 'python3')
        self.assertEqual(argv[1], str(ROOT / 'remote' / 'remote.py'))
        self.assertEqual(argv[2:], ['ssh', 'share'])
        self.assertTrue(Path(argv[1]).is_file())
        for entry in entries.values():
            self.assertTrue(Path(core.entry_argv(entry)[-1].split(' --')[0]).exists() or entry['run'][0] == 'python3'
                            or Path(entry['run'][-1].replace('{module}', entry['dir'])).exists(), entry['id'])

    def test_broken_or_conflicting_manifests_are_rejected(self):
        fake = self.tmp / 'repo'
        for index, manifest in enumerate([
                '{', '{"entries": [{"id": "Bad Id", "title": "x", "run": ["a"]}]}',
                '{"entries": [{"id": "run", "title": "x", "run": ["a"]}]}',           # reserviertes Wort
                '{"entries": [{"id": "ok", "title": "x", "run": []}]}']):
            (fake / f'm{index}').mkdir(parents=True)
            (fake / f'm{index}' / 'module.json').write_text(manifest)
            with patch.object(core, 'REPO', fake), self.assertRaises(ValueError, msg=manifest):
                core.module_entries()
            (fake / f'm{index}' / 'module.json').unlink()
        for name in ('one', 'two'):
            (fake / name).mkdir(exist_ok=True)
            (fake / name / 'module.json').write_text('{"entries": [{"id": "dup", "title": "x", "run": ["a"]}]}')
        with patch.object(core, 'REPO', fake), self.assertRaisesRegex(ValueError, 'denselben Befehl'):
            core.module_entries()

    def test_state_reports_missing_projects_and_menu_entries(self):
        self.save('Demo', ['A', 'weg'], shortcut=False)
        with patch.object(core, 'list_project_paths', return_value=[('A', '/a'), ('B', '/b')]):
            state = core.state()
        self.assertEqual(state['workspaces'][0]['missing'], ['weg'])
        self.assertEqual(state['projects'], ['A', 'B'])
        self.assertEqual([e['id'] for e in state['entries']], ['local'])
        self.assertTrue(state['canLaunch'])
        self.assertEqual(list(state['settings']), ['wake'])                              # der App-Shortcut ist entfernt

    def test_list_projects_reads_the_launcher_and_reports_its_failures(self):
        ok = Mock(returncode=0, stdout='A\n\nB\n', stderr='')
        with patch.object(core.subprocess, 'run', return_value=ok) as run:
            self.assertEqual(core.list_projects(), ['A', 'B'])
        self.assertEqual(run.call_args.args[0], [str(core.LAUNCHER), '--list-projects'])
        with patch.object(core.subprocess, 'run', return_value=Mock(returncode=1, stdout='', stderr='kaputt')):
            with self.assertRaisesRegex(ValueError, 'kaputt'):
                core.list_projects()

    # --- Kommandozeile ----------------------------------------------------------------

    def cli(self, *argv):
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            code = core.main(list(argv))
        return code, buffer.getvalue()

    def test_command_line_saves_lists_and_deletes(self):
        code, out = self.cli('save', '--name=-seltsam', '--project=A', '--project=B', '--shortcut')
        self.assertEqual(code, 0)
        self.assertIn('Shortcut: ja', out)
        self.assertEqual(self.cli('list')[1].strip(), '-seltsam\tA, B\tShortcut')
        self.cli('delete', '--name=-seltsam')
        self.assertEqual(self.cli('list')[1], '')
        self.assertEqual(self.alias_target('-seltsam'), 'missing')
        with self.assertRaises(ValueError):
            self.cli('save', '--name=X')                                 # kein Projekt
        with self.assertRaisesRegex(ValueError, 'Unbekannter Befehl'):
            self.cli('gibtsnicht')

    # --- SSH im Hauptfenster ------------------------------------------------------------

    def fake_home(self):
        """HOME/VIBECODE_REMOTE_DIR zeigen in den Wegwerf-Ordner: weder ~/.ssh noch die echte Config werden berührt."""
        home = self.tmp / 'home'
        home.mkdir()
        patcher = patch.dict(os.environ, {'HOME': str(home), 'VIBECODE_REMOTE_DIR': str(self.tmp / 'remote-config')})
        patcher.start()
        self.addCleanup(patcher.stop)
        return home

    def make_key(self, comment='user@client'):
        key = self.tmp / 'throwaway'
        subprocess.run(['/usr/bin/ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-C', comment, '-f', str(key)], check=True)
        return (self.tmp / 'throwaway.pub').read_text().strip()

    def test_ssh_state_combines_hosts_and_the_saved_mac(self):
        replies = {'hosts': {'code': 0, 'out': '[{"host": "spark", "root": "~/p", "repos": 3}]', 'err': ''},
                   'remote': {'code': 0, 'out': '{"target": {"user": "t", "host": "remote-mac.local", "port": 22}}', 'err': ''}}
        with patch.object(core, 'call_module', side_effect=lambda entry, args, timeout=60: replies[entry]) as call:
            info = core.ssh_state()
        self.assertEqual(info['hosts'], [{'host': 'spark', 'root': '~/p', 'repos': 3}])
        self.assertEqual(info['mac'], {'user': 't', 'host': 'remote-mac.local', 'port': 22})
        self.assertTrue(info['available'] and info['guided'] and info['share'])
        self.assertEqual(info['errors'], [])
        self.assertEqual(call.call_args_list[0].args[1], ['list', str(self.config)])

    def test_ssh_state_reports_a_broken_source_without_breaking_the_rest(self):
        replies = {'hosts': {'code': 1, 'out': '', 'err': 'Ungültige remote-hosts.json'},
                   'remote': {'code': 0, 'out': '{"target": null}', 'err': ''}}
        with patch.object(core, 'call_module', side_effect=lambda entry, args, timeout=60: replies[entry]):
            info = core.ssh_state()
        self.assertEqual(info['hosts'], [])
        self.assertEqual(info['errors'], ['hosts: Ungültige remote-hosts.json'])
        self.assertTrue(info['available'])                  # Einrichtung und Freigabe gehen trotzdem

    def test_ssh_state_works_with_the_real_modules_in_an_isolated_home(self):
        self.fake_home()
        self.config.mkdir()
        (self.config / 'remote-hosts.json').write_text('{"version": 1, "hosts": [{"host": "spark", "root": "~/p"}]}')
        (self.config / 'remote-repositories.json').write_text(
            '{"version": 1, "hosts": {"spark": {"root": "~/p", "paths": ["/h/a", "/h/b"]}}}')
        info = core.ssh_state()
        self.assertEqual(info['hosts'], [{'host': 'spark', 'root': '~/p', 'repos': 2}])
        self.assertIsNone(info['mac'])
        self.assertEqual(info['errors'], [])

    def test_ssh_state_is_unavailable_when_no_module_offers_ssh(self):
        fake = self.tmp / 'repo'
        (fake / 'm').mkdir(parents=True)
        (fake / 'm' / 'module.json').write_text('{"entries": [{"id": "other", "title": "x", "run": ["a"]}]}')
        with patch.object(core, 'REPO', fake):
            info = core.ssh_state()
        self.assertFalse(info['available'])

    def test_pasted_lines_are_parsed_without_ever_passing_options(self):
        with patch.object(core, 'call_module', return_value={'code': 0, 'out': '', 'err': ''}) as call:
            core.ssh_action('join', 'workspace remote ssh join user@Remote-Mac.local SHA256:abc --wake\n')
            self.assertEqual(call.call_args.args, ('remote', ['ssh', 'join', 'user@Remote-Mac.local', 'SHA256:abc']))
            core.ssh_action('allow-check', "workspace remote ssh allow --yes 'ssh-ed25519 AAAA user@client'")
            self.assertEqual(call.call_args.args[1], ['ssh', 'allow', '--check', 'ssh-ed25519 AAAA user@client'])
            core.ssh_action('allow', "ssh-ed25519 AAAA name")
            self.assertEqual(call.call_args.args[1], ['ssh', 'allow', '--yes', 'ssh-ed25519', 'AAAA', 'name'])
            core.ssh_action('share', '')                       # JSON für die Maske, nicht der Terminal-Text
            self.assertEqual(call.call_args.args[1], ['ssh', 'share', '--json'])
            core.ssh_action('share-wake')
            self.assertEqual(call.call_args.args[1], ['ssh', 'share', '--json', '--wake'])
            core.ssh_action('share-recheck')                   # „Erneut prüfen“: die Systemeinstellungen nicht noch einmal öffnen
            self.assertEqual(call.call_args.args[1], ['ssh', 'share', '--json', '--no-open'])

    def test_ssh_actions_are_a_fixed_list_and_bad_lines_are_rejected(self):
        with patch.object(core, 'call_module') as call:
            for action, line in [('rm', ''), ('join', ''), ('join', '   '), ('join', 'a\nb'), ('join', "it's open"),
                                 ('join', 'workspace remote ssh join'), ('allow', 'workspace remote ssh allow'),
                                 ('allow', 'x' * 2001), ('allow-check', None)]:
                with self.assertRaises(ValueError, msg=(action, line)):
                    core.ssh_action(action, line)
        call.assert_not_called()

    def test_call_module_returns_exit_codes_instead_of_raising(self):
        self.fake_home()
        shown = core.call_module('remote', ['ssh', 'show'])
        self.assertEqual(shown, {'code': 0, 'out': '{"target": null}', 'err': ''})
        failed = core.call_module('remote', ['ssh', 'nonsense'])
        self.assertEqual(failed['code'], 1)
        self.assertIn('ssh-Befehle', failed['err'])
        with self.assertRaisesRegex(ValueError, 'nicht installiert'):
            core.call_module('gibtsnicht', [])

    def test_allow_through_the_core_checks_first_and_only_then_writes(self):
        home = self.fake_home()
        key = self.make_key()
        line = f"workspace remote ssh allow '{key}'"
        check = core.ssh_action('allow-check', line)
        info = json.loads(check['out'])
        self.assertEqual((check['code'], info['name'], info['known']), (0, 'user@client', False))
        self.assertRegex(info['fingerprint'], r'^SHA256:')
        self.assertFalse((home / '.ssh' / 'authorized_keys').exists())          # prüfen schreibt nichts
        done = core.ssh_action('allow', line)
        self.assertEqual(done['code'], 0, done)
        self.assertEqual((home / '.ssh' / 'authorized_keys').read_text(), key + '\n')
        self.assertTrue(json.loads(core.ssh_action('allow-check', line)['out'])['known'])
        refused = core.ssh_action('allow-check', "workspace remote ssh allow 'command=\"x\" " + key + "'")
        self.assertEqual(refused['code'], 1)

    def test_open_ssh_only_connects_to_configured_hosts(self):
        hosts = {'hosts': [{'host': 'spark', 'root': '~', 'repos': 1}], 'mac': None}
        with patch.object(core, 'ssh_state', return_value=hosts), patch.object(core, 'open_in_terminal') as terminal:
            core.open_ssh('host', 'spark')
            terminal.assert_called_once_with(['/usr/bin/ssh', '--', 'spark'])
            for bad in ('-oProxyCommand=evil', 'unbekannt', None, 'spark; rm -rf ~'):
                with self.assertRaises(ValueError, msg=bad):
                    core.open_ssh('host', bad)
            core.open_ssh('guided')
            self.assertEqual(terminal.call_args.args[0][-1], '--connect-remote')
            core.open_ssh('mac')
            self.assertEqual(terminal.call_args.args[0][-2:], [str(ROOT / 'remote' / 'remote.py'), 'ssh'])
            with self.assertRaises(ValueError):
                core.open_ssh('unbekannt')

    def test_command_line_exposes_ssh_for_the_window_as_json(self):
        with patch.object(core, 'ssh_action', return_value={'code': 2, 'out': 'x', 'err': ''}) as action:
            code, out = self.cli('_ssh', 'join', '--line=-mit Bindestrich')
        action.assert_called_once_with('join', '-mit Bindestrich')
        self.assertEqual(json.loads(out), {'code': 2, 'out': 'x', 'err': ''})
        with patch.object(core, 'open_ssh') as opened:
            self.cli('ssh-open', '--kind=host', '--name=spark')
        opened.assert_called_once_with('host', 'spark')
        with patch.object(core, 'read_store', return_value={'workspaces': []}), \
             patch.object(core, 'list_project_paths', return_value=[('A', '/a')]), \
             patch.object(core, 'ssh_state', return_value={'available': False, 'hosts': []}):
            self.assertEqual(core.state()['ssh'], {'available': False, 'hosts': []})

    # --- Modulstatus für die Übersicht ----------------------------------------------------------

    def status_entry(self, **extra):
        return dict({'id': 'x', 'title': 'x', 'dir': str(self.tmp), 'status': ['python3', '{module}/s.py']}, **extra)

    def test_entry_status_reports_what_the_module_says(self):
        good = Mock(returncode=0, stdout='{"text": "Wachhalten AN", "level": "ok"}')
        with patch.object(core.subprocess, 'run', return_value=good) as run:
            self.assertEqual(core.entry_status(self.status_entry()), {'text': 'Wachhalten AN', 'level': 'ok'})
        self.assertEqual(run.call_args.args[0], [sys.executable, str(self.tmp / 's.py')])
        self.assertIsNone(core.entry_status({'id': 'x', 'title': 'x', 'dir': str(self.tmp)}))

    def test_a_broken_status_becomes_a_visible_warning_never_a_broken_window(self):
        broken = [Mock(returncode=1, stdout='{"text": "a", "level": "ok"}'),       # Exit-Code
                  Mock(returncode=0, stdout='kein json'),
                  Mock(returncode=0, stdout='{"text": "a", "level": "rot"}'),      # unbekannte Stufe
                  Mock(returncode=0, stdout='{"level": "ok"}'),                    # Text fehlt
                  Mock(returncode=0, stdout='[1]'),
                  Mock(returncode=0, stdout='{"text": 5, "level": "ok"}')]
        for reply in broken:
            with patch.object(core.subprocess, 'run', return_value=reply):
                self.assertEqual(core.entry_status(self.status_entry()), {'text': 'Status nicht lesbar', 'level': 'warn'},
                                 reply.stdout)
        with patch.object(core.subprocess, 'run', side_effect=subprocess.TimeoutExpired('x', 15)):
            self.assertEqual(core.entry_status(self.status_entry())['level'], 'warn')
        with patch.object(core.subprocess, 'run', side_effect=FileNotFoundError('fehlt')):
            self.assertEqual(core.entry_status(self.status_entry())['level'], 'warn')

    def test_state_attaches_module_status_in_manifest_order(self):
        said = {'local': {'text': 'Local Dev bereit', 'level': 'ok'}}
        with patch.object(core, 'list_project_paths', return_value=[('A', '/a')]), \
             patch.object(core, 'ssh_state', return_value={'available': False, 'hosts': []}), \
             patch.object(core, 'entry_status', side_effect=lambda entry: said.get(entry['id'])):
            entries = core.state()['entries']
        self.assertEqual([e['id'] for e in entries], ['local'])
        self.assertEqual([e['status'] for e in entries], [said['local']])

    def test_entries_are_ordered_by_order_then_id(self):
        fake = self.tmp / 'repo'
        for name, entries in {'a': [('zeta', 5), ('alpha', None)], 'b': [('beta', None), ('first', 1)]}.items():
            (fake / name).mkdir(parents=True)
            items = ',\n'.join('{"id": "%s", "title": "x", "run": ["a"]%s}' % (
                entry_id, '' if order is None else ', "order": %d' % order) for entry_id, order in entries)
            (fake / name / 'module.json').write_text('{"entries": [%s]}' % items)
        with patch.object(core, 'REPO', fake):
            self.assertEqual([e['id'] for e in core.module_entries()], ['first', 'zeta', 'alpha', 'beta'])

    def test_manifest_status_and_order_are_validated(self):
        fake = self.tmp / 'repo'
        (fake / 'm').mkdir(parents=True)
        for extra in ['"status": []', '"status": "x"', '"status": [1]', '"order": "1"', '"order": true', '"order": 1.5']:
            (fake / 'm' / 'module.json').write_text(
                '{"entries": [{"id": "ok", "title": "x", "run": ["a"], %s}]}' % extra)
            with patch.object(core, 'REPO', fake), self.assertRaises(ValueError, msg=extra):
                core.module_entries()

    def test_repository_modules_describe_themselves_in_the_window(self):
        entries = {e['id']: e for e in core.module_entries()}
        self.assertEqual([e['id'] for e in core.module_entries() if e.get('menu')],
                         ['local'])
        self.assertIsNone(entries['launch'].get('status'))                   # nur "Öffnen", kein Status
        for entry_id in ('setup', 'remote', 'local'):
            self.assertTrue(entries[entry_id]['status'], entry_id)

    def test_remote_and_local_dev_report_real_status(self):
        self.fake_home()
        entries = {e['id']: e for e in core.module_entries()}
        remote = core.entry_status(entries['remote'])
        self.assertEqual(remote['level'], 'off')
        self.assertRegex(remote['text'], r'^Wachhalten AUS · Apps: ')
        config = self.tmp / 'local-ai.json'
        with patch.dict(os.environ, {'LOCAL_DEV_CONFIG_FILE': str(config)}):
            self.assertEqual(core.entry_status(entries['local']), {'text': 'Noch nicht eingerichtet', 'level': 'off'})
            config.write_text('{"provider": "mlx", "model": "XHToken/Spark-X2.5-4B", "framework": "opencode"}')
            self.assertEqual(core.entry_status(entries['local']),
                             {'text': 'MLX · Spark-X2.5-4B → opencode', 'level': 'ok'})
            config.write_text('{"provider": "ollama", "model": "qwen", "framework": "codex"}')
            self.assertEqual(core.entry_status(entries['local'])['text'], 'Ollama · qwen → codex')
            for broken in ['{', '[]', '{"provider": "mlx"}', '{"provider": 1, "model": "m", "framework": "f"}']:
                config.write_text(broken)
                self.assertEqual(core.entry_status(entries['local'])['level'], 'warn', broken)

    # --- Suchordner (lokal und remote) ----------------------------------------------------------

    def folder_replies(self, handler):
        return patch.object(core, 'call_module', side_effect=lambda entry, args, timeout=60: handler(entry, args))

    def test_folder_state_lists_local_folders_with_counts_and_remote_hosts(self):
        local = [{'path': '/g', 'exists': True, 'repos': 3, 'truncated': False},
                 {'path': '/weg', 'exists': False, 'repos': 0, 'truncated': False}]
        reply = {'code': 0, 'out': json.dumps(local), 'err': ''}
        with self.folder_replies(lambda entry, args: reply) as call:
            info = core.folder_state([{'host': 'spark', 'root': '~/p', 'repos': 12}])
        self.assertEqual(info['local'], local)
        self.assertEqual(info['remote'], [{'host': 'spark', 'root': '~/p', 'repos': 12}])
        self.assertTrue(info['canAddLocal'] and info['canAddRemote'])
        self.assertEqual(call.call_args.args[:2], ('search-folders', ['list', str(self.config)]))

    def test_folder_state_without_the_modules_offers_nothing(self):
        fake = self.tmp / 'repo'
        (fake / 'm').mkdir(parents=True)
        (fake / 'm' / 'module.json').write_text('{"entries": [{"id": "other", "title": "x", "run": ["a"]}]}')
        with patch.object(core, 'REPO', fake):
            info = core.folder_state([])
        self.assertEqual(info, {'local': [], 'remote': [], 'canAddLocal': False, 'canAddRemote': False, 'errors': []})

    def test_folder_state_shows_an_unreadable_store_instead_of_hiding_it(self):
        reply = {'code': 1, 'out': '', 'err': 'Suchordner: Ungültige search-folders.json. Die Datei wurde nicht verändert.'}
        with self.folder_replies(lambda entry, args: reply):
            info = core.folder_state([])
        self.assertEqual(info['local'], [])
        self.assertEqual(info['errors'], ['Suchordner: Ungültige search-folders.json. Die Datei wurde nicht verändert.'])

    def test_adding_a_local_folder_reports_what_was_found(self):
        def added(count, truncated=False):
            out = json.dumps({'path': '/g', 'repos': count, 'truncated': truncated})
            with self.folder_replies(lambda entry, args: {'code': 0, 'out': out, 'err': ''}) as call:
                result = core.folder_action('add', path='/g')
            self.assertEqual(call.call_args.args, ('search-folders', ['add', str(self.config), '/g']))
            return result
        self.assertEqual(added(2), {'message': 'Ordner hinzugefügt: /g (2 Repositories)', 'warning': None})
        self.assertEqual(added(1)['message'], 'Ordner hinzugefügt: /g (1 Repository)')
        self.assertIn('keine Git-Repositories', added(0)['warning'])
        self.assertIn('abgebrochen', added(5, truncated=True)['warning'])

    def test_folder_errors_come_back_as_readable_reasons(self):
        reply = {'code': 1, 'out': '', 'err': 'Suchordner: Dieser Ordner wird schon durchsucht: /g'}
        with self.folder_replies(lambda entry, args: reply):
            with self.assertRaisesRegex(ValueError, r'^Dieser Ordner wird schon durchsucht: /g$'):
                core.folder_action('add', path='/g')
            with self.assertRaises(ValueError):
                core.folder_action('remove', path='/g')
        with self.assertRaisesRegex(ValueError, 'Unbekannte Aktion'):
            core.folder_action('format-disk')

    def test_remote_folder_is_saved_searched_without_prompts_and_failures_stay_visible(self):
        calls = []

        def replies(entry, args):
            calls.append((entry, args[0]))
            if args[0] == 'list':
                return {'code': 0, 'out': '[{"host": "spark", "root": "~/p", "repos": 7}]', 'err': ''}
            return {'code': 0, 'out': '', 'err': search_error}

        search_error = ''
        with self.folder_replies(replies) as call, patch.object(core, 'ssh_state', return_value={'hosts': []}):
            ok = core.folder_action('add-remote', host=' spark ', root='')
        self.assertEqual(ok, {'message': 'Remote-Ordner hinzugefügt: spark:~ (7 Repositories)', 'warning': None})
        self.assertEqual(calls, [('hosts', 'add'), ('hosts', 'discover'), ('hosts', 'list')])
        self.assertEqual(call.call_args_list[0].args[1], ['add', str(self.config), 'spark', '~'])     # leer = Home
        self.assertEqual(call.call_args_list[1].args[1], ['discover', str(self.config)])              # nie --interactive

        search_error = 'Remote spark: Permission denied (publickey).\nVerwende 0 zuletzt gefundene Repositories.'
        with self.folder_replies(replies), \
             patch.object(core, 'ssh_state', return_value={'hosts': [{'host': 'spark'}]}):
            failed = core.folder_action('add-remote', host='spark', root='~/p')
        self.assertEqual(failed['warning'], 'Permission denied (publickey).')
        self.assertIn('Gespeichert, aber die Suche ist fehlgeschlagen', failed['message'])
        self.assertIn('Remote-Ordner geändert', failed['message'])

    def test_remote_folder_rejects_an_invalid_host_and_can_be_removed(self):
        bad = {'code': 1, 'out': '', 'err': 'Remote-Repository-Suche: Ungültiger SSH-Host. Bitte einen Hostalias oder user@host angeben.'}
        with self.folder_replies(lambda entry, args: bad) as call, patch.object(core, 'ssh_state', return_value={'hosts': []}):
            with self.assertRaisesRegex(ValueError, r'^Ungültiger SSH-Host'):
                core.folder_action('add-remote', host='-oProxyCommand=x', root='~')
        self.assertEqual([c.args[1][0] for c in call.call_args_list], ['add'])          # nach dem Fehler keine Suche
        with self.folder_replies(lambda entry, args: {'code': 0, 'out': '', 'err': ''}) as call:
            result = core.folder_action('remove-remote', host='spark')
        self.assertEqual(call.call_args.args[:2], ('hosts', ['remove', str(self.config), 'spark']))
        self.assertIn('Auf dem Server bleibt alles unberührt', result['message'])

    def test_search_folders_work_end_to_end_with_the_real_modules(self):
        github = self.tmp / 'Github'
        for name in ('alpha', 'beta'):
            (github / name / '.git').mkdir(parents=True)
        self.assertEqual(core.folder_action('add', path=str(github))['message'],
                         f'Ordner hinzugefügt: {github} (2 Repositories)')
        local = core.folder_state([])['local']
        self.assertEqual([(e['path'], e['exists'], e['repos']) for e in local], [(str(github), True, 2)])
        with self.assertRaisesRegex(ValueError, 'schon durchsucht'):
            core.folder_action('add', path=str(github))
        core.folder_action('remove', path=str(github))
        self.assertEqual(core.folder_state([])['local'], [])
        self.assertTrue((github / 'alpha').is_dir())                                  # nichts gelöscht

    def test_remote_hosts_work_end_to_end_with_the_real_module_but_no_ssh(self):
        real = core.call_module

        def no_ssh(entry, args, timeout=60):
            if args[0] == 'discover':
                return {'code': 0, 'out': '', 'err': ''}
            return real(entry, args, timeout)

        with patch.object(core, 'call_module', side_effect=no_ssh):
            result = core.folder_action('add-remote', host='spark', root='~/projects')
            self.assertEqual(result['message'], 'Remote-Ordner hinzugefügt: spark:~/projects (0 Repositories)')
            self.assertEqual(core.ssh_state()['hosts'], [{'host': 'spark', 'root': '~/projects', 'repos': 0}])
            self.assertEqual(core.folder_state(core.ssh_state()['hosts'])['remote'][0]['host'], 'spark')
            core.folder_action('remove-remote', host='spark')
            self.assertEqual(core.ssh_state()['hosts'], [])

    def test_command_line_manages_search_folders(self):
        github = self.tmp / 'Github'
        (github / 'a' / '.git').mkdir(parents=True)
        code, out = self.cli('folders', 'add', f'--path={github}', '--json')
        self.assertEqual(json.loads(out)['message'], f'Ordner hinzugefügt: {github} (1 Repository)')
        with patch.object(core, 'ssh_state', return_value={'hosts': [{'host': 'spark', 'root': '~', 'repos': 4}]}):
            listed = self.cli('folders', 'list')[1].splitlines()
        self.assertEqual(listed, [f'lokal\t{github}\t1', 'remote\tspark:~\t4'])
        with self.assertRaises(ValueError):
            self.cli('folders', 'add', str(github))                                      # Duplikat
        self.cli('folders', 'remove', str(github))
        self.assertEqual(core.folder_state([])['local'], [])

    def test_state_includes_the_search_folders(self):
        with patch.object(core, 'list_project_paths', return_value=[('A', '/a')]), \
             patch.object(core, 'ssh_state', return_value={'available': False, 'hosts': [{'host': 'h', 'root': '~', 'repos': 1}]}), \
             patch.object(core, 'folder_state', return_value={'local': []}) as folders:
            info = core.state()
        self.assertEqual(info['folders'], {'local': []})
        folders.assert_called_once_with([{'host': 'h', 'root': '~', 'repos': 1}])      # Hosts nur einmal abfragen

    # --- Local Dev pro Workspace: Anbieter, Modell und CLI starten als zusätzliches Terminal ---------------

    LOCAL = {'provider': 'ollama', 'model': 'deepseek-coder:6.7b', 'framework': 'opencode'}

    def test_a_workspace_stores_local_dev_and_keeps_it_when_edited_renamed_or_switched_quick(self):
        core.save_workspace('Demo', ['A'], False, local_dev=self.LOCAL)
        self.assertEqual(self.stored_workspace()['localDev'], self.LOCAL)
        core.save_workspace('Demo', ['A', 'B'], False, rename_from='Demo')              # Bearbeiten ohne Angabe: bleibt
        self.assertEqual(self.stored_workspace()['localDev'], self.LOCAL)
        core.save_workspace('Neu', ['A', 'B'], False, rename_from='Demo')                  # Umbenennen: bleibt
        self.assertEqual(self.stored_workspace('Neu')['localDev'], self.LOCAL)
        core.set_workspace_quick('Neu', True)                                                  # andere Schalter fassen es nicht an
        self.assertEqual(self.stored_workspace('Neu')['localDev'], self.LOCAL)
        other = dict(self.LOCAL, model='qwen:7b')
        core.save_workspace('Neu', ['A'], False, rename_from='Neu', local_dev=other)           # ändern
        self.assertEqual(self.stored_workspace('Neu')['localDev'], other)
        core.save_workspace('Neu', ['A'], False, rename_from='Neu', local_dev=False)           # entfernen: der Schlüssel fehlt wieder
        self.assertNotIn('localDev', self.stored_workspace('Neu'))
        self.assertIs(self.stored_workspace('Neu')['quickOpen'], True)

    def test_local_dev_needs_all_three_values_and_a_bad_one_changes_nothing(self):
        core.save_workspace('Demo', ['A'], False, local_dev=self.LOCAL)
        before = (self.config / 'workspaces.json').read_text()
        for bad in ({}, {'provider': 'ollama'}, dict(self.LOCAL, model=''), dict(self.LOCAL, model='  '), dict(self.LOCAL, extra='x'),
                    dict(self.LOCAL, framework='a\nb'), dict(self.LOCAL, provider=5), 'ollama', ['a', 'b', 'c']):
            with self.assertRaisesRegex(ValueError, 'Anbieter, Modell und CLI', msg=repr(bad)):
                core.save_workspace('Demo', ['A'], False, rename_from='Demo', local_dev=bad)
        self.assertEqual((self.config / 'workspaces.json').read_text(), before)

    def test_a_corrupt_local_dev_value_in_the_store_is_rejected_and_never_overwritten(self):
        path = self.config / 'workspaces.json'
        self.config.mkdir()
        for bad in ('null', '"ollama"', '[]', '{"provider": "a"}', '{"provider": "a", "model": "", "framework": "c"}'):
            content = f'{{"version": 1, "workspaces": [{{"name": "A", "projects": ["x"], "shortcut": false, "localDev": {bad}}}]}}'
            path.write_text(content)
            for attempt in (core.read_store, lambda: self.save('Neu'), lambda: core.set_workspace_quick('A', True)):
                with self.assertRaises(ValueError, msg=content):
                    attempt()
            self.assertEqual(path.read_text(), content)

    def test_every_start_path_hands_local_dev_to_the_launcher(self):
        core.save_workspace('Demo', ['A', 'B c'], False, local_dev=self.LOCAL)
        expected = [str(core.LAUNCHER), '--project', 'A', '--project', 'B c',
                    '--local-dev', 'ollama', 'deepseek-coder:6.7b', 'opencode']
        self.assertEqual(core.launcher_argv(core.require('Demo')), expected)
        with patch.object(core.os, 'execv') as execv:
            core.run_workspace('Demo')                                                      # Schreibtisch-Shortcut
        execv.assert_called_once_with(str(core.LAUNCHER), expected)
        with patch.object(core.subprocess, 'Popen') as popen:
            core.start_workspace('Demo')                                                    # Starten im Fenster
        self.assertEqual(popen.call_args.args[0], expected)
        with patch.object(core, 'list_projects', return_value=['A', 'B c']), patch.object(core, 'pick_projects', return_value=['B c']), \
             patch.object(core.os, 'execv') as execv:
            core.open_workspace('Demo')                                                     # Quick-Öffnen: nur die gewählten Repos
        execv.assert_called_once_with(str(core.LAUNCHER), [str(core.LAUNCHER), '--project', 'B c',
                                                           '--local-dev', 'ollama', 'deepseek-coder:6.7b', 'opencode'])
        core.save_workspace('Solo', ['A'], False)
        self.assertEqual(core.launcher_argv(core.require('Solo')), [str(core.LAUNCHER), '--project', 'A'])   # ohne: wie bisher

    def test_local_options_come_from_the_local_dev_module_and_noise_is_ignored(self):
        out = '\n'.join(['Hinweis vom Starter', 'mlx\tMLX (lokal)\tXH/Spark\t1\topencode\tOpenCode\t1\t1\t1',
                         'ollama\tOllama (lokal)\tqwen:7b\t0\tcodex\tCodex CLI\t0\t0\t1', 'zu\tkurz',
                         'a\tb\tc\t1\td\te\t0'])                                 # alte Ausgabe mit sieben Feldern: ignoriert
        with patch.object(core, 'call_module', return_value={'code': 0, 'out': out, 'err': ''}) as call:
            result = core.local_dev_options()
        call.assert_called_once_with('local', ['--options'], timeout=30)
        self.assertEqual(result['error'], None)
        self.assertTrue(result['available'])
        self.assertEqual(result['options'], [
            {'provider': 'mlx', 'providerName': 'MLX (lokal)', 'model': 'XH/Spark', 'local': True, 'framework': 'opencode',
             'frameworkName': 'OpenCode', 'active': True, 'providerReady': True, 'frameworkReady': True},
            {'provider': 'ollama', 'providerName': 'Ollama (lokal)', 'model': 'qwen:7b', 'local': False, 'framework': 'codex',
             'frameworkName': 'Codex CLI', 'active': False, 'providerReady': False, 'frameworkReady': True}])
        with patch.object(core, 'call_module', return_value={'code': 0, 'out': out, 'err': ''}) as call:
            core.local_dev_options(everything=True)
        call.assert_called_once_with('local', ['--options-all'], timeout=30)                 # die volle Liste für die Einstellung

    def test_local_options_without_the_module_or_with_a_failing_one_say_so_instead_of_raising(self):
        fake = self.tmp / 'repo'
        (fake / 'm').mkdir(parents=True)
        (fake / 'm' / 'module.json').write_text('{"entries": [{"id": "other", "title": "x", "run": ["a"]}]}')
        with patch.object(core, 'REPO', fake):
            self.assertEqual(core.local_dev_options(), {'available': False, 'options': [], 'error': None})
        failed = {'code': 1, 'out': '', 'err': 'Konfiguration ungültig'}
        with patch.object(core, 'call_module', return_value=failed):
            self.assertEqual(core.local_dev_options(), {'available': True, 'options': [], 'error': 'Local Dev: Konfiguration ungültig'})
        with patch.object(core, 'call_module', side_effect=subprocess.TimeoutExpired('x', 30)):
            self.assertIn('Local Dev:', core.local_dev_options()['error'])
        with patch.object(core, 'call_module', return_value={'code': 0, 'out': '', 'err': ''}):
            self.assertEqual(core.local_dev_options(), {'available': True, 'options': [], 'error': None})   # nichts startbar

    def test_the_local_dev_setting_reads_every_combination_plus_the_saved_selection(self):
        rows = 'mlx\tMLX (lokal)\tXH/Spark\t1\topencode\tOpenCode\t1\t0\t1'

        def reply(entry, args, timeout=60):
            return {'code': 0, 'out': rows if args == ['--options-all'] else 'mlx\tXH/Spark\topencode', 'err': ''}
        with patch.object(core, 'call_module', side_effect=reply):
            found = core.local_dev_settings()
        self.assertEqual(found['current'], {'provider': 'mlx', 'model': 'XH/Spark', 'framework': 'opencode'})
        self.assertEqual([(o['providerReady'], o['frameworkReady']) for o in found['options']], [(False, True)])   # MLX: nicht bereit
        self.assertIsNone(found['error'])
        for current in ('', 'mlx\tnur-zwei', 'a\t\tc'):                                        # unlesbar: keine geratene Vorauswahl
            with patch.object(core, 'call_module', side_effect=lambda e, a, timeout=60: {
                    'code': 0, 'out': rows if a == ['--options-all'] else current, 'err': ''}):
                self.assertIsNone(core.local_dev_settings()['current'], repr(current))
        failed = {'code': 1, 'out': '', 'err': '× Konfiguration ungültig'}
        with patch.object(core, 'call_module', return_value=failed):
            self.assertEqual(core.local_dev_settings()['error'], 'Local Dev: Konfiguration ungültig')    # das × des Starters fällt weg
        fake = self.tmp / 'repo'
        (fake / 'm').mkdir(parents=True)
        (fake / 'm' / 'module.json').write_text('{"entries": [{"id": "other", "title": "x", "run": ["a"]}]}')
        with patch.object(core, 'REPO', fake):
            self.assertFalse(core.local_dev_settings()['available'])

    def test_saving_the_local_dev_setting_goes_through_the_module_and_reports_its_reason(self):
        with patch.object(core, 'call_module', return_value={'code': 0, 'out': 'Gespeichert: Ollama → qwen → OpenCode', 'err': ''}) as call:
            self.assertEqual(core.set_local_dev_default(self.LOCAL), 'Gespeichert: Ollama → qwen → OpenCode')
        call.assert_called_once_with('local', ['--set-default', 'ollama', 'deepseek-coder:6.7b', 'opencode'], timeout=30)
        failed = {'code': 1, 'out': '', 'err': '× Codex CLI und MLX sind nicht direkt kompatibel.'}
        with patch.object(core, 'call_module', return_value=failed), self.assertRaisesRegex(ValueError, r'^Codex CLI und MLX sind nicht'):
            core.set_local_dev_default(self.LOCAL)
        with patch.object(core, 'call_module') as call:
            for bad in ({}, {'provider': 'a'}, dict(self.LOCAL, model=' '), 'x', None):
                with self.assertRaisesRegex(ValueError, 'Anbieter, Modell und CLI'):
                    core.set_local_dev_default(bad)                                                       # nichts erreicht das Modul
        call.assert_not_called()

    def test_command_line_prints_the_setting_and_saves_it_with_a_leading_minus_in_the_model(self):
        with patch.object(core, 'local_dev_settings', return_value={'available': True, 'options': [], 'current': None, 'error': None}):
            self.assertEqual(json.loads(self.cli('local-settings')[1])['current'], None)
        with patch.object(core, 'set_local_dev_default', return_value='Gespeichert: x') as save:
            self.assertEqual(self.cli('local-default', '--provider=ollama', '--model=-x:7b', '--framework=opencode')[1].strip(), 'Gespeichert: x')
        save.assert_called_once_with({'provider': 'ollama', 'model': '-x:7b', 'framework': 'opencode'})
        self.assertTrue(all(word in core.usage([]) for word in ('local-settings', 'local-default')))

    def test_command_line_sets_keeps_and_removes_local_dev(self):
        flags = ['--local-dev-provider=ollama', '--local-dev-model=-x:7b', '--local-dev-framework=opencode']      # Modell mit führendem Minus
        self.cli('save', '--name=Demo', '--project=A', *flags)
        self.assertEqual(self.stored_workspace()['localDev'], {'provider': 'ollama', 'model': '-x:7b', 'framework': 'opencode'})
        self.assertEqual(self.cli('list')[1].splitlines(), ['Demo\tA\t-\tLocal Dev'])
        self.cli('save', '--name=Demo', '--project=A', '--project=B', '--rename-from=Demo')          # ohne Angabe: bleibt
        self.assertIn('localDev', self.stored_workspace())
        with self.assertRaisesRegex(ValueError, 'Anbieter, Modell und CLI'):
            self.cli('save', '--name=Demo', '--project=A', '--rename-from=Demo', '--local-dev-provider=ollama')
        with self.assertRaisesRegex(ValueError, 'schließen sich aus'):
            self.cli('save', '--name=Demo', '--project=A', '--rename-from=Demo', '--no-local-dev', *flags)
        self.assertIn('localDev', self.stored_workspace())                                                  # beide Fehler änderten nichts
        self.cli('save', '--name=Demo', '--project=A', '--rename-from=Demo', '--no-local-dev')
        self.assertNotIn('localDev', self.stored_workspace())
        self.assertEqual(self.cli('list')[1].splitlines(), ['Demo\tA\t-'])

    def test_the_command_line_prints_the_options_as_json_and_the_state_carries_local_dev(self):
        with patch.object(core, 'local_dev_options', return_value={'available': True, 'options': [], 'error': None}):
            self.assertEqual(json.loads(self.cli('local-options')[1]), {'available': True, 'options': [], 'error': None})
        core.save_workspace('Demo', ['A'], False, local_dev=self.LOCAL)
        with patch.object(core, 'list_project_paths', return_value=[('A', '/a')]), \
             patch.object(core, 'ssh_state', return_value={'available': False, 'hosts': []}), \
             patch.object(core, 'presets_state', return_value={'available': False}), \
             patch.object(core, 'folder_state', return_value={'local': []}), patch.object(core, 'wake_state', return_value=None):
            self.assertEqual(core.state()['workspaces'][0]['localDev'], self.LOCAL)
        self.assertIn('local-options', core.usage([]))

    # --- Quick-Öffnen bei Workspaces: ein zweiter Shortcut, der die Projekte zum Ankreuzen zeigt ---------

    def stored_workspace(self, name='Demo'):
        return core.find(core.read_store(), name)

    def test_workspace_quick_open_adds_a_second_alias_next_to_the_normal_shortcut(self):
        self.save('Demo', ['A', 'B'], shortcut=True)
        self.assertEqual(core.set_workspace_quick('Demo', True), 'Demo öffnen')
        self.assertEqual(self.desktop_names(), ['Demo', 'Demo öffnen'])
        starter = core.workspace_starter_path('Demo')
        self.assertNotEqual(starter, core.starter_path('Demo'))                          # zwei Starter, zwei Aliasse
        self.assertEqual(self.alias_target('Demo öffnen').resolve(), starter.resolve())
        self.assertEqual(self.alias_target('Demo').resolve(), core.starter_path('Demo').resolve())   # der normale bleibt
        self.assertTrue(stat.S_IMODE(starter.stat().st_mode) & 0o100)
        self.assertTrue(starter.read_text().endswith('vibecode.py" open-workspace Demo\n'))
        self.save('Für Demo', ['A'], shortcut=False)                                     # Leerzeichen und Umlaut: gequotet
        core.set_workspace_quick('Für Demo', True)
        self.assertTrue(core.workspace_starter_path('Für Demo').read_text().endswith("open-workspace 'Für Demo'\n"))
        core.set_workspace_quick('Für Demo', False)
        self.assertEqual(subprocess.run(['/bin/zsh', '-n', str(starter)]).returncode, 0)
        self.assertIs(self.stored_workspace()['quickOpen'], True)
        self.assertEqual(self.stored_workspace()['projects'], ['A', 'B'])                  # sonst bleibt alles wie es war
        core.set_workspace_quick('Demo', True)                                           # nochmal: nichts passiert
        self.assertEqual(self.desktop_names(), ['Demo', 'Demo öffnen'])
        self.assertEqual(core.set_workspace_quick('Demo', False), 'Demo öffnen')
        self.assertEqual(self.desktop_names(), ['Demo'])
        self.assertFalse(starter.exists())
        self.assertNotIn('quickOpen', self.stored_workspace())                              # aus = Schlüssel fehlt wieder

    def test_quick_open_works_without_the_normal_shortcut_and_unknown_workspaces_are_rejected(self):
        self.save('Solo', ['A'], shortcut=False)
        core.set_workspace_quick('Solo', True)
        self.assertEqual(self.desktop_names(), ['Solo öffnen'])
        self.assertFalse(self.stored_workspace('Solo')['shortcut'])
        with self.assertRaisesRegex(ValueError, 'gibt es nicht'):
            core.set_workspace_quick('Gibt es nicht', True)
        for bad in ('ja', None, 1):
            with self.assertRaisesRegex(ValueError, 'nur „an“ und „aus“'):
                core.set_workspace_quick('Solo', bad)

    def test_editing_keeps_quick_open_and_renaming_moves_its_alias(self):
        self.save('Alt', ['A'], shortcut=True)
        core.set_workspace_quick('Alt', True)
        self.save('Alt', ['A', 'B'], shortcut=True, rename_from='Alt')                      # nur Projekte ändern
        self.assertIs(self.stored_workspace('Alt')['quickOpen'], True)
        self.save('Neu', ['A', 'B'], shortcut=True, rename_from='Alt')
        self.assertEqual(self.desktop_names(), ['Neu', 'Neu öffnen'])
        self.assertEqual(self.alias_target('Neu öffnen').resolve(), core.workspace_starter_path('Neu').resolve())
        self.assertFalse(core.workspace_starter_path('Alt').exists())
        self.save('NEU', ['A', 'B'], shortcut=True, rename_from='Neu')                       # nur Groß-/Kleinschreibung
        self.assertEqual(self.desktop_names(), ['NEU', 'NEU öffnen'])
        self.assertEqual(self.alias_target('NEU öffnen').resolve(), core.workspace_starter_path('NEU').resolve())
        self.assertIs(self.stored_workspace('NEU')['quickOpen'], True)

    def test_saving_with_quick_given_switches_it_and_a_new_workspace_can_start_with_it(self):
        core.save_workspace('Neu', ['A'], False, quick=True)
        self.assertEqual(self.desktop_names(), ['Neu öffnen'])
        core.save_workspace('Neu', ['A'], False, rename_from='Neu', quick=False)
        self.assertEqual(self.desktop_names(), [])
        self.assertNotIn('quickOpen', self.stored_workspace('Neu'))

    def test_a_foreign_file_blocks_quick_open_before_anything_else_changes(self):
        foreign = self.desktop / 'Demo öffnen'
        foreign.write_text('meine Datei')
        self.save('Demo', ['A'], shortcut=False)
        with self.assertRaisesRegex(ValueError, 'nicht von VibeCode'):
            core.set_workspace_quick('Demo', True)
        self.assertNotIn('quickOpen', self.stored_workspace())
        with self.assertRaisesRegex(ValueError, 'nicht von VibeCode'):
            core.save_workspace('Demo', ['A'], True, rename_from='Demo', quick=True)
        self.assertEqual(self.desktop_names(), ['Demo öffnen'])                          # auch der normale Shortcut wurde nicht angelegt
        self.assertFalse(self.stored_workspace()['shortcut'])
        core.set_workspace_quick('Demo', False)                                          # aus ist immer erlaubt
        core.delete_workspace('Demo')
        self.assertEqual(foreign.read_text(), 'meine Datei')

    def test_a_workspace_and_a_search_folder_with_the_same_quick_name_never_steal_each_others_alias(self):
        folder = self.tmp / 'ordner' / 'Github'
        (folder / 'a' / '.git').mkdir(parents=True)
        core.folder_action('add', path=str(folder))
        self.save('Github', ['A'], shortcut=False)
        core.folder_action('quick-open', path=str(folder), mode='on')
        with self.assertRaisesRegex(ValueError, 'schon „Github öffnen“'):
            core.set_workspace_quick('Github', True)
        self.assertEqual(self.alias_target('Github öffnen').resolve(), core.folder_starter_path(folder).resolve())
        self.assertNotIn('quickOpen', self.stored_workspace('Github'))

    def test_a_too_long_name_gives_a_readable_error_and_creates_nothing(self):
        name = 'x' * core.NAME_MAX
        self.save(name, ['A'], shortcut=False)
        with self.assertRaisesRegex(ValueError, 'länger als 60 Zeichen'):
            core.set_workspace_quick(name, True)
        self.assertEqual(list(self.desktop.iterdir()), [])
        self.assertNotIn('quickOpen', self.stored_workspace(name))

    def test_deleting_a_workspace_removes_both_shortcuts_and_sync_recreates_both(self):
        self.save('Demo', ['A'], shortcut=True)
        core.set_workspace_quick('Demo', True)
        for name in ('Demo', 'Demo öffnen'):
            (self.desktop / name).unlink()
        self.assertEqual(core.sync_shortcuts(), 2)
        self.assertEqual(self.desktop_names(), ['Demo', 'Demo öffnen'])
        core.delete_workspace('Demo')
        self.assertEqual(self.desktop_names(), [])
        self.assertEqual(list((self.config / 'shortcuts').glob('*')), [])

    def test_a_corrupt_quick_open_value_in_the_store_is_rejected_and_never_overwritten(self):
        path = self.config / 'workspaces.json'
        self.config.mkdir()
        for bad in ('"ja"', '1', 'null', '[]'):
            content = f'{{"version": 1, "workspaces": [{{"name": "A", "projects": ["x"], "shortcut": false, "quickOpen": {bad}}}]}}'
            path.write_text(content)
            for attempt in (core.read_store, lambda: self.save('Neu'), lambda: core.set_workspace_quick('A', True)):
                with self.assertRaises(ValueError, msg=content):
                    attempt()
            self.assertEqual(path.read_text(), content)
            self.assertEqual(list(self.desktop.iterdir()), [])

    def test_state_and_list_show_quick_open_per_workspace(self):
        self.save('Demo', ['A'], shortcut=False)
        self.save('Solo', ['B'], shortcut=False)
        core.set_workspace_quick('Demo', True)
        with patch.object(core, 'list_project_paths', return_value=[('A', '/a'), ('B', '/b')]), \
             patch.object(core, 'ssh_state', return_value={'available': False, 'hosts': []}), \
             patch.object(core, 'presets_state', return_value={'available': False}), \
             patch.object(core, 'folder_state', return_value={'local': []}), \
             patch.object(core, 'wake_state', return_value=None):
            workspaces = core.state()['workspaces']
        self.assertEqual([(w['name'], w['quickOpen']) for w in workspaces], [('Demo', True), ('Solo', False)])
        self.assertEqual(self.cli('list')[1].splitlines(), ['Demo\tA\t-\tQuick-Öffnen', 'Solo\tB\t-'])

    def test_the_quick_shortcut_opens_the_dialog_with_the_workspaces_known_projects_in_its_order(self):
        self.save('Demo', ['B', 'weg', 'A'], shortcut=False)
        with patch.object(core, 'list_projects', return_value=['A', 'B', 'C']), \
             patch.object(core, 'pick_projects', return_value=['A']) as pick, patch.object(core.os, 'execv') as execv:
            core.open_workspace('demo')
        pick.assert_called_once_with(['B', 'A'])                                            # gespeicherte Reihenfolge, ohne Unbekanntes
        execv.assert_called_once_with(str(core.LAUNCHER), [str(core.LAUNCHER), '--project', 'A'])
        self.assertEqual((self.config / 'home').read_text().strip(), str(core.REPO))
        self.assertEqual([w['name'] for w in core.read_store()['workspaces']], ['Demo'])   # nichts wird gespeichert

    def test_cancelling_or_a_workspace_without_known_projects_or_an_unknown_workspace_starts_nothing(self):
        self.save('Demo', ['A'], shortcut=False)
        with patch.object(core, 'list_projects', return_value=['A']), patch.object(core, 'pick_projects', return_value=[]), \
             patch.object(core.os, 'execv') as execv:
            self.assertEqual(core.open_workspace('Demo'), [])
        execv.assert_not_called()
        with patch.object(core, 'list_projects', return_value=['X']), patch.object(core, 'pick_projects') as pick, \
             patch.object(core.os, 'execv') as execv:
            with self.assertRaisesRegex(ValueError, 'keines der Projekte'):
                core.open_workspace('Demo')
            with self.assertRaisesRegex(ValueError, 'gibt es nicht'):
                core.open_workspace('Gibt es nicht')
        pick.assert_not_called()
        execv.assert_not_called()

    def test_command_line_switches_workspace_quick_open_and_opens_a_workspace(self):
        self.save('Demo', ['A'], shortcut=False)
        self.assertEqual(self.cli('workspace-quick', '--name=Demo', 'on')[1].strip(),
                         'Quick-Öffnen an: „Demo öffnen“ liegt auf dem Schreibtisch.')
        self.assertEqual(self.desktop_names(), ['Demo öffnen'])
        self.assertEqual(self.cli('workspace-quick', '--name=Demo', 'off')[1].strip(),
                         'Quick-Öffnen aus: „Demo öffnen“ ist vom Schreibtisch entfernt.')
        self.assertEqual(self.desktop_names(), [])
        with patch.object(core, 'open_workspace', return_value=[]) as opened:
            self.cli('open-workspace', 'Demo')
        opened.assert_called_once_with('Demo')
        with self.assertRaisesRegex(ValueError, 'Aufruf: vibecode open-workspace'):
            self.cli('open-workspace')
        self.assertIn('open-workspace', core.usage([]))

    # --- Quick-Öffnen: Schreibtisch-Shortcut pro Suchordner ------------------------------------------

    def search_folder(self, name='Github', repos=('a', 'b'), parent=None):
        folder = (parent or self.tmp / 'ordner') / name
        for repo in repos:
            (folder / repo / '.git').mkdir(parents=True)
        core.folder_action('add', path=str(folder))
        return folder

    def desktop_names(self):
        """APFS lists "ö" decomposed; compare composed so the tests read like the names the user sees."""
        return sorted(unicodedata.normalize('NFC', p.name) for p in self.desktop.iterdir())

    def stored_quick(self, folder):
        return next(e for e in core.folder_state([])['local'] if e['path'] == str(folder))

    def test_quick_open_on_creates_a_real_alias_to_a_folder_starter_and_off_removes_it(self):
        folder = self.search_folder('Mein Github')
        self.assertFalse(self.stored_quick(folder)['quickOpen'])
        result = core.folder_action('quick-open', path=str(folder), mode='on')
        name = 'Mein Github öffnen'
        self.assertIn(name, result['message'])
        starter = core.folder_starter_path(folder)
        self.assertEqual(self.alias_target(name).resolve(), starter.resolve())
        self.assertTrue(stat.S_IMODE(starter.stat().st_mode) & 0o100)
        self.assertIn(f"open-folder '{folder}'", starter.read_text())                      # Pfad mit Leerzeichen, gequotet
        self.assertEqual(subprocess.run(['/bin/zsh', '-n', str(starter)]).returncode, 0)   # gültiges Skript
        state = self.stored_quick(folder)
        self.assertEqual((state['quickOpen'], state['shortcut']), (True, name))
        core.folder_action('quick-open', path=str(folder), mode='on')                       # nochmal: nichts passiert, kein Fehler
        self.assertEqual(self.desktop_names(), [name])
        core.folder_action('quick-open', path=str(folder), mode='off')
        self.assertEqual(self.alias_target(name), 'missing')
        self.assertFalse(starter.exists())
        self.assertEqual(self.stored_quick(folder).get('quickOpen'), False)
        self.assertNotIn('shortcut', self.stored_quick(folder))

    def test_a_foreign_file_blocks_quick_open_and_the_checkbox_stays_off(self):
        folder = self.search_folder()
        foreign = self.desktop / 'Github öffnen'
        foreign.write_text('meine Datei')
        with self.assertRaisesRegex(ValueError, 'nicht von VibeCode'):
            core.folder_action('quick-open', path=str(folder), mode='on')
        self.assertFalse(self.stored_quick(folder)['quickOpen'])                            # zuerst der Shortcut, dann das Kästchen
        core.folder_action('quick-open', path=str(folder), mode='off')                      # aus ist immer erlaubt
        core.folder_action('remove', path=str(folder))
        self.assertEqual(foreign.read_text(), 'meine Datei')                                # nie überschrieben oder gelöscht

    def test_two_search_folders_with_the_same_name_never_share_a_starter_or_steal_an_alias(self):
        first = self.search_folder('Github', parent=self.tmp / 'eins')
        second = self.search_folder('Github', parent=self.tmp / 'zwei')
        self.assertNotEqual(core.folder_starter_path(first), core.folder_starter_path(second))
        core.folder_action('quick-open', path=str(first), mode='on')
        with self.assertRaisesRegex(ValueError, 'schon „Github öffnen“'):
            core.folder_action('quick-open', path=str(second), mode='on')
        self.assertEqual(self.alias_target('Github öffnen').resolve(), core.folder_starter_path(first).resolve())
        self.assertIn(str(first), core.folder_starter_path(first).read_text())
        self.assertFalse(core.folder_starter_path(second).exists())                         # das Fehlgeschlagene hinterlässt nichts
        self.assertFalse(self.stored_quick(second)['quickOpen'])
        core.folder_action('quick-open', path=str(second), mode='off')                      # und entfernt den Alias des anderen nicht
        self.assertEqual(self.alias_target('Github öffnen').resolve(), core.folder_starter_path(first).resolve())

    def test_removing_a_search_folder_takes_its_shortcut_off_the_desktop(self):
        keep, gone = self.search_folder('Behalten'), self.search_folder('Weg')
        for folder in (keep, gone):
            core.folder_action('quick-open', path=str(folder), mode='on')
        core.folder_action('remove', path=str(gone))
        self.assertEqual(self.desktop_names(), ['Behalten öffnen'])
        self.assertFalse(core.folder_starter_path(gone).exists())
        self.assertTrue(core.folder_starter_path(keep).exists())
        self.assertEqual([e['path'] for e in core.folder_state([])['local']], [str(keep)])

    def test_quick_open_rejects_unknown_folders_and_bad_modes_without_touching_the_desktop(self):
        folder = self.search_folder()
        for bad in ('/gibt/es/nicht', '', None, str(self.tmp)):
            with self.assertRaisesRegex(ValueError, 'kein Suchordner', msg=repr(bad)):
                core.folder_action('quick-open', path=bad, mode='on')
        for bad in (None, '', 'ja', True):
            with self.assertRaisesRegex(ValueError, 'nur „on“ und „off“'):
                core.folder_action('quick-open', path=str(folder), mode=bad)
        self.assertEqual(list(self.desktop.iterdir()), [])
        self.assertFalse((self.config / 'shortcuts').exists())

    def test_a_failing_store_step_takes_the_new_shortcut_back(self):
        folder = self.search_folder()
        real = core.call_module

        def broken(entry, args, timeout=60):
            if args[0] == 'quick':
                return {'code': 1, 'out': '', 'err': 'Suchordner: kaputt'}
            return real(entry, args, timeout)
        with patch.object(core, 'call_module', side_effect=broken), self.assertRaisesRegex(ValueError, 'kaputt'):
            core.folder_action('quick-open', path=str(folder), mode='on')
        self.assertEqual(list(self.desktop.iterdir()), [])
        self.assertFalse(core.folder_starter_path(folder).exists())

    def test_sync_recreates_folder_shortcuts_next_to_the_workspace_ones(self):
        folder = self.search_folder()
        core.folder_action('quick-open', path=str(folder), mode='on')
        self.save('Demo', ['A'], shortcut=True)
        for name in ('Github öffnen', 'Demo'):
            (self.desktop / name).unlink()
        self.assertEqual(core.sync_shortcuts(), 2)
        self.assertEqual(self.desktop_names(), ['Demo', 'Github öffnen'])
        self.assertEqual(self.alias_target('Github öffnen').resolve(), core.folder_starter_path(folder).resolve())
        self.assertEqual(self.cli('shortcuts', 'sync')[1].strip(), '2 Shortcuts erneuert.')

    def test_sync_stops_before_changing_anything_when_the_search_folders_are_unreadable(self):
        self.save('Demo', ['A'], shortcut=True)
        (self.desktop / 'Demo').unlink()
        self.config.mkdir(exist_ok=True)
        (self.config / 'search-folders.json').write_text('{kaputt')
        with self.assertRaises(ValueError):
            core.sync_shortcuts()
        self.assertEqual(list(self.desktop.iterdir()), [])

    def test_projects_in_a_folder_are_the_launchers_names_sorted_and_never_remote_or_siblings(self):
        folder = self.tmp / 'Github'
        (folder / 'a').mkdir(parents=True)
        (self.tmp / 'GithubAndere').mkdir()
        os.symlink(folder / 'a', self.tmp / 'link')
        known = [('zeta', str(folder / 'z')), ('Alpha', str(folder / 'a')), ('beta', str(folder / 'org' / 'b')),
                 ('fremd', str(self.tmp / 'GithubAndere' / 'x')),                        # Präfix, aber ein anderer Ordner
                 ('ferne', 'vscode-remote://ssh-remote+spark/home/example/Github/r'), ('der Ordner selbst', str(folder))]
        self.assertEqual(core.projects_in(str(folder), known), ['Alpha', 'beta', 'der Ordner selbst', 'zeta'])
        self.assertEqual(core.projects_in(str(self.tmp / 'link'), [('x', str(folder / 'a'))]), ['x'])    # Symlinks werden aufgelöst

    def test_the_shortcut_opens_the_dialog_with_only_that_folders_repositories_and_starts_the_chosen_ones(self):
        folder = self.tmp / 'Github'
        known = [('b', str(folder / 'b')), ('A', str(folder / 'a')), ('fremd', '/anderswo/x')]
        with patch.object(core, 'list_project_paths', return_value=known), \
             patch.object(core, 'pick_projects', return_value=['b', 'A']) as pick, patch.object(core.os, 'execv') as execv:
            core.open_folder(str(folder))
        pick.assert_called_once_with(['A', 'b'])                                          # nur dieser Ordner, sortiert
        execv.assert_called_once_with(str(core.LAUNCHER), [str(core.LAUNCHER), '--project', 'b', '--project', 'A'])
        self.assertEqual((self.config / 'home').read_text().strip(), str(core.REPO))       # wie bei Workspace-Shortcuts
        self.assertEqual(core.read_store()['workspaces'], [])                              # kein Workspace entsteht

    def test_cancelling_the_dialog_or_a_folder_without_repositories_starts_nothing(self):
        folder = self.tmp / 'Github'
        with patch.object(core, 'list_project_paths', return_value=[('a', str(folder / 'a'))]), \
             patch.object(core, 'pick_projects', return_value=[]), patch.object(core.os, 'execv') as execv:
            self.assertEqual(core.open_folder(str(folder)), [])
        execv.assert_not_called()
        with patch.object(core, 'list_project_paths', return_value=[('x', '/anderswo/x')]), \
             patch.object(core, 'pick_projects') as pick, patch.object(core.os, 'execv') as execv:
            with self.assertRaisesRegex(ValueError, 'keine Repositories'):
                core.open_folder(str(folder))
        pick.assert_not_called()
        execv.assert_not_called()

    def test_pick_projects_uses_the_launchers_own_dialog_and_reads_its_answer(self):
        seen = {}

        def fake(argv, **kwargs):
            seen['argv'] = argv
            seen['names'] = Path(argv[-2]).read_text(encoding='utf-8')
            seen['defaults'] = Path(argv[-1]).read_text(encoding='utf-8')
            return subprocess.CompletedProcess(argv, 0, stdout=seen.get('out', ''), stderr='')

        for out, expected in (('A\nB b\n', ['A', 'B b']), ('\n', [])):                  # Abbrechen: eine leere Zeile
            seen['out'] = out
            with patch.object(core.subprocess, 'run', side_effect=fake):
                self.assertEqual(core.pick_projects(['A', 'B b', 'C']), expected)
        self.assertEqual(seen['argv'][:3], ['/usr/bin/osascript', '-l', 'JavaScript'])
        self.assertEqual(seen['argv'][3], str(core.REPO / 'workspaces' / 'project-selection.js'))
        self.assertEqual((seen['names'], seen['defaults']), ('A\nB b\nC\n', ''))          # nichts vorgewählt
        self.assertFalse(Path(seen['argv'][-1]).exists())                                  # Temp-Dateien sind weg
        failed = subprocess.CompletedProcess([], 1, stdout='', stderr='x.js: execution error: Error: kein Fenster (-2700)')
        with patch.object(core.subprocess, 'run', return_value=failed), self.assertRaisesRegex(ValueError, 'kein Fenster'):
            core.pick_projects(['A'])

    def test_command_line_opens_a_folder_and_switches_quick_open(self):
        with patch.object(core, 'open_folder', return_value=[]) as opened:
            self.cli('open-folder', '/g/Mein Github')
        opened.assert_called_once_with('/g/Mein Github')
        with self.assertRaisesRegex(ValueError, 'Aufruf: vibecode open-folder'):
            self.cli('open-folder')
        with patch.object(core, 'folder_action', return_value={'message': 'Quick-Öffnen an: x', 'warning': None}) as action:
            self.assertEqual(self.cli('folders', 'quick-open', '--path=/g', '--mode=on', '--json')[1].strip(),
                             '{"message": "Quick-Öffnen an: x", "warning": null}')
        action.assert_called_once_with('quick-open', path='/g', host=None, root=None, mode='on')
        self.assertIn('open-folder', core.usage([]))

    # --- Presets pro Repository -------------------------------------------------------------------

    PRESET = {'terminals': [{'name': 'Dev', 'type': 'Eigener Befehl', 'prompt': 'npm run dev', 'cwd': 'frontend'},
                            {'name': 'Agent', 'type': 'Claude Code', 'prompt': '', 'cwd': ''}], 'urls': ['http://localhost:5173']}

    def test_osa_error_keeps_only_the_reason(self):
        self.assertEqual(core.osa_error('execution error: Error: Terminal 1: unbekannter Typ. (-2700)'), 'Terminal 1: unbekannter Typ.')
        self.assertEqual(core.osa_error('warnung\n/tmp/x.js: execution error: Error: Ungültiger Repository-Pfad. (-2700)\n'),
                         'Ungültiger Repository-Pfad.')
        self.assertEqual(core.osa_error('einfacher Text'), 'einfacher Text')
        self.assertEqual(core.osa_error(''), '')
        self.assertEqual(core.osa_error(None), '')

    def preset_replies(self, stored, defaults=None, general=None):
        defaults = defaults or {'local': [{'name': 'Claude', 'type': 'Claude Code', 'prompt': '', 'cwd': ''}], 'remote': []}

        def reply(entry, args, timeout=60):
            self.assertEqual(entry, 'preset-store')
            answer = {'defaults': defaults, 'general': general}.get(args[0], stored)
            return {'code': 0, 'out': json.dumps(answer), 'err': ''}
        return patch.object(core, 'call_module', side_effect=reply)

    def test_presets_state_lists_custom_presets_and_default_repos(self):
        stored = [dict(self.PRESET, path='/g/a')]
        known = [('a', '/g/a'), ('b', '/g/b'), ('r [SSH: spark]', 'vscode-remote://ssh-remote+spark/home/example/r')]
        with self.preset_replies(stored):
            info = core.presets_state(known)
        self.assertTrue(info['available'])
        self.assertEqual([(r['name'], r['custom'], r['remote']) for r in info['repos']],
                         [('a', True, False), ('b', False, False), ('r [SSH: spark]', False, True)])
        self.assertEqual([(i['name'], i['path'], i['remote']) for i in info['items']], [('a', '/g/a', False)])
        self.assertEqual(info['items'][0]['urls'], ['http://localhost:5173'])
        self.assertEqual(info['orphans'], [])
        self.assertEqual(info['defaults']['local'][0]['name'], 'Claude')
        self.assertIsNone(info['general'])                                                # noch kein allgemeiner Standard

    def test_presets_state_reports_the_general_default(self):
        general = {'terminals': [{'name': 'Shell', 'type': 'Shell', 'prompt': '', 'cwd': ''}], 'urls': ['http://localhost:3000']}
        with self.preset_replies([], general=general):
            info = core.presets_state([('a', '/g/a')])
        self.assertEqual(info['general'], general)
        self.assertEqual((info['items'], info['repos'][0]['custom']), ([], False))        # er ist kein Repository-Preset

    def test_a_preset_of_a_moved_repository_is_kept_and_offered_for_transfer(self):
        stored = [dict(self.PRESET, path='/alt/Documents/GitHub/demo'), dict(self.PRESET, path='/alt/zwei'),
                  dict(self.PRESET, path='/alt/belegt'), dict(self.PRESET, path='/neu/belegt')]
        known = [('demo', '/neu/Github/demo'), ('zwei', '/neu/a/zwei'), ('zwei (2)', '/neu/b/zwei'),
                 ('belegt', '/neu/belegt')]
        with self.preset_replies(stored):
            info = core.presets_state(known)
        orphans = {o['name']: o for o in info['orphans']}
        self.assertEqual(orphans['demo']['suggestion'], {'name': 'demo', 'path': '/neu/Github/demo'})
        self.assertIsNone(orphans['zwei']['suggestion'])          # zwei gleichnamige Repositories: keine Vermutung
        self.assertIsNone(orphans['belegt']['suggestion'])        # Ziel hat schon ein eigenes Preset
        self.assertEqual(len(orphans['demo']['terminals']), 2)
        self.assertEqual([i['name'] for i in info['items']], ['belegt'])

    def test_presets_state_without_the_module_or_with_a_broken_store(self):
        fake = self.tmp / 'repo'
        (fake / 'm').mkdir(parents=True)
        (fake / 'm' / 'module.json').write_text('{"entries": [{"id": "other", "title": "x", "run": ["a"]}]}')
        with patch.object(core, 'REPO', fake):
            self.assertFalse(core.presets_state([])['available'])
        broken = {'code': 1, 'out': '', 'err': 'x.js: execution error: Error: Ungültige Terminal-Konfiguration. Die vorhandene Datei wurde nicht verändert. (-2700)'}
        with patch.object(core, 'call_module', return_value=broken):
            info = core.presets_state([('a', '/a')])
        self.assertEqual(info['errors'], ['Presets: Ungültige Terminal-Konfiguration. Die vorhandene Datei wurde nicht verändert.'])
        self.assertEqual((info['repos'], info['items'], info['orphans']), ([], [], []))

    def test_saving_a_preset_passes_a_temp_file_and_cleans_it_up(self):
        seen = {}

        def reply(entry, args, timeout=60):
            seen['args'] = args
            seen['content'] = json.loads(Path(args[3]).read_text(encoding='utf-8'))
            return {'code': 0, 'out': json.dumps({'terminals': self.PRESET['terminals'], 'urls': self.PRESET['urls']}), 'err': ''}

        with patch.object(core, 'call_module', side_effect=reply):
            result = core.preset_action('save', '/g/a', preset=self.PRESET)
        self.assertEqual(result['message'], 'Preset gespeichert (2 Terminals, 1 Browser-Tabs).')
        self.assertEqual(seen['args'][:3], ['save', str(self.config), '/g/a'])
        self.assertEqual(seen['content'], self.PRESET)
        self.assertFalse(Path(seen['args'][3]).exists())                                  # Temp-Datei ist weg

    def test_preset_errors_are_readable_and_a_failed_save_still_cleans_up(self):
        files = []

        def reply(entry, args, timeout=60):
            files.append(args[3])
            return {'code': 1, 'out': '', 'err': 'p.js: execution error: Error: Terminal 1 („T“): Bitte einen Shell-Befehl angeben. (-2700)'}

        with patch.object(core, 'call_module', side_effect=reply):
            with self.assertRaisesRegex(ValueError, r'^Terminal 1 \(„T“\): Bitte einen Shell-Befehl angeben\.$'):
                core.preset_action('save', '/g/a', preset=self.PRESET)
        self.assertFalse(Path(files[0]).exists())
        for bad in (None, 'text', ['x']):
            with self.assertRaisesRegex(ValueError, 'Preset fehlt'):
                core.preset_action('save', '/g/a', preset=bad)
        with self.assertRaisesRegex(ValueError, 'Unbekannte Aktion'):
            core.preset_action('delete-all', '/g/a')

    def test_the_general_default_is_saved_and_reset_without_a_repository_path(self):
        seen = []

        def reply(entry, args, timeout=60):
            seen.append(args[:2])
            if args[0] == 'save-general':
                seen.append(json.loads(Path(args[2]).read_text(encoding='utf-8')))
                self.assertEqual(len(args), 3)                                            # kein Pfad dazwischen
            return {'code': 0, 'out': json.dumps({'terminals': self.PRESET['terminals'], 'urls': self.PRESET['urls']}), 'err': ''}

        with patch.object(core, 'call_module', side_effect=reply):
            saved = core.preset_action('save-general', '', preset=self.PRESET)
            reset = core.preset_action('reset-general', '')
        self.assertEqual(saved['message'], 'Allgemeiner Standard gespeichert (2 Terminals, 1 Browser-Tabs). '
                                           'Er gilt für Repositories ohne eigenes Preset.')
        self.assertEqual(reset['message'], 'Allgemeiner Standard zurückgesetzt: es gelten wieder die eingebauten Standard-Terminals.')
        self.assertEqual(seen, [['save-general', str(self.config)], self.PRESET, ['reset-general', str(self.config)]])
        with self.assertRaisesRegex(ValueError, 'Preset fehlt'):
            core.preset_action('save-general', '', preset=None)

    def test_moving_a_preset_copies_first_and_only_then_removes_the_old_one(self):
        stored = [dict(self.PRESET, path='/alt/a')]
        calls = []

        def reply(entry, args, timeout=60):
            calls.append(args[0])
            if args[0] == 'list':
                return {'code': 0, 'out': json.dumps(stored), 'err': ''}
            if args[0] == 'save':
                return {'code': 0, 'out': json.dumps({'terminals': [], 'urls': []}), 'err': ''}
            return {'code': 0, 'out': 'ok', 'err': ''}

        with patch.object(core, 'call_module', side_effect=reply):
            self.assertEqual(core.preset_action('move', '/alt/a', to='/neu/a')['message'], 'Preset übernommen.')
        self.assertEqual(calls, ['list', 'save', 'reset'])
        for to, expected in [(None, 'anderes Repository'), ('/alt/a', 'anderes Repository')]:
            with patch.object(core, 'call_module', side_effect=reply), self.assertRaisesRegex(ValueError, expected):
                core.preset_action('move', '/alt/a', to=to)
        with patch.object(core, 'call_module', side_effect=reply), self.assertRaisesRegex(ValueError, 'gibt es nicht mehr'):
            core.preset_action('move', '/alt/fehlt', to='/neu/a')
        stored.append(dict(self.PRESET, path='/neu/a'))
        with patch.object(core, 'call_module', side_effect=reply), self.assertRaisesRegex(ValueError, 'schon ein eigenes Preset'):
            core.preset_action('move', '/alt/a', to='/neu/a')

    def test_a_failed_copy_never_loses_the_old_preset(self):
        calls = []

        def reply(entry, args, timeout=60):
            calls.append(args[0])
            if args[0] == 'list':
                return {'code': 0, 'out': json.dumps([dict(self.PRESET, path='/alt/a')]), 'err': ''}
            return {'code': 1, 'out': '', 'err': 'x: execution error: Error: Kaputt (-2700)'}

        with patch.object(core, 'call_module', side_effect=reply), self.assertRaisesRegex(ValueError, 'Kaputt'):
            core.preset_action('move', '/alt/a', to='/neu/a')
        self.assertEqual(calls, ['list', 'save'])                                         # reset wurde nie aufgerufen

    def test_presets_work_end_to_end_with_the_real_preset_store(self):
        known = [('a', '/neu/a'), ('b', '/neu/b')]
        core.preset_action('save', '/alt/a', preset=self.PRESET)
        info = core.presets_state(known)
        self.assertEqual([o['suggestion'] for o in info['orphans']], [{'name': 'a', 'path': '/neu/a'}])
        self.assertEqual(info['defaults']['local'][0]['name'], 'Frontend')
        core.preset_action('move', '/alt/a', to='/neu/a')
        info = core.presets_state(known)
        self.assertEqual((info['orphans'], [i['name'] for i in info['items']]), ([], ['a']))
        self.assertEqual([t['name'] for t in info['items'][0]['terminals']], ['Dev', 'Agent'])
        with self.assertRaisesRegex(ValueError, 'relativen Unterordner'):
            core.preset_action('save', '/neu/b', preset={'terminals': [dict(self.PRESET['terminals'][0], cwd='../x')], 'urls': []})
        core.preset_action('reset', '/neu/a')
        self.assertEqual(core.presets_state(known)['items'], [])
        core.preset_action('save-general', '', preset=self.PRESET)
        info = core.presets_state(known)
        self.assertEqual([t['name'] for t in info['general']['terminals']], ['Dev', 'Agent'])
        self.assertEqual((info['items'], info['orphans']), ([], []))                      # kein Repository-Eintrag
        with self.assertRaisesRegex(ValueError, 'relativen Unterordner'):
            core.preset_action('save-general', '', preset={'terminals': [dict(self.PRESET['terminals'][0], cwd='../x')], 'urls': []})
        self.assertEqual(len(core.presets_state(known)['general']['terminals']), 2)       # abgelehnt: der alte Standard bleibt
        core.preset_action('reset-general', '')
        self.assertIsNone(core.presets_state(known)['general'])

    def test_command_line_manages_presets(self):
        data = json.dumps(self.PRESET)
        code, out = self.cli('presets', 'save', '--path=/g/a', f'--data={data}', '--json')
        self.assertEqual(json.loads(out)['message'], 'Preset gespeichert (2 Terminals, 1 Browser-Tabs).')
        with patch.object(core, 'list_project_paths', return_value=[('a', '/g/a'), ('b', '/g/b')]):
            self.assertEqual(self.cli('presets', 'list')[1].splitlines(), ['a\tDev, Agent\t1 Browser-Tabs'])
        with patch.object(core, 'list_project_paths', return_value=[('neu', '/n/a')]):
            self.assertEqual(self.cli('presets', 'list')[1].splitlines(), ['a\tRepository nicht mehr gefunden -> /n/a'])   # gleicher Ordnername: Vorschlag
        self.assertEqual(self.cli('presets', 'move', '/g/a', '/g/b')[1].strip(), 'Preset übernommen.')
        self.assertEqual(self.cli('presets', 'reset', '/g/b')[1].strip(), 'Preset zurückgesetzt: es gilt wieder der Standard.')

    def test_command_line_manages_the_general_default(self):
        data = json.dumps(self.PRESET)
        code, out = self.cli('presets', 'save-general', f'--data={data}', '--json')
        self.assertEqual(json.loads(out)['message'].split(' (')[0], 'Allgemeiner Standard gespeichert')
        with patch.object(core, 'list_project_paths', return_value=[('a', '/g/a')]):
            self.assertEqual(self.cli('presets', 'list')[1].splitlines(), ['Allgemeiner Standard\tDev, Agent\t1 Browser-Tabs'])
        self.assertIn('eingebauten', self.cli('presets', 'reset-general')[1])
        with patch.object(core, 'list_project_paths', return_value=[('a', '/g/a')]):
            self.assertEqual(self.cli('presets', 'list')[1].splitlines(), [])

    def test_state_includes_the_presets(self):
        with patch.object(core, 'list_project_paths', return_value=[('A', '/a')]), \
             patch.object(core, 'list_project_paths', return_value=[('A', '/a')]) as paths, \
             patch.object(core, 'ssh_state', return_value={'available': False, 'hosts': []}), \
             patch.object(core, 'presets_state', return_value={'available': False}) as presets:
            info = core.state()
        self.assertEqual(info['presets'], {'available': False})
        presets.assert_called_once_with([('A', '/a')])                                    # Pfade nur einmal ermitteln

    def test_module_commands_pass_arguments_through(self):
        with patch.object(core.os, 'execvp') as execvp:
            self.cli('remote', 'ssh', 'share', '--wake')
        argv = execvp.call_args.args[1]
        self.assertEqual(argv, ['python3', str(ROOT / 'remote' / 'remote.py'), 'ssh', 'share', '--wake'])
        with patch.object(core.subprocess, 'run') as run:
            self.cli('open', 'local')
        self.assertEqual(shlex.split(run.call_args.args[0][-1]),
                         ['exec', sys.executable, str(ROOT / 'core' / 'terminal_session.py'),
                          '/bin/zsh', str(ROOT / 'local-dev' / 'launcher.zsh')])


if __name__ == '__main__':
    unittest.main()
