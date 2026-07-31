import os
import tempfile
import unittest

from fastapi.testclient import TestClient

from folio_backend.app import create_app
from folio_backend import openapi_dump


def _db():
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    return tmp.name


class StaticServeTest(unittest.TestCase):
    def test_serves_spa_when_static_dir_given(self):
        static = tempfile.mkdtemp()
        with open(os.path.join(static, "index.html"), "w") as fh:
            fh.write("<!doctype html><title>folio</title>")
        client = TestClient(create_app(_db(), static_dir=static))
        r = client.get("/folio/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("folio", r.text)

    def test_no_mount_without_static_dir(self):
        client = TestClient(create_app(_db()))
        self.assertEqual(client.get("/folio/").status_code, 404)

    def test_static_dir_defaults_to_env(self):
        static = tempfile.mkdtemp()
        with open(os.path.join(static, "index.html"), "w") as fh:
            fh.write("<!doctype html><title>envfolio</title>")
        os.environ["FOLIO_STATIC_DIR"] = static
        try:
            client = TestClient(create_app(_db()))
            self.assertEqual(client.get("/folio/").status_code, 200)
        finally:
            del os.environ["FOLIO_STATIC_DIR"]


class OpenApiDumpTest(unittest.TestCase):
    def test_dump_contains_paths(self):
        data = openapi_dump.dump()
        self.assertIn("/books", data["paths"])
        self.assertIn("delete", data["paths"]["/books/{book_id}"])


if __name__ == "__main__":
    unittest.main()
