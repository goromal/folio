import json
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


if __name__ == "__main__":
    unittest.main()
