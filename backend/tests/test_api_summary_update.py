import unittest

from fastapi.testclient import TestClient

from folio_backend.app import create_app
from tests.helpers import temp_db


class SummaryUpdateApiTest(unittest.TestCase):
    def setUp(self):
        self.conn, self.db_path = temp_db()
        self.client = TestClient(create_app(self.db_path))

    def _rows(self, scope, scope_id):
        return self.client.get(f"/summaries?scope={scope}&scope_id={scope_id}").json()

    def test_put_updates_body_in_place(self):
        sid = self.client.post(
            "/summaries", json={"scope": "book", "scope_id": 1, "body": "first"}
        ).json()["id"]
        r = self.client.put(f"/summaries/{sid}", json={"body": "second"})
        self.assertEqual(r.status_code, 200)
        rows = self._rows("book", 1)
        self.assertEqual([row["id"] for row in rows], [sid])
        self.assertEqual(rows[0]["body"], "second")
        self.assertEqual(rows[0]["generated_by"], "user")

    def test_put_relabels_agent_to_user(self):
        sid = self.client.post(
            "/summaries",
            json={"scope": "book", "scope_id": 1, "body": "a", "generated_by": "agent"},
        ).json()["id"]
        self.client.put(f"/summaries/{sid}", json={"body": "edited", "generated_by": "user"})
        rows = self._rows("book", 1)
        self.assertEqual(rows[0]["generated_by"], "user")
        self.assertEqual(rows[0]["body"], "edited")


if __name__ == "__main__":
    unittest.main()
