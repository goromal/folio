import os
import tempfile
import unittest

from fastapi.testclient import TestClient

from folio_backend.app import create_app
from tests.helpers import make_fixture_epub


class PassagesApiTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        tmp.close()
        self.client = TestClient(create_app(tmp.name))
        epub_path = os.path.join(tempfile.mkdtemp(), "f.epub")
        make_fixture_epub(epub_path)
        with open(epub_path, "rb") as fh:
            self.book_id = self.client.post(
                "/books",
                files={"file": ("f.epub", fh, "application/epub+zip")}).json()["id"]
        self.blocks = self.client.get(f"/books/{self.book_id}/blocks").json()
        self.b0 = self.blocks[0]["id"]

    def _make_passage(self):
        return self.client.post("/passages", json={
            "book_id": self.book_id,
            "start_block": self.b0, "start_off": 0,
            "end_block": self.b0, "end_off": 3,
        })

    def test_create_passage(self):
        r = self._make_passage()
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()["start_off"], 0)

    def test_attach_and_fetch(self):
        pid = self._make_passage().json()["id"]
        self.assertEqual(self.client.post(
            f"/passages/{pid}/highlights", json={"color": "green"}).status_code, 201)
        self.assertEqual(self.client.post(
            "/notes", json={"body": "note text", "passage_id": pid}).status_code, 201)
        self.assertEqual(self.client.post(
            f"/passages/{pid}/tags", json={"name": "theme"}).status_code, 201)

        detail = self.client.get(f"/passages/{pid}").json()
        self.assertEqual(detail["highlights"][0]["color"], "green")
        self.assertEqual(detail["notes"][0]["body"], "note text")
        self.assertEqual(detail["tags"][0]["name"], "theme")


if __name__ == "__main__":
    unittest.main()
