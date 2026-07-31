import os
import tempfile
import unittest

from fastapi.testclient import TestClient

from folio_backend.app import create_app
from tests.helpers import make_fixture_epub


class BooksApiTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        tmp.close()
        self.client = TestClient(create_app(tmp.name))
        self.epub_path = os.path.join(tempfile.mkdtemp(), "f.epub")
        make_fixture_epub(self.epub_path)

    def _upload(self):
        with open(self.epub_path, "rb") as fh:
            return self.client.post(
                "/books",
                files={"file": ("f.epub", fh, "application/epub+zip")})

    def test_health(self):
        r = self.client.get("/health")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"status": "ok"})

    def test_upload_and_list(self):
        r = self._upload()
        self.assertEqual(r.status_code, 201)
        body = r.json()
        self.assertEqual(body["title"], "Test Book")
        self.assertEqual(body["author"], "Test Author")

        r2 = self.client.get("/books")
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(len(r2.json()), 1)

    def test_toc(self):
        book_id = self._upload().json()["id"]
        r = self.client.get(f"/books/{book_id}/toc")
        self.assertEqual(r.status_code, 200)
        titles = [c["title"] for c in r.json()]
        self.assertEqual(titles, ["Chapter One", "Chapter Two"])


if __name__ == "__main__":
    unittest.main()
