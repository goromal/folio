"""Password auth for the Folio agent companion.

Mirrors agent_ui: a single shared password (werkzeug hash) plus an HMAC-derived
cookie/CSRF token from the same secret_key. The secrets file is provisioned as a
copy of agent_ui's, so the companion password matches Agent UI's.
"""
import hashlib
import hmac
import json
import os

from werkzeug.security import check_password_hash


def load_secrets(path):
    with open(os.path.expanduser(path), encoding="utf-8") as handle:
        data = json.load(handle)
    if not data.get("secret_key") or not data.get("password_hash"):
        raise ValueError(f"agent secrets file {path} missing secret_key/password_hash")
    return data["secret_key"].encode(), data["password_hash"]


class AgentAuth:
    def __init__(self, secret_key, password_hash):
        self.password_hash = password_hash
        self.csrf_token = hmac.new(secret_key, b"csrf", hashlib.sha256).hexdigest()
        self.cookie_value = hmac.new(
            secret_key, b"authenticated", hashlib.sha256
        ).hexdigest()

    def check_password(self, password):
        return bool(password) and check_password_hash(self.password_hash, password)

    def is_authenticated(self, cookie):
        return bool(cookie) and hmac.compare_digest(cookie, self.cookie_value)
