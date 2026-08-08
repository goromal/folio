import os
import tempfile
import unittest

from fastapi.testclient import TestClient

from folio_backend import app as app_mod
from folio_backend.app import create_app


def _new_db():
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    return tmp.name


class HubSelfLeaseTest(unittest.TestCase):
    def setUp(self):
        os.environ["FOLIO_MACHINE"] = "ats"
        os.environ["FOLIO_IS_HUB"] = "true"
        self.client = TestClient(create_app(_new_db()))

    def tearDown(self):
        os.environ.pop("FOLIO_IS_HUB", None)
        os.environ.pop("FOLIO_MACHINE", None)

    def test_hub_self_lease_roundtrip(self):
        self.assertEqual(self.client.get("/lease").json(),
                         {"role": "hub", "held": False, "holder": None})
        self.assertEqual(self.client.post("/lease/acquire").json()["holder"], "ats")
        self.assertTrue(self.client.get("/lease").json()["held"])
        self.client.post("/lease/release")
        self.assertFalse(self.client.get("/lease").json()["held"])


class SpokeLeaseTest(unittest.TestCase):
    def setUp(self):
        os.environ["FOLIO_MACHINE"] = "ats"
        os.environ["FOLIO_IS_HUB"] = "true"
        self.hub = TestClient(create_app(_new_db()))
        os.environ["FOLIO_MACHINE"] = "dell"
        os.environ["FOLIO_IS_HUB"] = "false"
        os.environ["FOLIO_HUB_HOST"] = "ats.local"
        os.environ["FOLIO_HUB_PORT"] = "6869"
        self.spoke = TestClient(create_app(_new_db()))

        hub = self.hub

        class _Shim:
            @staticmethod
            def get(url, params=None, verify=True, timeout=None):
                return hub.get("/" + url.split("/", 3)[3], params=params)

            @staticmethod
            def post(url, json=None, params=None, files=None, verify=True, timeout=None):
                return hub.post("/" + url.split("/", 3)[3], json=json, params=params, files=files)

        self._orig = app_mod.httpx
        app_mod.httpx = _Shim

    def tearDown(self):
        app_mod.httpx = self._orig
        for k in ("FOLIO_IS_HUB", "FOLIO_MACHINE", "FOLIO_HUB_HOST", "FOLIO_HUB_PORT"):
            os.environ.pop(k, None)

    def test_acquire_pulls_db_and_marks_local_holder(self):
        r = self.spoke.post("/lease/acquire")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.spoke.get("/lease").json()["holder"], "dell")
        self.assertEqual(self.hub.get("/hub/lease").json()["holder"], "dell")

    def test_second_spoke_denied(self):
        self.hub.post("/hub/lease/acquire", json={"holder": "laptop"})
        self.assertEqual(self.spoke.post("/lease/acquire").status_code, 423)

    def test_release_writeback_frees_hub(self):
        self.spoke.post("/lease/acquire")
        self.spoke.post("/lease/release")
        self.assertIsNone(self.hub.get("/hub/lease").json()["holder"])
        self.assertIsNone(self.spoke.get("/lease").json()["holder"])

    def test_release_writeback_rollback_on_upload_failure(self):
        self.spoke.post("/lease/acquire")
        orig_post = app_mod.httpx.post

        def failing_post(url, **kw):
            if url.endswith("/hub/db"):
                raise RuntimeError("network down")
            return orig_post(url, **kw)

        app_mod.httpx.post = staticmethod(failing_post)
        try:
            with self.assertRaises(Exception):
                self.spoke.post("/lease/release")
        finally:
            app_mod.httpx.post = orig_post
        # Rollback: the spoke still holds locally, and the hub is unchanged.
        self.assertEqual(self.spoke.get("/lease").json()["holder"], "dell")
        self.assertEqual(self.hub.get("/hub/lease").json()["holder"], "dell")

    def test_release_discard_frees_without_upload(self):
        self.spoke.post("/lease/acquire")
        self.spoke.post("/lease/release", params={"discard": "true"})
        self.assertIsNone(self.hub.get("/hub/lease").json()["holder"])


if __name__ == "__main__":
    unittest.main()
