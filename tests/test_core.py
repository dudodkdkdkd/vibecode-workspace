"""VibeCode Grundapp: Workspaces, Schreibtisch-Shortcuts, Module.

Echte Finder-Aliasse (macOS) in einem Wegwerf-"Schreibtisch"; ~/.config und der echte
Schreibtisch werden nie berührt.
"""
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
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

    def save(self, name='Patigon', projects=('A', 'B'), shortcut=False, rename_from=None):
        return core.save_workspace(name, list(projects), shortcut, rename_from)

    def alias_target(self, name):
        state = core.alias_js('inspect', str(self.desktop / name))
        return Path(state[6:]) if state.startswith('alias ') else state

    # --- Validierung --------------------------------------------------------------

    def test_names_are_normalized_and_unsafe_names_rejected(self):
        self.assertEqual(core.clean_name('  Patigon   Alle \t'), 'Patigon Alle')
        self.assertEqual(core.clean_name('Für Patigon'), 'Für Patigon')
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
        self.save('Patigon', ['A'])
        self.save('Patigon', ['A', 'B'], rename_from='Patigon')          # nur Projekte ändern
        self.assertEqual(core.read_store()['workspaces'][0]['projects'], ['A', 'B'])
        self.save('Alle', ['A', 'B'], rename_from='Patigon')
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
        self.save('Für Patigon', ['A'], shortcut=True)
        starter = core.starter_path('Für Patigon')
        self.assertEqual(self.alias_target('Für Patigon').resolve(), starter.resolve())
        self.assertTrue(stat.S_IMODE(starter.stat().st_mode) & 0o100)
        self.assertIn("run 'Für Patigon'", starter.read_text())
        self.assertTrue(core.read_store()['workspaces'][0]['shortcut'])

    def test_turning_the_shortcut_off_and_deleting_remove_only_our_files(self):
        self.save('Patigon', ['A'], shortcut=True)
        self.save('Patigon', ['A'], shortcut=False, rename_from='Patigon')
        self.assertEqual(self.alias_target('Patigon'), 'missing')
        self.assertFalse(core.starter_path('Patigon').exists())
        self.save('Patigon', ['A'], shortcut=True, rename_from='Patigon')
        core.delete_workspace('Patigon')
        self.assertEqual(self.alias_target('Patigon'), 'missing')
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
        foreign = self.desktop / 'Patigon'
        foreign.write_text('meine Datei')
        with self.assertRaisesRegex(ValueError, 'nicht von VibeCode'):
            self.save('Patigon', ['A'], shortcut=True)
        self.assertEqual(core.read_store()['workspaces'], [])            # nichts gespeichert
        self.save('Patigon', ['A'], shortcut=False)                      # ohne Shortcut ist es erlaubt
        core.delete_workspace('Patigon')
        self.assertEqual(foreign.read_text(), 'meine Datei')

    def test_a_dead_alias_of_that_name_is_replaced(self):
        self.save('Patigon', ['A'], shortcut=True)
        core.starter_path('Patigon').unlink()
        self.assertEqual(core.alias_js('inspect', str(self.desktop / 'Patigon')), 'alias-broken')
        self.assertEqual(core.sync_shortcuts(), 1)
        self.assertEqual(self.alias_target('Patigon').resolve(), core.starter_path('Patigon').resolve())

    def test_failed_shortcut_leaves_the_stored_configuration_unchanged(self):
        self.save('Patigon', ['A'])
        (self.desktop / 'Neu').write_text('fremd')
        with self.assertRaises(ValueError):
            self.save('Neu', ['B'], shortcut=True, rename_from='Patigon')
        self.assertEqual([w['name'] for w in core.read_store()['workspaces']], ['Patigon'])

    def test_generated_starter_passes_the_exact_name_to_the_app(self):
        fake = self.tmp / 'repo'
        (fake / 'core').mkdir(parents=True)
        (fake / 'core' / 'vibecode.py').write_text('import sys, json; print(json.dumps(sys.argv[1:]))')
        self.config.mkdir(exist_ok=True)
        (self.config / 'home').write_text(str(fake) + '\n')
        for name in ["Für 'Patigon' & Co", 'a b']:
            self.save(name, ['A'], shortcut=False)
            core.add_shortcut(name)
            out = subprocess.run(['/bin/zsh', str(core.starter_path(name))], capture_output=True, text=True,
                                 env=dict(os.environ), timeout=30)
            self.assertEqual(json.loads(out.stdout), ['run', name], out.stderr)

    # --- Start ---------------------------------------------------------------------

    def test_run_executes_the_launcher_with_one_project_flag_per_project(self):
        self.save('Patigon', ['A', 'B'])
        with patch.object(core.os, 'execv') as execv:
            core.run_workspace('patigon')
        execv.assert_called_once_with(str(core.LAUNCHER), [str(core.LAUNCHER), '--project', 'A', '--project', 'B'])
        self.assertEqual((self.config / 'home').read_text().strip(), str(core.REPO))
        with self.assertRaises(ValueError):
            core.run_workspace('gibt es nicht')

    def test_start_is_detached_and_logs_instead_of_losing_output(self):
        self.save('Patigon', ['A'])
        with patch.object(core.subprocess, 'Popen') as popen:
            core.start_workspace('Patigon')
        self.assertEqual(popen.call_args.args[0], [str(core.LAUNCHER), '--project', 'A'])
        self.assertTrue(popen.call_args.kwargs['start_new_session'])
        self.assertTrue((self.config / 'last-start.log').exists())

    # --- Module ---------------------------------------------------------------------

    def test_repository_modules_register_themselves(self):
        entries = {e['id']: e for e in core.module_entries()}
        self.assertEqual(set(entries), {'launch', 'setup', 'remote', 'local'})
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
        self.save('Patigon', ['A', 'weg'], shortcut=False)
        with patch.object(core, 'list_projects', return_value=['A', 'B']):
            state = core.state()
        self.assertEqual(state['workspaces'][0]['missing'], ['weg'])
        self.assertEqual(state['projects'], ['A', 'B'])
        self.assertEqual({e['id'] for e in state['entries']}, {'launch', 'setup', 'remote', 'local'})

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

    def test_module_commands_pass_arguments_through(self):
        with patch.object(core.os, 'execvp') as execvp:
            self.cli('remote', 'ssh', 'share', '--wake')
        argv = execvp.call_args.args[1]
        self.assertEqual(argv, ['python3', str(ROOT / 'remote' / 'remote.py'), 'ssh', 'share', '--wake'])
        with patch.object(core.subprocess, 'run') as run:
            self.cli('open', 'local')
        self.assertEqual(run.call_args.args[0][-1], 'exec /bin/zsh ' + str(ROOT / 'local-dev' / 'launcher.zsh'))


if __name__ == '__main__':
    unittest.main()
