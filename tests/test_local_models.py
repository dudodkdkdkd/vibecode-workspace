"""Ollama models (local-dev/models.py): only throwaway folders and a fake `ollama`, never the real one."""
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'local-dev' / 'models.py'


class ModelsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='vibecode-models-'))
        self.addCleanup(lambda: __import__('shutil').rmtree(self.tmp, ignore_errors=True))
        self.models = self.tmp / 'models'
        self.log = self.tmp / 'calls.log'
        self.fake = self.tmp / 'ollama'
        self.fake.write_text('#!/bin/sh\necho "$OLLAMA_HOST $*" >> "$FAKE_LOG"\n[ -n "$FAKE_FAIL" ] && { echo "$FAKE_FAIL" >&2; exit 1; }\nexit 0\n')
        self.fake.chmod(self.fake.stat().st_mode | stat.S_IXUSR)
        self.config = self.tmp / 'local-ai.json'
        self.write_config()

    def write_config(self, **provider):
        profile = dict({'type': 'ollama', 'name': 'Ollama (lokal)', 'default_model': 'deepseek-coder:6.7b', 'host': '127.0.0.1',
                        'port': 11434, 'server_command': str(self.fake)}, **provider)
        self.config.write_text(json.dumps({'providers': {'mlx': {'type': 'mlx'}, 'ollama': profile}}), encoding='utf-8')

    def manifest(self, name, layers=(100, 20), namespace='library', host='registry.ollama.ai'):
        model, _, tag = name.rpartition(':')
        path = self.models / 'manifests' / host / namespace / model / tag
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({'config': {'size': 5}, 'layers': [{'size': size} for size in layers]}), encoding='utf-8')

    def run_models(self, *args, fail=''):
        env = dict(os.environ, LOCAL_DEV_CONFIG_FILE=str(self.config), OLLAMA_MODELS=str(self.models), FAKE_LOG=str(self.log), FAKE_FAIL=fail)
        return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True, timeout=30, env=env, stdin=subprocess.DEVNULL)

    def listing(self):
        result = self.run_models('list')
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_installed_models_come_from_the_manifests_with_name_and_size(self):
        self.manifest('qwen2.5-coder:7b')
        self.manifest('llama3.1:8b', layers=(1000,))
        self.manifest('tool:latest', namespace='someone')
        self.manifest('private:1b', namespace='team', host='registry.example.invalid')
        found = {model['name']: model['size'] for model in self.listing()['models']}
        self.assertEqual(found, {'qwen2.5-coder:7b': 125, 'llama3.1:8b': 1005, 'someone/tool:latest': 125,
                                 'registry.example.invalid/team/private:1b': 125})
        self.assertTrue(all(model['modified'].endswith('Z') for model in self.listing()['models']))
        self.assertEqual([m['name'] for m in self.listing()['models']], sorted(found, key=str.casefold))

    def test_not_downloaded_are_the_configured_and_suggested_models_without_the_installed_ones(self):
        self.manifest('qwen2.5-coder:7b')
        data = self.listing()
        names = [item['name'] for item in data['missing']]
        self.assertEqual(names[0], 'deepseek-coder:6.7b')                           # the configured one first
        self.assertEqual(data['missing'][0]['why'], 'eingestellt')
        self.assertNotIn('qwen2.5-coder:7b', names)                                 # installed: not offered again
        self.assertEqual(len(names), len(set(names)))
        self.assertTrue(all(item['why'] == 'Vorschlag' for item in data['missing'][1:]))
        self.manifest('deepseek-coder:6.7b')
        self.assertNotIn('deepseek-coder:6.7b', [item['name'] for item in self.listing()['missing']])

    def test_listing_never_calls_ollama_and_survives_missing_or_broken_files(self):
        self.manifest('ok:1b')
        broken = self.models / 'manifests' / 'registry.ollama.ai' / 'library' / 'broken' / 'latest'
        broken.parent.mkdir(parents=True)
        broken.write_text('{kein json', encoding='utf-8')
        (self.models / 'manifests' / 'registry.ollama.ai' / 'library' / 'tiefer' / 'a' / 'b').mkdir(parents=True)   # wrong depth
        found = {model['name']: model['size'] for model in self.listing()['models']}
        self.assertEqual(found, {'broken:latest': 0, 'ok:1b': 125})                # a manifest nobody can read counts 0 bytes
        self.assertFalse(self.log.exists())                                        # the fake was never started
        empty = self.tmp / 'nothing'
        env = dict(os.environ, LOCAL_DEV_CONFIG_FILE=str(self.config), OLLAMA_MODELS=str(empty))
        out = subprocess.run([sys.executable, str(SCRIPT), 'list'], capture_output=True, text=True, env=env, stdin=subprocess.DEVNULL)
        self.assertEqual(json.loads(out.stdout)['models'], [])

    def test_cli_flag_and_a_config_without_ollama(self):
        self.assertTrue(self.listing()['cli'])
        self.write_config(server_command=str(self.tmp / 'gibt-es-nicht'))
        self.assertFalse(self.listing()['cli'])
        self.config.write_text(json.dumps({'providers': {'mlx': {'type': 'mlx'}}}), encoding='utf-8')
        self.assertEqual(self.listing(), {'available': False})

    def test_remove_runs_ollama_rm_for_an_installed_model_only(self):
        self.manifest('qwen2.5-coder:7b')
        self.write_config(host='127.0.0.1', port=11555)
        ok = self.run_models('remove', 'qwen2.5-coder:7b')
        self.assertEqual((ok.returncode, ok.stdout.strip()), (0, '„qwen2.5-coder:7b“ wurde entfernt.'))
        self.assertEqual(self.log.read_text().strip(), '127.0.0.1:11555 rm qwen2.5-coder:7b')
        self.log.unlink()
        other = self.run_models('remove', 'llama3.1:8b')
        self.assertEqual(other.returncode, 1)
        self.assertIn('nicht installiert', other.stderr)
        self.assertFalse(self.log.exists())

    def test_remove_reports_why_ollama_failed(self):
        self.manifest('qwen2.5-coder:7b')
        failed = self.run_models('remove', 'qwen2.5-coder:7b', fail='could not connect to ollama app, is it running?')
        self.assertEqual(failed.returncode, 1)
        self.assertIn('could not connect to ollama app, is it running?', failed.stderr)

    def test_names_are_checked_before_anything_runs(self):
        for bad in ('-oProxy', '--force', 'a b', '../x', 'x;rm', '', 'a:b:c', 'x' * 400, 'ok\nname'):
            for command in ('check', 'remove', 'pull'):
                with self.subTest(command=command, name=bad):
                    result = self.run_models(command, bad)
                    self.assertEqual(result.returncode, 1)
                    self.assertIn('Ungültiger Modellname', result.stderr)
        self.assertFalse(self.log.exists())

    def test_check_has_no_side_effects(self):
        result = self.run_models('check', 'qwen2.5-coder:7b')
        self.assertEqual((result.returncode, result.stdout.strip()), (0, 'ok'))
        self.assertFalse(self.log.exists())

    def test_pull_replaces_itself_with_ollama_pull_and_the_configured_endpoint(self):
        self.write_config(port=11999)
        result = self.run_models('pull', 'qwen2.5-coder:7b')
        self.assertEqual(result.returncode, 0)
        self.assertEqual(self.log.read_text().strip(), '127.0.0.1:11999 pull qwen2.5-coder:7b')

    def test_missing_ollama_and_wrong_usage(self):
        self.write_config(server_command=str(self.tmp / 'gibt-es-nicht'))
        self.manifest('a:1b')
        for command in ('check', 'remove', 'pull'):
            result = self.run_models(command, 'a:1b')
            self.assertEqual(result.returncode, 1, command)
            self.assertIn('Ollama wurde nicht gefunden', result.stderr)
        for args in ((), ('list', 'x'), ('check',), ('remove',), ('pull', 'a', 'b'), ('anders',)):
            self.assertEqual(self.run_models(*args).returncode, 2, args)


if __name__ == '__main__':
    unittest.main()
