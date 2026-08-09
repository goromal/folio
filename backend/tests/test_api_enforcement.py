import os
import tempfile
import unittest

from fastapi.testclient import TestClient

from folio_backend.app import create_app

_ENV_KEYS = ("FOLIO_MACHINE", "FOLIO_IS_HUB", "FOLIO_HUB_HOST", "FOLIO_HUB_PORT")


def _client(env):
    for k in _ENV_KEYS:
        os.environ.pop(k, None)
    os.environ.update(env)
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    return TestClient(create_app(tmp.name))


class EnforcementTest(unittest.TestCase):
    def tearDown(self):
        for k in _ENV_KEYS:
            os.environ.pop(k, None)

    def test_writes_blocked_when_not_holder(self):
        # hub node, not self-leased -> holder NULL -> content write 423
        c = _client({"FOLIO_MACHINE": "ats", "FOLIO_IS_HUB": "true"})
        self.assertEqual(c.post("/notes", json={"body": "x", "book_id": 1}).status_code, 423)

    def test_writes_allowed_when_holder(self):
        c = _client({"FOLIO_MACHINE": "ats", "FOLIO_IS_HUB": "true"})
        c.post("/lease/acquire")  # self-lease on the hub -> holder = ats
        r = c.post("/notes", json={"body": "x", "book_id": 999})
        # not 423 means enforcement passed (400/404/201 all acceptable here)
        self.assertNotEqual(r.status_code, 423)

    def test_get_always_allowed(self):
        c = _client({"FOLIO_MACHINE": "ats", "FOLIO_IS_HUB": "true"})
        self.assertEqual(c.get("/books").status_code, 200)

    def test_position_and_focus_allowed_without_lease(self):
        c = _client({"FOLIO_MACHINE": "dell", "FOLIO_HUB_HOST": "ats.local"})
        self.assertNotEqual(
            c.put("/books/1/position", json={"chapter_id": None, "block_id": None}).status_code, 423)

    def test_lease_endpoints_allowed_without_lease(self):
        c = _client({"FOLIO_MACHINE": "ats", "FOLIO_IS_HUB": "true"})
        self.assertEqual(c.get("/lease").status_code, 200)
        self.assertNotEqual(c.post("/lease/acquire").status_code, 423)

    def test_stream_and_health_pass_through_under_enforcement(self):
        # Enforcement ON (hub), no lease held. Non-mutating requests must pass
        # straight through the raw-ASGI middleware untouched.
        c = _client({"FOLIO_MACHINE": "ats", "FOLIO_IS_HUB": "true"})
        self.assertEqual(c.get("/health").status_code, 200)
        self.assertEqual(c.get("/books").status_code, 200)

    def test_standalone_node_writable(self):
        # neither hub nor hubHost set -> enforcement disabled -> writes allowed
        c = _client({"FOLIO_MACHINE": "solo"})
        self.assertNotEqual(
            c.post("/notes", json={"body": "x", "book_id": 999}).status_code, 423)


if __name__ == "__main__":
    unittest.main()
