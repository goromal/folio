import json
import tempfile
import unittest

from werkzeug.security import generate_password_hash

from folio_backend.agent_auth import AgentAuth, load_secrets


def _secrets_file(password="pw"):
    tmp = tempfile.NamedTemporaryFile(suffix=".json", mode="w", delete=False)
    json.dump({"secret_key": "k", "password_hash": generate_password_hash(password)}, tmp)
    tmp.close()
    return tmp.name


class AgentAuthTest(unittest.TestCase):
    def test_load_and_password(self):
        key, pwhash = load_secrets(_secrets_file("hunter2"))
        auth = AgentAuth(key, pwhash)
        self.assertTrue(auth.check_password("hunter2"))
        self.assertFalse(auth.check_password("wrong"))
        self.assertFalse(auth.check_password(""))

    def test_cookie_roundtrip(self):
        key, pwhash = load_secrets(_secrets_file())
        auth = AgentAuth(key, pwhash)
        self.assertTrue(auth.is_authenticated(auth.cookie_value))
        self.assertFalse(auth.is_authenticated("nope"))
        self.assertFalse(auth.is_authenticated(""))

    def test_missing_keys_raise(self):
        tmp = tempfile.NamedTemporaryFile(suffix=".json", mode="w", delete=False)
        json.dump({"secret_key": "k"}, tmp)
        tmp.close()
        with self.assertRaises(ValueError):
            load_secrets(tmp.name)


if __name__ == "__main__":
    unittest.main()
