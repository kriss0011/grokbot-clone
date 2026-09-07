import base64
import importlib.util
import json
import os
import pathlib
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

spec = importlib.util.spec_from_file_location("exec_server", pathlib.Path(__file__).with_name("exec_server.py"))
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class ExecTests(unittest.TestCase):
    def command(self, script, **kwargs):
        return server.execute({"id": "test-command", "argv": [sys.executable, "-c", script],
                               "workingDir": tempfile.gettempdir(), **kwargs})

    def test_output_environment_and_exit(self):
        os.environ["RAKAZO_COMPUTER_CONTROL_TOKEN"] = "private-test-token"
        result = self.command("import os,sys;print(os.getenv('EXAMPLE'));print(os.getenv('RAKAZO_COMPUTER_CONTROL_TOKEN'));sys.exit(7)", env=["EXAMPLE=ok"])
        self.assertEqual(result["stdout"], "ok\nNone\n")
        self.assertEqual(result["code"], 7)

    def test_timeout(self):
        result = self.command("import time;time.sleep(10)", timeoutMs=50)
        self.assertEqual(result["code"], 124)

    def test_success_keeps_started_desktop_processes_alive(self):
        result = self.command("import subprocess; p=subprocess.Popen(['sleep','10'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); print(p.pid)")
        pid = int(result["stdout"])
        try:
            os.kill(pid, 0)
        finally:
            os.kill(pid, 9)

    def test_binary_stdin(self):
        data = bytes(range(256))
        result = self.command("import sys;print(len(sys.stdin.buffer.read()))", stdinBase64=base64.b64encode(data).decode())
        self.assertEqual(result["stdout"], "256\n")

    def test_output_limit(self):
        result = self.command("import sys;sys.stdout.write('x' * 9000000)")
        self.assertEqual(result["code"], 1)
        self.assertLessEqual(len(result["stdout"]), server.MAX_OUTPUT)

    def test_authentication_and_cancellation(self):
        server.TOKEN = "offline-private-test-token"
        listener = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        thread = threading.Thread(target=listener.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(listener.server_close)
        self.addCleanup(listener.shutdown)
        base = "http://127.0.0.1:" + str(listener.server_port)
        def request(path, body, token=server.TOKEN):
            req = urllib.request.Request(base + path, data=json.dumps(body).encode(),
                                         headers={"Authorization": "Bearer " + token}, method="POST")
            with urllib.request.urlopen(req, timeout=5) as response:
                return json.load(response)
        with self.assertRaises(urllib.error.HTTPError) as caught:
            request("/ready", {}, "wrong")
        self.assertEqual(caught.exception.code, 401)
        result = []
        worker = threading.Thread(target=lambda: result.append(request("/exec", {
            "id": "cancel-me", "argv": [sys.executable, "-c", "import time;time.sleep(60)"],
            "workingDir": tempfile.gettempdir(), "timeoutMs": 120000})))
        worker.start()
        for _ in range(100):
            with server.LOCK:
                if "cancel-me" in server.ACTIVE:
                    break
            time.sleep(0.01)
        request("/cancel", {"id": "cancel-me"})
        worker.join(3)
        self.assertFalse(worker.is_alive())
        self.assertNotEqual(result[0]["code"], 0)
        request("/cancel", {"id": "cancel-before-start"})
        with self.assertRaises(ValueError):
            server.execute({"id": "cancel-before-start", "argv": [sys.executable, "-c", "pass"]})


if __name__ == "__main__":
    unittest.main()
