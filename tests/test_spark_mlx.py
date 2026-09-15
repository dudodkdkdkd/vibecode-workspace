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


@unittest.skipUnless(shutil.which("lsof"), "lsof required")
class SparkMLXTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()