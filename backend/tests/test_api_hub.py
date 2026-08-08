import os
import tempfile
import unittest

from fastapi.testclient import TestClient

from folio_backend.app import create_app


def hub_client():
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    os.environ["FOLIO_MACHINE"] = "ats"
    os.environ["FOLIO_IS_HUB"] = "true"
    return TestClient(create_app(tmp.name)), tmp.name


class HubApiTest(unittest.TestCase):
    def setUp(self):
        self.client, self.path = hub_client()

    def tearDown(self):
        os.environ.pop("FOLIO_IS_HUB", None)
        os.environ.pop("FOLIO_MACHINE", None)

    def test_acquire_then_conflict(self):
        r = self.client.post("/hub/lease/acquire", json={"holder": "dell"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["holder"], "dell")
        r2 = self.client.post("/hub/lease/acquire", json={"holder": "laptop"})
        self.assertEqual(r2.status_code, 423)
        self.assertEqual(r2.json()["detail"]["holder"], "dell")

    def test_status_and_release(self):
        self.client.post("/hub/lease/acquire", json={"holder": "dell"})
        self.assertEqual(self.client.get("/hub/lease").json()["holder"], "dell")
        self.client.post("/hub/lease/release", json={"holder": "dell"})
        self.assertIsNone(self.client.get("/hub/lease").json()["holder"])

    def test_steal(self):
        self.client.post("/hub/lease/acquire", json={"holder": "dell"})
        self.client.post("/hub/lease/steal", json={"holder": "laptop"})
        self.assertEqual(self.client.get("/hub/lease").json()["holder"], "laptop")

    def test_db_download_requires_holder(self):
        self.client.post("/hub/lease/acquire", json={"holder": "dell"})
        self.assertEqual(self.client.get("/hub/db", params={"holder": "laptop"}).status_code, 423)
        ok = self.client.get("/hub/db", params={"holder": "dell"})
        self.assertEqual(ok.status_code, 200)
        self.assertTrue(ok.content[:16].startswith(b"SQLite format 3"))

    def test_db_upload_replaces(self):
        self.client.post("/hub/lease/acquire", json={"holder": "dell"})
        snapshot = self.client.get("/hub/db", params={"holder": "dell"}).content
        r = self.client.post("/hub/db", params={"holder": "dell"},
                             files={"file": ("folio.db", snapshot, "application/octet-stream")})
        self.assertEqual(r.status_code, 200)

    def test_db_upload_wrong_holder_rejected(self):
        self.client.post("/hub/lease/acquire", json={"holder": "dell"})
        snapshot = self.client.get("/hub/db", params={"holder": "dell"}).content
        r = self.client.post("/hub/db", params={"holder": "laptop"},
                             files={"file": ("folio.db", snapshot, "application/octet-stream")})
        self.assertEqual(r.status_code, 423)

    def test_db_upload_garbage_rejected(self):
        self.client.post("/hub/lease/acquire", json={"holder": "dell"})
        r = self.client.post("/hub/db", params={"holder": "dell"},
                             files={"file": ("folio.db", b"not a database", "application/octet-stream")})
        self.assertEqual(r.status_code, 400)

    def test_hub_routes_absent_when_not_hub(self):
        os.environ.pop("FOLIO_IS_HUB", None)
        tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        tmp.close()
        c = TestClient(create_app(tmp.name))
        self.assertEqual(c.get("/hub/lease").status_code, 404)


if __name__ == "__main__":
    unittest.main()
