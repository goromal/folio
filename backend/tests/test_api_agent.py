import json
import subprocess
import tempfile
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from werkzeug.security import generate_password_hash

from folio_backend.agent_auth import AgentAuth, load_secrets
from folio_backend.agent_router import create_agent_router


class FakeSessions:
    def __init__(self):
        self.agents = ("claude", "codex")
        self.active = []
        self.killed = []
        self.sent = []
        self.send_error = None

    def list(self):
        return list(self.active)

    def spawn(self, agent):
        if agent not in self.agents:
            raise ValueError("bad agent")
        name = f"folio-agent--{agent}--0123abcd"
        self.active.append({"name": name, "agent": agent, "created": 1, "attached": 0})
        return name

    def kill(self, name):
        self.killed.append(name)

    def send(self, name, text):
        if self.send_error:
            raise self.send_error
        self.sent.append((name, text))


def _client():
    tmp = tempfile.NamedTemporaryFile(suffix=".json", mode="w", delete=False)
    json.dump({"secret_key": "k", "password_hash": generate_password_hash("pw")}, tmp)
    tmp.close()
    key, pwhash = load_secrets(tmp.name)
    sessions = FakeSessions()
    app = FastAPI()
    app.include_router(create_agent_router(AgentAuth(key, pwhash), sessions,
                                           secure_cookie=False))
    return TestClient(app), sessions


class AgentApiTest(unittest.TestCase):
    def test_auth_gate(self):
        client, _ = _client()
        self.assertEqual(client.get("/agent/auth-check").status_code, 401)
        self.assertEqual(client.post("/agent/login", json={"password": "wrong"}).status_code, 401)
        ok = client.post("/agent/login", json={"password": "pw"})
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(client.get("/agent/auth-check").status_code, 204)

    def test_config_and_spawn_kill(self):
        client, sessions = _client()
        csrf = client.post("/agent/login", json={"password": "pw"}).json()["csrf"]
        cfg = client.get("/agent/config").json()
        self.assertEqual(cfg["agents"], ["claude", "codex"])
        # CSRF required.
        self.assertEqual(client.post("/agent/sessions", json={"agent": "claude"}).status_code, 403)
        spawned = client.post("/agent/sessions", json={"agent": "claude"},
                              headers={"x-csrf-token": csrf})
        self.assertEqual(spawned.status_code, 200)
        name = spawned.json()["name"]
        self.assertEqual([r["name"] for r in client.get("/agent/sessions").json()], [name])
        killed = client.request("DELETE", f"/agent/sessions/{name}",
                                headers={"x-csrf-token": csrf})
        self.assertEqual(killed.status_code, 204)
        self.assertEqual(sessions.killed, [name])

    def test_unknown_agent_rejected(self):
        client, _ = _client()
        csrf = client.post("/agent/login", json={"password": "pw"}).json()["csrf"]
        bad = client.post("/agent/sessions", json={"agent": "gemini"},
                          headers={"x-csrf-token": csrf})
        self.assertEqual(bad.status_code, 400)

    def test_malformed_login_body_is_4xx_not_500(self):
        client, _ = _client()
        r = client.post("/agent/login", content=b"not json",
                        headers={"content-type": "application/json"})
        self.assertEqual(r.status_code, 422)

    def test_safe_reads_require_auth(self):
        client, _ = _client()
        self.assertEqual(client.get("/agent/config").status_code, 401)
        self.assertEqual(client.get("/agent/sessions").status_code, 401)

    def test_delete_requires_csrf(self):
        client, _ = _client()
        client.post("/agent/login", json={"password": "pw"})
        r = client.request("DELETE", "/agent/sessions/folio-agent--claude--0123abcd")
        self.assertEqual(r.status_code, 403)


SEND_NAME = "folio-agent--claude--0123abcd"
SEND_URL = f"/agent/sessions/{SEND_NAME}/send"


def _send_client():
    client, sessions = _client()
    csrf = client.post("/agent/login", json={"password": "pw"}).json()["csrf"]
    sessions.active = [{"name": SEND_NAME, "agent": "claude", "created": 1, "attached": 0}]
    return client, sessions, csrf


class AgentSendRouteTest(unittest.TestCase):
    def test_send_pastes_text_into_session(self):
        client, sessions, csrf = _send_client()
        r = client.post(SEND_URL, json={"text": "a\r\nb"}, headers={"x-csrf-token": csrf})
        self.assertEqual(r.status_code, 204)
        self.assertEqual(sessions.sent, [(SEND_NAME, "a\nb")])

    def test_send_empty_text_just_presses_enter(self):
        client, sessions, csrf = _send_client()
        r = client.post(SEND_URL, json={}, headers={"x-csrf-token": csrf})
        self.assertEqual(r.status_code, 204)
        self.assertEqual(sessions.sent, [(SEND_NAME, "")])

    def test_send_requires_auth(self):
        client, sessions = _client()
        sessions.active = [{"name": SEND_NAME, "agent": "claude", "created": 1, "attached": 0}]
        r = client.post(SEND_URL, json={"text": "hi"})
        self.assertEqual(r.status_code, 401)
        self.assertEqual(sessions.sent, [])

    def test_send_requires_csrf(self):
        client, sessions, _csrf = _send_client()
        r = client.post(SEND_URL, json={"text": "hi"})
        self.assertEqual(r.status_code, 403)
        self.assertEqual(sessions.sent, [])

    def test_send_rejects_invalid_name(self):
        client, sessions, csrf = _send_client()
        for bad in ("not-a-session", "folio-agent--gemini--0123abcd"):
            r = client.post(f"/agent/sessions/{bad}/send", json={"text": "hi"},
                            headers={"x-csrf-token": csrf})
            self.assertEqual(r.status_code, 400, bad)
        self.assertEqual(sessions.sent, [])

    def test_send_unknown_session_is_404(self):
        client, sessions, csrf = _send_client()
        r = client.post("/agent/sessions/folio-agent--claude--deadbeef/send",
                        json={"text": "hi"}, headers={"x-csrf-token": csrf})
        self.assertEqual(r.status_code, 404)
        self.assertEqual(sessions.sent, [])

    def test_send_rejects_oversized_text(self):
        client, sessions, csrf = _send_client()
        # 32 KiB + 1 two-byte characters: under 64 KiB of characters, over in UTF-8.
        r = client.post(SEND_URL, json={"text": "é" * (32 * 1024 + 1)},
                        headers={"x-csrf-token": csrf})
        self.assertEqual(r.status_code, 413)
        self.assertEqual(sessions.sent, [])

    def test_send_accepts_text_at_the_limit(self):
        client, sessions, csrf = _send_client()
        r = client.post(SEND_URL, json={"text": "é" * (32 * 1024)},
                        headers={"x-csrf-token": csrf})
        self.assertEqual(r.status_code, 204)

    def test_send_rejects_request_over_1mib(self):
        # The test app sets no app-wide body limit: the cap comes solely from
        # the send route's own Content-Length check.
        client, sessions, csrf = _send_client()
        # Small text, big padding: only the request cap can reject this.
        r = client.post(SEND_URL, json={"text": "hi", "pad": "x" * (1024 * 1024 + 100)},
                        headers={"x-csrf-token": csrf})
        self.assertEqual(r.status_code, 413)
        self.assertEqual(sessions.sent, [])

    def test_send_rejects_chunked_request_over_1mib(self):
        client, sessions, csrf = _send_client()

        def chunks():
            # Small text, big padding: only the request cap can reject this.
            yield b'{"text": "hi", "pad": "'
            for _ in range(17):
                yield b"x" * 65536
            yield b'"}'

        r = client.post(SEND_URL, content=chunks(),
                        headers={"x-csrf-token": csrf, "content-type": "application/json"})
        self.assertNotIn("content-length", r.request.headers)
        self.assertEqual(r.status_code, 413)
        self.assertEqual(sessions.sent, [])

    def test_send_padded_request_under_1mib_is_accepted(self):
        client, sessions, csrf = _send_client()
        r = client.post(SEND_URL, json={"text": "hi", "pad": "x" * (512 * 1024)},
                        headers={"x-csrf-token": csrf})
        self.assertEqual(r.status_code, 204)
        self.assertEqual(sessions.sent, [(SEND_NAME, "hi")])

    def test_send_malformed_json_is_empty_text(self):
        client, sessions, csrf = _send_client()
        r = client.post(SEND_URL, content=b"not json",
                        headers={"x-csrf-token": csrf, "content-type": "application/json"})
        self.assertEqual(r.status_code, 204)
        self.assertEqual(sessions.sent, [(SEND_NAME, "")])

    def test_send_failures_are_500(self):
        for error in (
            subprocess.CalledProcessError(1, ["agent-send"]),
            subprocess.TimeoutExpired(["agent-send"], 10),
            OSError("missing"),
            ValueError("bad"),
        ):
            client, sessions, csrf = _send_client()
            sessions.send_error = error
            r = client.post(SEND_URL, json={"text": "hi"}, headers={"x-csrf-token": csrf})
            self.assertEqual(r.status_code, 500, repr(error))


if __name__ == "__main__":
    unittest.main()
