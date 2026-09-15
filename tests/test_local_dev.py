import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import unittest


ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = ROOT / "local-dev" / "launcher.zsh"
EXAMPLE = ROOT / "local-dev" / "local-ai.example.json"


@unittest.skipUnless(shutil.which("zsh") and shutil.which("jq"), "zsh and jq required")
class LocalDevLauncherTests(unittest.TestCase):
    def run_launcher(self, config: Path, *arguments: str, input_text: str = ""):
        environment = os.environ.copy()
        environment.update(
            {
                "LOCAL_DEV_CONFIG_FILE": str(config),
                "LOCAL_DEV_STATE_DIR": str(config.parent / "state"),
                "LOCAL_DEV_LOG_FILE": str(config.parent / "launcher.log"),
                "NO_COLOR": "1",
            }
        )
        return subprocess.run(
            ["zsh", str(LAUNCHER), *arguments],
            cwd=ROOT,
            env=environment,
            input=input_text,
            text=True,
            capture_output=True,
            timeout=10,
        )

    def write_config(self, directory: Path, update=None) -> Path:
        config = json.loads(EXAMPLE.read_text())
        if update:
            update(config)
        target = directory / "local-ai.json"
        target.write_text(json.dumps(config))
        return target

    def test_opencode_config_uses_arbitrary_model_id(self):
        with tempfile.TemporaryDirectory() as temp:
            model = "mlx-community/Qwen-example-4bit"
            config = self.write_config(
                Path(temp), lambda data: data.update(model=model)
            )

            result = self.run_launcher(config, "--render-opencode-config")

            self.assertEqual(result.returncode, 0, result.stderr)
            rendered = json.loads(result.stdout)
            self.assertEqual(rendered["model"], f"mlx/{model}")
            self.assertIn(model, rendered["provider"]["mlx"]["models"])

    @unittest.skipUnless(shutil.which("lsof"), "lsof required")
    def test_mlx_readiness_rejects_wrong_server_runtime(self):
        class ModelHandler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == "/health":
                    body = b'{"status":"ok"}'
                elif self.path == "/v1/models":
                    body = b'{"data":[{"id":"XHToken/Spark-X2.5-4B"}]}'
                else:
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, format, *args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), ModelHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as temp:
                def point_to_wrong_runtime(data):
                    provider = data["providers"]["mlx"]
                    provider["port"] = server.server_port
                    provider["server_command"] = "expected-spark-wrapper"

                config = self.write_config(Path(temp), point_to_wrong_runtime)

                result = self.run_launcher(config, "--status")

                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("Providerprozess passen nicht", result.stdout)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_setup_keeps_profiles_dynamic_and_accepts_free_model(self):
        with tempfile.TemporaryDirectory() as temp:
            config = self.write_config(Path(temp))

            result = self.run_launcher(
                config,
                "--setup",
                input_text="\n\nmlx-community/gemma-example-4bit\n",
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            saved = json.loads(config.read_text())
            self.assertEqual(saved["provider"], "mlx")
            self.assertEqual(saved["framework"], "opencode")
            self.assertEqual(saved["model"], "mlx-community/gemma-example-4bit")
            self.assertEqual(
                saved["providers"]["mlx"]["default_model"],
                "mlx-community/gemma-example-4bit",
            )

    def test_switching_provider_uses_its_configured_default_model(self):
        with tempfile.TemporaryDirectory() as temp:
            config = self.write_config(Path(temp))

            result = self.run_launcher(
                config,
                "--setup",
                input_text="2\n\n\n",
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            saved = json.loads(config.read_text())
            self.assertEqual(saved["provider"], "ollama")
            self.assertEqual(saved["model"], "deepseek-coder:6.7b")
            self.assertEqual(saved["framework"], "opencode")

    def test_claude_rejects_openai_chat_source_without_rewriting_config(self):
        with tempfile.TemporaryDirectory() as temp:
            def select_claude(data):
                data["framework"] = "claude"

            config = self.write_config(Path(temp), select_claude)
            before = config.read_text()

            result = self.run_launcher(config, "--check")

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Anthropic-kompatible API", result.stderr)
            self.assertEqual(config.read_text(), before)

    @unittest.skipUnless(shutil.which("codex") and shutil.which("ollama"), "Codex and Ollama required")
    def test_codex_accepts_ollama_profile(self):
        with tempfile.TemporaryDirectory() as temp:
            def select_codex_ollama(data):
                data["provider"] = "ollama"
                data["model"] = data["providers"]["ollama"]["default_model"]
                data["framework"] = "codex"

            config = self.write_config(Path(temp), select_codex_ollama)

            result = self.run_launcher(config, "--check")

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("Framework-Befehl gefunden", result.stdout)

    @unittest.skipUnless(shutil.which("claude"), "Claude Code required")
    def test_claude_accepts_anthropic_compatible_profile(self):
        with tempfile.TemporaryDirectory() as temp:
            def add_gateway(data):
                data["providers"]["gateway"] = {
                    "type": "openai-compatible",
                    "protocol": "anthropic",
                    "provider_id": "gateway",
                    "name": "Anthropic Gateway",
                    "default_model": "local-model",
                    "base_url": "http://127.0.0.1:9000",
                    "health_url": "http://127.0.0.1:9000/health",
                    "start_command": [],
                }
                data["provider"] = "gateway"
                data["model"] = "local-model"
                data["framework"] = "claude"

            config = self.write_config(Path(temp), add_gateway)

            result = self.run_launcher(config, "--check")

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("Framework-Befehl gefunden", result.stdout)

    def test_custom_source_starts_and_exports_session_environment(self):
        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]

        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            config_data = {
                "config_version": 2,
                "provider": "test-api",
                "model": "vendor/qwen-test",
                "framework": "test-client",
                "start_timeout_seconds": 8,
                "providers": {
                    "test-api": {
                        "type": "openai-compatible",
                        "protocol": "openai-chat",
                        "provider_id": "test",
                        "name": "Test API",
                        "default_model": "vendor/qwen-test",
                        "base_url": f"http://127.0.0.1:{port}/v1",
                        "health_url": f"http://127.0.0.1:{port}/",
                        "start_command": [
                            sys.executable,
                            "-m",
                            "http.server",
                            str(port),
                            "--bind",
                            "127.0.0.1",
                        ],
                    }
                },
                "frameworks": {
                    "test-client": {
                        "adapter": "generic",
                        "name": "Environment Probe",
                        "command": "/usr/bin/env",
                        "args": [],
                        "working_directory": ".",
                    }
                },
            }
            config = directory / "local-ai.json"
            config.write_text(json.dumps(config_data))
            state_file = directory / "state" / "test-api.pid"

            try:
                result = self.run_launcher(config)

                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("LOCAL_AI_MODEL=vendor/qwen-test", result.stdout)
                self.assertIn(
                    f"OPENAI_BASE_URL=http://127.0.0.1:{port}/v1",
                    result.stdout,
                )

                stopped = self.run_launcher(config, "--stop")
                self.assertEqual(stopped.returncode, 0, stopped.stderr)
                self.assertIn("wurde gestoppt", stopped.stdout)
            finally:
                if state_file.exists():
                    try:
                        os.kill(int(state_file.read_text()), signal.SIGTERM)
                    except (ProcessLookupError, ValueError):
                        pass

    def test_legacy_config_is_migrated_with_backup_and_all_models_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            legacy = {
                "$schema": "./local-ai.schema.json",
                "active_source": "mlx",
                "active_framework": "opencode",
                "sources": {
                    "mlx": {
                        "type": "mlx",
                        "protocol": "openai-chat",
                        "provider": "mlx",
                        "name": "MLX",
                        "model": "vendor/spark",
                        "host": "127.0.0.1",
                        "port": 8000,
                        "server_command": "missing-mlx",
                    },
                    "ollama": {
                        "type": "ollama",
                        "protocol": "openai-chat",
                        "provider": "ollama",
                        "name": "Ollama",
                        "model": "qwen:latest",
                        "host": "127.0.0.1",
                        "port": 11434,
                        "server_command": "missing-ollama",
                    },
                },
                "frameworks": {
                    "opencode": {
                        "adapter": "opencode",
                        "name": "OpenCode",
                        "command": "missing-opencode",
                        "args": [],
                    }
                },
            }
            config = directory / "local-ai.json"
            config.write_text(json.dumps(legacy))

            result = self.run_launcher(config, "--status")

            self.assertEqual(result.returncode, 0, result.stderr)
            migrated = json.loads(config.read_text())
            self.assertEqual(migrated["provider"], "mlx")
            self.assertEqual(migrated["model"], "vendor/spark")
            self.assertEqual(migrated["framework"], "opencode")
            self.assertEqual(
                migrated["providers"]["ollama"]["default_model"],
                "qwen:latest",
            )
            self.assertEqual(
                migrated["providers"]["mlx"]["provider_id"],
                "mlx",
            )
            backup = directory / "local-ai.json.pre-v2.bak"
            self.assertTrue(backup.exists())
            self.assertEqual(json.loads(backup.read_text()), legacy)


if __name__ == "__main__":
    unittest.main()
