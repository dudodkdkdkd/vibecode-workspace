"""Lokale Suchordner: Hinzufügen, Entfernen, Zählen und die Suche selbst (echte Ordner im Wegwerf-Verzeichnis)."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

PATH = Path(__file__).resolve().parents[1] / 'workspaces' / 'local-folders.py'
spec = importlib.util.spec_from_file_location('local_folders', PATH)
f = importlib.util.module_from_spec(spec)
spec.loader.exec_module(f)


class LocalFolderTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='vibecode-folders-')
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name).resolve()
        self.config = self.base / 'config'
        self.root = self.base / 'Github'
        self.root.mkdir()

    def repo(self, relative, worktree=False):
        path = self.root / relative
        path.mkdir(parents=True)
        if worktree:
            (path / '.git').write_text('gitdir: /elsewhere/worktrees/x\n')
        else:
            (path / '.git').mkdir()
        return str(path)

    def stored(self):
        return json.loads((self.config / 'search-folders.json').read_text())

    # --- Suche -------------------------------------------------------------------------

    def test_finds_repositories_at_several_levels_and_worktrees(self):
        a, b = self.repo('alpha'), self.repo('org/beta')
        c = self.repo('wt', worktree=True)
        self.assertEqual(f.find_repos(self.root), (sorted([a, b, c]), False))

    def test_a_found_repository_is_not_searched_further(self):
        outer = self.repo('outer')
        (Path(outer) / 'vendor' / 'inner' / '.git').mkdir(parents=True)
        self.assertEqual(f.find_repos(self.root)[0], [outer])

    def test_dependency_hidden_and_symlinked_folders_are_skipped(self):
        keep = self.repo('keep')
        for skipped in ('node_modules/pkg', '.venv/x', 'venv/y', '.cache/z', 'Library/w', '.hidden/repo', '__pycache__/q'):
            (self.root / skipped / '.git').mkdir(parents=True)
        elsewhere = self.base / 'elsewhere' / 'linked'
        (elsewhere / '.git').mkdir(parents=True)
        os.symlink(elsewhere, self.root / 'link')
        self.assertEqual(f.find_repos(self.root)[0], [keep])

    def test_depth_limit_and_a_repository_as_the_folder_itself(self):
        deep = self.root
        for level in range(f.MAX_DEPTH + 1):
            deep = deep / f'l{level}'
        (deep / '.git').mkdir(parents=True)                                  # MAX_DEPTH + 1 Ebenen: zu tief
        reachable = self.root
        for level in range(f.MAX_DEPTH):
            reachable = reachable / f'r{level}'
        (reachable / '.git').mkdir(parents=True)                             # genau MAX_DEPTH Ebenen: noch gefunden
        self.assertEqual(f.find_repos(self.root)[0], [str(reachable)])
        own = self.repo('standalone')
        self.assertEqual(f.find_repos(own), ([own], False))

    def test_a_runaway_folder_is_cut_off_and_reported(self):
        for index in range(30):
            (self.root / f'd{index}').mkdir()
        with patch.object(f, 'MAX_DIRS', 10):
            repos, truncated = f.find_repos(self.root)
        self.assertTrue(truncated)
        self.assertEqual(repos, [])

    # --- Hinzufügen / Entfernen ------------------------------------------------------------

    def test_add_reports_the_count_and_stores_the_folder(self):
        self.repo('a')
        self.repo('b')
        result = f.add_folder(self.config, str(self.root))
        self.assertEqual(result, {'path': str(self.root), 'repos': 2, 'truncated': False})
        self.assertEqual(self.stored(), {'version': 1, 'folders': [{'path': str(self.root)}]})
        self.assertEqual(f.listing(self.config), [{'path': str(self.root), 'exists': True, 'repos': 2, 'truncated': False}])

    def test_add_rejects_bad_paths_and_duplicates_without_writing(self):
        file = self.base / 'datei.txt'
        file.write_text('x')
        link = self.base / 'zweiter-name'
        os.symlink(self.root, link)
        f.add_folder(self.config, str(self.root))
        before = (self.config / 'search-folders.json').read_text()
        for bad in ['', '   ', 'relativ/pfad', '/', str(file), str(self.base / 'gibts-nicht'), 'a\nb', None, 5,
                    str(link), str(self.root) + '/', str(self.root) + '/../Github']:
            with self.assertRaises(ValueError, msg=repr(bad)):
                f.add_folder(self.config, bad)
        self.assertEqual((self.config / 'search-folders.json').read_text(), before)

    def test_tilde_is_expanded(self):
        with patch.dict(os.environ, {'HOME': str(self.base)}):
            self.assertEqual(f.clean_path('~/Github'), self.root)

    def test_remove_forgets_only_that_folder(self):
        other = self.base / 'Other'
        other.mkdir()
        f.add_folder(self.config, str(self.root))
        f.add_folder(self.config, str(other))
        f.remove_folder(self.config, str(self.root) + '/')
        self.assertEqual(self.stored()['folders'], [{'path': str(other)}])
        with self.assertRaisesRegex(ValueError, 'kein Suchordner'):
            f.remove_folder(self.config, str(self.root))
        self.assertTrue(self.root.is_dir())                                  # der Ordner selbst bleibt unberührt

    def test_corrupt_store_is_rejected_and_never_overwritten(self):
        self.config.mkdir()
        path = self.config / 'search-folders.json'
        for bad in ['{', '[]', '{"version": 2, "folders": []}', '{"version": 1, "folders": [5]}',
                    '{"version": 1, "folders": [{"path": "relativ"}]}',
                    f'{{"version": 1, "folders": [{{"path": "{self.root}"}}, {{"path": "{self.root}"}}]}}']:
            path.write_text(bad)
            with self.assertRaises(ValueError, msg=bad):
                f.folders(self.config)
            with self.assertRaises(ValueError, msg=bad):
                f.add_folder(self.config, str(self.base))
            self.assertEqual(path.read_text(), bad)

    # --- Entdeckung für den Launcher -------------------------------------------------------

    def test_discover_prints_name_tab_path_without_duplicates_and_skips_missing_folders(self):
        a = self.repo('alpha')
        second = self.base / 'Second'
        (second / 'beta' / '.git').mkdir(parents=True)
        os.symlink(self.root, self.base / 'Alias')                           # zweiter Weg zu denselben Repos
        for folder in (self.root, second, self.base / 'Alias', self.base / 'weg'):
            self.config.mkdir(exist_ok=True)
            known = json.loads((self.config / 'search-folders.json').read_text()) if (
                self.config / 'search-folders.json').exists() else {'version': 1, 'folders': []}
            known['folders'].append({'path': str(folder)})
            (self.config / 'search-folders.json').write_text(json.dumps(known))
        self.assertEqual(f.discover(self.config), [f'alpha\t{a}', f'beta\t{second / "beta"}'])
        self.assertEqual([entry['exists'] for entry in f.listing(self.config)], [True, True, True, False])

    def test_command_line_round_trip(self):
        self.repo('a')
        run = lambda *args: subprocess.run([sys.executable, str(PATH), *args], capture_output=True, text=True)
        added = run('add', str(self.config), str(self.root))
        self.assertEqual((added.returncode, json.loads(added.stdout)['repos']), (0, 1))
        self.assertEqual(json.loads(run('list', str(self.config)).stdout)[0]['repos'], 1)
        self.assertEqual(run('discover', str(self.config)).stdout.strip().split('\t')[0], 'a')
        duplicate = run('add', str(self.config), str(self.root))
        self.assertEqual(duplicate.returncode, 1)
        self.assertIn('Suchordner: Dieser Ordner wird schon durchsucht', duplicate.stderr)
        self.assertEqual(run('remove', str(self.config), str(self.root)).returncode, 0)
        self.assertEqual(run('discover', str(self.config)).stdout, '')       # nichts: keine leere Zeile


if __name__ == '__main__':
    unittest.main()
