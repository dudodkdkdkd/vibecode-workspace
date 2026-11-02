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
    def run_launcher(
        self,
        config: Path,
        *arguments: str,
        input_text: str = "",
        extra_environment=None,
    ):
        environment = os.environ.copy()
        environment.update(
            {
                "LOCAL_DEV_CONFIG_FILE": str(config),
                "LOCAL_DEV_STATE_DIR": str(config.parent / "state"),
                "LOCAL_DEV_LOG_FILE": str(config.parent / "launcher.log"),
                "LOCAL_DEV_MANAGE_APPS": "0",
                "NO_COLOR": "1",
            }
        )
        if extra_environment:
            environment.update(extra_environment)
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
            self.assertEqual(
                rendered["provider"]["mlx"]["models"][model]["limit"],
                {"context": 32768, "input": 32768, "output": 4096},
            )
            self.assertEqual(
                rendered["compaction"],
                {"auto": True, "prune": True, "reserved": 4096},
            )
            self.assertEqual(rendered["permission"], "allow")

    def test_capability_tree_and_memory_plan_use_local_model_architecture(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            config = self.write_config(directory)
            cache = directory / "huggingface" / "hub" / "models--XHToken--Spark-X2.5-4B" / "snapshots" / "revision"
            cache.mkdir(parents=True)
            (cache / "config.json").write_text(json.dumps({
                "num_hidden_layers": 36,
                "num_key_value_heads": 4,
                "head_dim": 256,
            }))
            manifest = directory / "ollama" / "manifests" / "registry.ollama.ai" / "library" / "deepseek-coder" / "6.7b"
            manifest.parent.mkdir(parents=True)
            manifest.write_text("{}")
            data = json.loads(config.read_text())
            data["providers"]["mlx"]["server_command"] = "/usr/bin/true"
            data["providers"]["ollama"]["server_command"] = "/usr/bin/true"
            data["frameworks"]["opencode"]["command"] = "/usr/bin/true"
            data["frameworks"]["codex"]["command"] = "/usr/bin/true"
            data["frameworks"]["claude"]["command"] = "definitely-missing-local-ai-client"
            config.write_text(json.dumps(data))
            environment = {
                "HF_HOME": str(directory / "huggingface"),
                "OLLAMA_MODELS": str(directory / "ollama"),
            }

            tree = self.run_launcher(config, "--capabilities", extra_environment=environment)
            self.assertEqual(tree.returncode, 0, tree.stderr)
            self.assertIn("Spark-X2.5-4B · lokal", tree.stdout)
            self.assertIn("deepseek-coder:6.7b · lokal", tree.stdout)
            self.assertIn("Codex CLI · installiert, inkompatibel", tree.stdout)
            self.assertIn("Codex CLI · installiert, kompatibel", tree.stdout)
            self.assertIn("Claude Code · nicht installiert", tree.stdout)

            plan = self.run_launcher(config, "--memory-plan", extra_environment=environment)
            self.assertEqual(plan.returncode, 0, plan.stderr)
            self.assertIn("147456 Byte/Token", plan.stdout)
            self.assertIn("32768 → 49152 Tokens", plan.stdout)

            tuned = self.run_launcher(
                config, "--tune-memory", "4", "1", "gruen",
                extra_environment=environment,
            )
            self.assertEqual(tuned.returncode, 0, tuned.stderr)
            self.assertEqual(
                json.loads(config.read_text())["hardware_profiles"]["m2-max-32gb"]["providers"]["mlx"]["memory_budget"]["additional_unified_memory_gb"],
                3,
            )
            before = config.read_text()
            unsafe = self.run_launcher(
                config, "--tune-memory", "5", "0", "gelb",
                extra_environment=environment,
            )
            self.assertNotEqual(unsafe.returncode, 0)
            self.assertEqual(config.read_text(), before)
            oversized = self.run_launcher(
                config, "--tune-memory", "99", "0", "gruen",
                extra_environment=environment,
            )
            self.assertNotEqual(oversized.returncode, 0)
            self.assertEqual(config.read_text(), before)

    def options_fixture(self, directory: Path):
        config = self.write_config(directory)
        cache = directory / "huggingface" / "hub" / "models--XHToken--Spark-X2.5-4B" / "snapshots" / "revision"
        cache.mkdir(parents=True)
        (cache / "config.json").write_text(json.dumps({"num_hidden_layers": 36, "num_key_value_heads": 4, "head_dim": 256}))
        manifest = directory / "ollama" / "manifests" / "registry.ollama.ai" / "library" / "qwen" / "7b"
        manifest.parent.mkdir(parents=True)
        manifest.write_text("{}")
        data = json.loads(config.read_text())
        data["providers"]["mlx"]["server_command"] = "/usr/bin/true"
        data["providers"]["ollama"]["server_command"] = "/usr/bin/true"
        data["frameworks"]["opencode"]["command"] = "/usr/bin/true"
        data["frameworks"]["codex"]["command"] = "/usr/bin/true"
        data["frameworks"]["claude"]["command"] = "definitely-missing-local-ai-client"
        config.write_text(json.dumps(data))
        return config, {"HF_HOME": str(directory / "huggingface"), "OLLAMA_MODELS": str(directory / "ollama")}

    def test_options_lists_every_startable_combination_with_tabs_and_marks_the_configured_one(self):
        with tempfile.TemporaryDirectory() as temp:
            config, environment = self.options_fixture(Path(temp))
            before = config.read_text()

            result = self.run_launcher(config, "--options", extra_environment=environment)

            self.assertEqual(result.returncode, 0, result.stderr)
            rows = [line.split("\t") for line in result.stdout.splitlines()]
            self.assertTrue(all(len(row) == 9 for row in rows), result.stdout)
            self.assertEqual(rows, [
                # Anbieter, Name, Modell, lokal, CLI, CLI-Name, eingestellt, Anbieter bereit, CLI installiert
                ["mlx", "MLX (lokal)", "XHToken/Spark-X2.5-4B", "1", "opencode", "OpenCode", "1", "1", "1"],   # Codex: mlx spricht nicht Responses
                ["ollama", "Ollama (lokal)", "deepseek-coder:6.7b", "0", "codex", "Codex CLI", "0", "1", "1"],     # konfiguriert, nicht lokal
                ["ollama", "Ollama (lokal)", "deepseek-coder:6.7b", "0", "opencode", "OpenCode", "0", "1", "1"],
                ["ollama", "Ollama (lokal)", "qwen:7b", "1", "codex", "Codex CLI", "0", "1", "1"],
                ["ollama", "Ollama (lokal)", "qwen:7b", "1", "opencode", "OpenCode", "0", "1", "1"],
            ])
            self.assertFalse(any("claude" in row for row in rows))                              # nicht installiert: nie angeboten
            self.assertEqual(config.read_text(), before)                                       # Lesen ändert die Konfiguration nicht

    def test_options_skips_unavailable_providers_and_providers_without_a_usable_cli(self):
        with tempfile.TemporaryDirectory() as temp:
            config, environment = self.options_fixture(Path(temp))
            data = json.loads(config.read_text())
            data["providers"]["mlx"]["server_command"] = "definitely-missing-server"
            data["frameworks"]["opencode"]["command"] = "definitely-missing-local-ai-client"
            data["frameworks"]["codex"]["command"] = "definitely-missing-local-ai-client"
            config.write_text(json.dumps(data))

            result = self.run_launcher(config, "--options", extra_environment=environment)

            self.assertEqual((result.returncode, result.stdout), (0, ""))                      # nichts startbar: leere Liste, kein Fehler

    def test_options_all_also_lists_what_is_not_installed_but_never_an_incompatible_pair(self):
        with tempfile.TemporaryDirectory() as temp:
            config, environment = self.options_fixture(Path(temp))
            data = json.loads(config.read_text())
            data["providers"]["mlx"]["server_command"] = "definitely-missing-server"          # MLX nicht installiert
            data["frameworks"]["claude"]["command"] = "definitely-missing-local-ai-client"    # Claude nicht installiert
            config.write_text(json.dumps(data))

            startable = self.run_launcher(config, "--options", extra_environment=environment)
            everything = self.run_launcher(config, "--options-all", extra_environment=environment)

            self.assertEqual((startable.returncode, everything.returncode), (0, 0), everything.stderr)
            rows = [line.split("\t") for line in everything.stdout.splitlines()]
            self.assertTrue(all(len(row) == 9 for row in rows))
            summary = {(row[0], row[2], row[4]): (row[7], row[8], row[6]) for row in rows}
            # MLX fehlt nur im Startbaren; zum Einstellen ist es da, mit "Anbieter nicht bereit". Codex passt nicht zu MLX.
            self.assertEqual(summary[("mlx", "XHToken/Spark-X2.5-4B", "opencode")], ("0", "1", "1"))
            self.assertNotIn(("mlx", "XHToken/Spark-X2.5-4B", "codex"), summary)
            self.assertNotIn(("mlx", "XHToken/Spark-X2.5-4B", "claude"), summary)              # Claude braucht eine Anthropic-API
            self.assertEqual(summary[("ollama", "qwen:7b", "codex")], ("1", "1", "0"))
            self.assertFalse(any(row[0] == "mlx" for row in (line.split("\t") for line in startable.stdout.splitlines())))
            self.assertEqual(len(summary), len(rows))                                          # keine doppelten Zeilen

    def test_current_prints_the_saved_selection(self):
        with tempfile.TemporaryDirectory() as temp:
            config, environment = self.options_fixture(Path(temp))
            result = self.run_launcher(config, "--current", extra_environment=environment)
            self.assertEqual(result.stdout, "mlx\tXHToken/Spark-X2.5-4B\topencode\n")

    def test_set_default_saves_like_setup_keeps_the_rest_and_accepts_what_is_not_installed(self):
        with tempfile.TemporaryDirectory() as temp:
            config, environment = self.options_fixture(Path(temp))
            before = json.loads(config.read_text())
            before["providers"]["ollama"]["server_command"] = "definitely-missing-server"      # Ollama nicht installiert: trotzdem einstellbar
            config.write_text(json.dumps(before))
            before = json.loads(config.read_text())

            result = self.run_launcher(config, "--set-default", "ollama", "-odd:model", "codex", extra_environment=environment)

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("Gespeichert: Ollama (lokal) → -odd:model → Codex CLI", result.stdout)    # Modell mit führendem Minus
            after = json.loads(config.read_text())
            self.assertEqual((after["provider"], after["model"], after["framework"]), ("ollama", "-odd:model", "codex"))
            self.assertEqual(after["providers"]["ollama"]["default_model"], "-odd:model")             # wie --setup
            expected = json.loads(json.dumps(before))
            expected.update(provider="ollama", model="-odd:model", framework="codex")
            expected["providers"]["ollama"]["default_model"] = "-odd:model"
            self.assertEqual(after, expected)                                                         # alles andere unverändert
            current = self.run_launcher(config, "--current", extra_environment=environment)
            self.assertEqual(current.stdout, "ollama\t-odd:model\tcodex\n")
            self.assertEqual(list(config.parent.glob("local-ai.json.*")), [])                         # keine Temp-Reste

    def test_set_default_rejects_bad_input_and_leaves_the_configuration_untouched(self):
        with tempfile.TemporaryDirectory() as temp:
            config, environment = self.options_fixture(Path(temp))
            before = config.read_text()
            cases = [
                (("nope", "m", "opencode"), "Unbekannter Provider"),
                (("mlx", "m", "nope"), "Unbekannte CLI"),
                (("mlx", "m", "codex"), "nicht direkt kompatibel"),                             # Codex braucht Ollama/Responses
                (("mlx", "m", "claude"), "nicht direkt kompatibel"),
                (("mlx", "a\x07b", "opencode"), "Steuerzeichen"),
                (("mlx", "a\tb", "opencode"), "Steuerzeichen"),
                (("mlx", "", "opencode"), "Anbieter, Modell und CLI"),
                (("", "m", "opencode"), "Anbieter, Modell und CLI"),
            ]
            for arguments, message in cases:
                result = self.run_launcher(config, "--set-default", *arguments, extra_environment=environment)
                self.assertNotEqual(result.returncode, 0, arguments)
                self.assertIn(message, result.stderr, arguments)
                self.assertEqual(config.read_text(), before, arguments)

    def test_a_start_with_provider_model_cli_and_repository_given_asks_nothing(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            config, environment = self.options_fixture(directory)
            repo = directory / "repo"
            repo.mkdir()
            data = json.loads(config.read_text())
            fake = directory / "agent"
            fake.write_text('#!/bin/sh\nprintf "%s|%s|%s\\n" "$PWD" "$*" "$LOCAL_AI_MODEL"\n')
            fake.chmod(0o755)
            data["frameworks"]["opencode"]["command"] = str(fake)
            config.write_text(json.dumps(data))
            environment.update({
                "LOCAL_DEV_PROVIDER": "ollama", "LOCAL_DEV_MODEL": "qwen:7b", "LOCAL_DEV_FRAMEWORK": "opencode",
                "LOCAL_DEV_REPOSITORY_PATH": str(repo), "LOCAL_DEV_OSASCRIPT_BIN": "/definitely/missing/osascript",
            })
            # Der Server gilt als schon bereit; es geht nur darum, dass keine Auswahl mehr erscheint und der Agent im Repository startet.
            server = ThreadingHTTPServer(("127.0.0.1", 0), type("Ready", (BaseHTTPRequestHandler,), {
                "do_GET": lambda self: (self.send_response(200), self.end_headers(), self.wfile.write(b"{}")),
                "log_message": lambda *args: None}))
            threading.Thread(target=server.serve_forever, daemon=True).start()
            self.addCleanup(server.server_close)
            self.addCleanup(server.shutdown)                      # läuft vor server_close: erst stoppen, dann Socket schließen
            data["providers"]["ollama"]["port"] = server.server_address[1]
            config.write_text(json.dumps(data))

            result = self.run_launcher(config, "start", extra_environment=environment)

            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn(f"{repo.resolve()}|", result.stdout)
            self.assertIn("|qwen:7b", result.stdout)

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

    # @unittest.skipUnless(shutil.which("lsof"), "lsof required")
    # def test_spark_mlx_readiness_with_spark_model(self):
    #     class ModelHandler(BaseHTTPRequestHandler):
    #         def do_GET(self):
    #             if self.path == "/health":
    #                 body = b'{"status":"ok"}'
    #             elif self.path == "/v1/models":
    #                 body = b'{"data":[{"id":"Spark-X2.5-4B"}]}'
    #             else:
    #                 self.send_error(404)
    #                 return
    #             self.send_response(200)
    #             self.send_header("Content-Type", "application/json")
    #             self.send_header("Content-Length", str(len(body)))
    #             self.end_headers()
    #             self.wfile.write(body)
    #
    #         def log_message(self, format, *args):
    #             pass
    #
    #     server = ThreadingHTTPServer(("127.0.0.1", 0), ModelHandler)
    #     thread = threading.Thread(target=server.serve_forever, daemon=True)
    #     thread.start()
    #     try:
    #         with tempfile.TemporaryDirectory() as temp:
    #             def point_to_spark_mlx(data):
    #                 provider = data["providers"]["mlx"]
    #                 provider["port"] = server.server_port
    #                 provider["server_command"] = "spark-mlx-wrapper"
    #                 data["model"] = "mlx-community/Spark-X2.5-4B"
    #
    #             config = self.write_config(Path(temp), point_to_spark_mlx)
    #
    #             result = self.run_launcher(config, "--status")
    #
    #             self.assertEqual(result.returncode, 0, result.stderr)
    #             self.assertIn("Providerprozess passen nicht", result.stdout)
    #     finally:
    #         server.shutdown()
    #         server.server_close()
    #         thread.join(timeout=2)

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

    def test_setup_can_configure_apps_to_close(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            config = self.write_config(directory)
            fake_osascript = directory / "fake-osascript"
            fake_osascript.write_text(
                "#!/bin/sh\n/bin/cat >/dev/null\nprintf '%s\\n' "
                "\"$FAKE_APP_SETTINGS\"\n"
            )
            fake_osascript.chmod(0o755)

            result = self.run_launcher(
                config,
                "--setup",
                input_text="\n\n\n",
                extra_environment={
                    "LOCAL_DEV_CONFIGURE_APPS": "1",
                    "LOCAL_DEV_OSASCRIPT_BIN": str(fake_osascript),
                    "FAKE_APP_SETTINGS": json.dumps(
                        {"enabled": True, "apps": ["Spotify", "Mail", "Notion"]}
                    ),
                },
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            saved = json.loads(config.read_text())
            self.assertTrue(saved["memory_management"]["enabled"])
            self.assertEqual(
                saved["memory_management"]["close_apps_on_start"],
                ["Spotify", "Mail", "Notion"],
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
            selected_repository = directory / "selected-repository"
            selected_repository.mkdir()
            selected_repository_real = selected_repository.resolve()
            projects_file = directory / "projects.tsv"
            projects_file.write_text(
                f"Selected Repository\t{selected_repository}\n"
            )
            fake_osascript = directory / "fake-osascript"
            fake_osascript.write_text(
                """#!/bin/sh
script_body=$(/bin/cat)
if printf '%s' "$*" | /usr/bin/grep -q 'Welches AI-Hosting'; then
    printf 'test-api-alt\n'
elif printf '%s' "$*" | /usr/bin/grep -q 'Welche CLI'; then
    printf 'alternate-client\n'
else
    printf '%s\n' "$FAKE_REPOSITORY_NAME"
fi
"""
            )
            fake_osascript.chmod(0o755)
            config_data = {
                "config_version": 2,
                "provider": "test-api",
                "model": "vendor/qwen-test",
                "framework": "test-client",
                "start_timeout_seconds": 8,
                "repository_selection": {
                    "enabled": True,
                    "projects_file": str(projects_file),
                    "remember_last": True,
                },
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
                    },
                    "test-api-alt": {
                        "type": "openai-compatible",
                        "protocol": "openai-chat",
                        "provider_id": "test_alt",
                        "name": "Alternate Test API",
                        "default_model": "vendor/qwen-test",
                        "base_url": f"http://127.0.0.1:{port}/v1",
                        "health_url": f"http://127.0.0.1:{port}/",
                        "start_command": [
                            sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1",
                        ],
                    },
                },
                "frameworks": {
                    "test-client": {
                        "adapter": "generic",
                        "name": "Environment Probe",
                        "command": "/usr/bin/env",
                        "args": [],
                        "working_directory": ".",
                    },
                    "alternate-client": {
                        "adapter": "generic",
                        "name": "Alternate Probe",
                        "command": "/usr/bin/env",
                        "args": ["SELECTED_CLIENT=alternate"],
                        "working_directory": ".",
                    },
                    "incompatible-client": {
                        "adapter": "codex",
                        "name": "Incompatible Probe",
                        "command": "/usr/bin/env",
                        "args": [],
                    },
                    "missing-client": {
                        "adapter": "generic",
                        "name": "Missing Probe",
                        "command": "definitely-missing-local-ai-client",
                        "args": [],
                    },
                },
            }
            config = directory / "local-ai.json"
            config.write_text(json.dumps(config_data))
            state_file = directory / "state" / "test-api-alt.pid"

            try:
                result = self.run_launcher(
                    config,
                    extra_environment={
                        "LOCAL_DEV_OSASCRIPT_BIN": str(fake_osascript),
                        "FAKE_REPOSITORY_NAME": "Selected Repository",
                    },
                )

                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("LOCAL_AI_MODEL=vendor/qwen-test", result.stdout)
                self.assertIn(
                    f"OPENAI_BASE_URL=http://127.0.0.1:{port}/v1",
                    result.stdout,
                )
                self.assertIn("SELECTED_CLIENT=alternate", result.stdout)
                self.assertIn("LOCAL_AI_PROVIDER=test_alt", result.stdout)
                self.assertIn(f"PWD={selected_repository_real}", result.stdout)
                self.assertEqual(json.loads(config.read_text())["framework"], "test-client")
                self.assertEqual(json.loads(config.read_text())["provider"], "test-api")
                self.assertEqual(
                    (directory / "state" / "last-repository.txt").read_text().strip(),
                    str(selected_repository_real),
                )
                self.assertEqual(
                    json.loads((directory / "state" / "active-session.json").read_text()),
                    {"provider": "test-api-alt", "model": "vendor/qwen-test", "framework": "alternate-client"},
                )

                stopped = self.run_launcher(config)
                self.assertEqual(stopped.returncode, 0, stopped.stderr)
                self.assertIn("Toggle: Beende Server", stopped.stdout)
                self.assertIn("wurde gestoppt", stopped.stdout)
                self.assertFalse((directory / "state" / "active-session.json").exists())
            finally:
                if state_file.exists():
                    try:
                        os.kill(int(state_file.read_text()), signal.SIGTERM)
                    except (ProcessLookupError, ValueError):
                        pass

    def test_chrome_is_closed_on_start_and_restored_on_stop(self):
        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]

        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            running_file = directory / "chrome-running"
            running_file.write_text("1")
            open_log = directory / "open.log"

            fake_osascript = directory / "fake-osascript"
            fake_osascript.write_text(
                """#!/bin/sh
script_body=$(/bin/cat)
if printf '%s' "$script_body" | /usr/bin/grep -q 'hasIncognitoWindow'; then
    if [ "$(/bin/cat "$FAKE_APP_RUNNING_FILE")" = "1" ]; then
        printf '0' > "$FAKE_APP_RUNNING_FILE"
        printf 'quit-requested\n'
    else
        printf 'not-running\n'
    fi
elif [ "$(/bin/cat "$FAKE_APP_RUNNING_FILE")" = "1" ]; then
    printf 'running\n'
else
    printf 'stopped\n'
fi
"""
            )
            fake_osascript.chmod(0o755)

            fake_open = directory / "fake-open"
            fake_open.write_text(
                """#!/bin/sh
printf '%s\n' "$*" >> "$FAKE_OPEN_LOG"
printf '1' > "$FAKE_APP_RUNNING_FILE"
"""
            )
            fake_open.chmod(0o755)

            config_data = {
                "config_version": 2,
                "provider": "test-api",
                "model": "vendor/test-model",
                "framework": "test-client",
                "start_timeout_seconds": 8,
                "memory_management": {
                    "enabled": True,
                    "close_apps_on_start": ["Google Chrome"],
                    "restore_apps_on_stop": True,
                },
                "providers": {
                    "test-api": {
                        "type": "openai-compatible",
                        "protocol": "openai-chat",
                        "provider_id": "test",
                        "name": "Test API",
                        "default_model": "vendor/test-model",
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
                        "name": "Test Client",
                        "command": "/usr/bin/true",
                        "args": [],
                        "working_directory": ".",
                    }
                },
            }
            config = directory / "local-ai.json"
            config.write_text(json.dumps(config_data))
            state_directory = directory / "state"
            provider_state = state_directory / "test-api.pid"
            app_state = state_directory / "suspended-apps.json"
            app_environment = {
                "LOCAL_DEV_MANAGE_APPS": "1",
                "LOCAL_DEV_OSASCRIPT_BIN": str(fake_osascript),
                "LOCAL_DEV_OPEN_BIN": str(fake_open),
                "FAKE_APP_RUNNING_FILE": str(running_file),
                "FAKE_OPEN_LOG": str(open_log),
            }

            try:
                started = self.run_launcher(
                    config,
                    "--start",
                    extra_environment=app_environment,
                )
                self.assertEqual(started.returncode, 0, started.stderr)
                self.assertIn("Google Chrome wurde", started.stdout)
                self.assertEqual(running_file.read_text(), "0")
                self.assertEqual(
                    json.loads(app_state.read_text()),
                    {"apps": ["Google Chrome"]},
                )

                stopped = self.run_launcher(
                    config,
                    "--stop",
                    extra_environment=app_environment,
                )
                self.assertEqual(stopped.returncode, 0, stopped.stderr)
                self.assertIn("Google Chrome wurde wieder geoeffnet", stopped.stdout)
                self.assertEqual(running_file.read_text(), "1")
                self.assertFalse(app_state.exists())
                self.assertIn(
                    "-a Google Chrome --args --restore-last-session",
                    open_log.read_text(),
                )

                disabled_config = json.loads(config.read_text())
                disabled_config["memory_management"]["enabled"] = False
                config.write_text(json.dumps(disabled_config))
                started_with_app_management_disabled = self.run_launcher(
                    config,
                    "--start",
                    extra_environment=app_environment,
                )
                self.assertEqual(
                    started_with_app_management_disabled.returncode,
                    0,
                    started_with_app_management_disabled.stderr,
                )
                self.assertEqual(running_file.read_text(), "1")
                self.assertFalse(app_state.exists())

                stopped_again = self.run_launcher(
                    config,
                    "--stop",
                    extra_environment=app_environment,
                )
                self.assertEqual(stopped_again.returncode, 0, stopped_again.stderr)
            finally:
                if provider_state.exists():
                    try:
                        os.kill(int(provider_state.read_text()), signal.SIGTERM)
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
