import json
import os
import tempfile
import unittest

from fastapi.testclient import TestClient
from werkzeug.security import generate_password_hash

from folio_backend.app import create_app
from tests.helpers import temp_db


class TerminalProxyWiringTest(unittest.TestCase):
    def setUp(self):
        self._env = dict(os.environ)
        _, self.db_path = temp_db()
        self.static = tempfile.mkdtemp()
        with open(os.path.join(self.static, "index.html"), "w") as fh:
            fh.write("<!doctype html>SPA")
        secrets = os.path.join(tempfile.mkdtemp(), "secrets.json")
        with open(secrets, "w") as fh:
            json.dump({"secret_key": "k" * 32,
                       "password_hash": generate_password_hash("pw")}, fh)
        os.environ["FOLIO_AGENTS"] = "claude"
        os.environ["FOLIO_AGENT_SECRETS"] = secrets
        os.environ["FOLIO_AGENT_TERMINAL_ORIGIN"] = "http://127.0.0.1:6870"
        os.environ["FOLIO_AGENT_SPOOL"] = tempfile.mkdtemp()

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._env)

    def test_proxy_precedes_static_mount(self):
        app = create_app(self.db_path, static_dir=self.static)
        client = TestClient(app)
        r = client.get("/folio/agent/terminal/somepath")
        self.assertEqual(r.status_code, 401)

    def test_static_still_served(self):
        app = create_app(self.db_path, static_dir=self.static)
        client = TestClient(app)
        r = client.get("/folio/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("SPA", r.text)


if __name__ == "__main__":
    unittest.main()
