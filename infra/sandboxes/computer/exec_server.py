#!/usr/bin/env python3
"""Authenticated command transport for hosts whose OCI exec cannot join namespaces."""
import hmac
import base64
import json
import os
import re
import selectors
import signal
import subprocess
import threading
import tempfile
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_OUTPUT = 8 * 1024 * 1024
MAX_BODY = 24 * 1024 * 1024
TOKEN = os.environ.get("RAKAZO_COMPUTER_CONTROL_TOKEN", "")
ACTIVE = {}
LOCK = threading.Lock()
CANCELLED = {}


def stop(child):
    try:
        os.killpg(child.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def execute(body):
    request_id = body.get("id", "")
    argv = body.get("argv")
    if not re.fullmatch(r"[a-zA-Z0-9-]{1,80}", request_id):
        raise ValueError("invalid command id")
    if not isinstance(argv, list) or not argv or not all(isinstance(x, str) for x in argv):
        raise ValueError("invalid command")
    timeout = body.get("timeoutMs", 300000)
    if not isinstance(timeout, (int, float)) or not 0 < timeout <= 3600000:
        raise ValueError("invalid timeout")
    env = dict(os.environ)
    # Commands never inherit the control listener's credential.
    env.pop("RAKAZO_COMPUTER_CONTROL_TOKEN", None)
    for entry in body.get("env", []):
        key, value = entry.split("=", 1)
        env[key] = value
    with LOCK:
        if CANCELLED.pop(request_id, 0) > time.monotonic():
            raise ValueError("command cancelled")
        if request_id in ACTIVE:
            raise ValueError("duplicate command")
        input_file = None
        if body.get("stdinBase64") is not None:
            content = base64.b64decode(body["stdinBase64"], validate=True)
            if len(content) > 16 * 1024 * 1024:
                raise ValueError("input too large")
            input_file = tempfile.TemporaryFile()
            input_file.write(content)
            input_file.seek(0)
        child = subprocess.Popen(argv, cwd=body.get("workingDir", "/home/rakazo"), env=env,
                                 stdin=input_file if input_file else (subprocess.PIPE if body.get("keepStdinOpen") else subprocess.DEVNULL), stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, start_new_session=True)
        ACTIVE[request_id] = child
    output = {"stdout": bytearray(), "stderr": bytearray()}
    selector = selectors.DefaultSelector()
    selector.register(child.stdout, selectors.EVENT_READ, "stdout")
    selector.register(child.stderr, selectors.EVENT_READ, "stderr")
    deadline = time.monotonic() + timeout / 1000
    failure = None
    total = 0
    try:
        while selector.get_map():
            if time.monotonic() >= deadline:
                failure = "command timed out"
                stop(child)
                break
            for key, _ in selector.select(0.05):
                chunk = os.read(key.fileobj.fileno(), 65536)
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                total += len(chunk)
                if total > MAX_OUTPUT:
                    failure = "command output exceeded limit"
                    stop(child)
                    break
                output[key.data].extend(chunk)
            if failure:
                break
        code = child.wait(timeout=5)
        return {"stdout": output["stdout"].decode("utf-8", "replace"),
                "stderr": output["stderr"].decode("utf-8", "replace") + (failure or ""),
                "code": 124 if failure == "command timed out" else (1 if failure else code)}
    finally:
        if child.poll() is None:
            stop(child)
        child.wait(timeout=5)
        child.stdout.close()
        child.stderr.close()
        if child.stdin:
            child.stdin.close()
        if input_file:
            input_file.close()
        selector.close()
        with LOCK:
            ACTIVE.pop(request_id, None)


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(30)

    def log_message(self, *_args):
        pass

    def do_POST(self):
        if not TOKEN or not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + TOKEN):
            self.send_error(401)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_BODY:
                raise ValueError("invalid body size")
            body = json.loads(self.rfile.read(length))
            if self.path == "/exec":
                response = execute(body)
            elif self.path == "/cancel":
                with LOCK:
                    child = ACTIVE.get(body.get("id"))
                    if child:
                        stop(child)
                    else:
                        while len(CANCELLED) >= 1024:
                            CANCELLED.pop(next(iter(CANCELLED)))
                        CANCELLED[body.get("id")] = time.monotonic() + 60
                response = {"ok": True}
            elif self.path == "/ready":
                response = {"ok": True}
            else:
                self.send_error(404)
                return
            encoded = json.dumps(response).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self.send_error(400, "Command request failed")


if __name__ == "__main__":
    if not TOKEN:
        raise SystemExit("Missing computer control token")
    ThreadingHTTPServer(("0.0.0.0", 7071), Handler).serve_forever()
