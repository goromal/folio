import os
import tempfile
import unittest

from fastapi.testclient import TestClient

from folio_backend.app import create_app
from tests.helpers import make_fixture_epub


class DeleteApiTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        tmp.close()
        self.client = TestClient(create_app(tmp.name))
        epub_path = os.path.join(tempfile.mkdtemp(), "f.epub")
        make_fixture_epub(epub_path)
        with open(epub_path, "rb") as fh:
            self.book = self.client.post(
                "/books", files={"file": ("f.epub", fh, "application/epub+zip")}
            ).json()
        self.book_id = self.book["id"]
        blocks = self.client.get(f"/books/{self.book_id}/blocks").json()
        b0 = blocks[0]["id"]
        self.passage = self.client.post("/passages", json={
            "book_id": self.book_id, "start_block": b0, "start_off": 0,
            "end_block": b0, "end_off": 3}).json()
        self.pid = self.passage["id"]

    def test_delete_highlight(self):
        hid = self.client.post(f"/passages/{self.pid}/highlights",
                               json={"color": "yellow"}).json()["id"]
        r = self.client.delete(f"/highlights/{hid}")
        self.assertEqual(r.status_code, 204)
        detail = self.client.get(f"/passages/{self.pid}").json()
        self.assertEqual(detail["highlights"], [])

    def test_delete_note(self):
        nid = self.client.post("/notes", json={
            "body": "n", "passage_id": self.pid}).json()["id"]
        r = self.client.delete(f"/notes/{nid}")
        self.assertEqual(r.status_code, 204)
        detail = self.client.get(f"/passages/{self.pid}").json()
        self.assertEqual(detail["notes"], [])

    def test_untag_passage(self):
        tag_id = self.client.post(f"/passages/{self.pid}/tags",
                                  json={"name": "kant"}).json()["tag_id"]
        r = self.client.delete(f"/passages/{self.pid}/tags/{tag_id}")
        self.assertEqual(r.status_code, 204)
        detail = self.client.get(f"/passages/{self.pid}").json()
        self.assertEqual(detail["tags"], [])

    def test_delete_link(self):
        blocks = self.client.get(f"/books/{self.book_id}/blocks").json()
        b1 = blocks[1]["id"]
        p2 = self.client.post("/passages", json={
            "book_id": self.book_id, "start_block": b1, "start_off": 0,
            "end_block": b1, "end_off": 3}).json()["id"]
        lid = self.client.post(f"/passages/{self.pid}/links",
                               json={"to_passage": p2}).json()["id"]
        r = self.client.delete(f"/links/{lid}")
        self.assertEqual(r.status_code, 204)
        self.assertEqual(self.client.get(f"/passages/{self.pid}/links").json(), [])

    def test_delete_summary(self):
        sid = self.client.post("/summaries", json={
            "scope": "book", "scope_id": self.book_id, "body": "s"}).json()["id"]
        r = self.client.delete(f"/summaries/{sid}")
        self.assertEqual(r.status_code, 204)
        self.assertEqual(
            self.client.get("/summaries",
                            params={"scope": "book", "scope_id": self.book_id}).json(),
            [])

    def test_delete_passage_cascades(self):
        self.client.post(f"/passages/{self.pid}/highlights", json={"color": "yellow"})
        r = self.client.delete(f"/passages/{self.pid}")
        self.assertEqual(r.status_code, 204)
        self.assertEqual(self.client.get(f"/passages/{self.pid}").status_code, 404)

    def test_delete_book_cascades(self):
        r = self.client.delete(f"/books/{self.book_id}")
        self.assertEqual(r.status_code, 204)
        self.assertEqual(self.client.get("/books").json(), [])
        self.assertEqual(self.client.get(f"/books/{self.book_id}/blocks").json(), [])


if __name__ == "__main__":
    unittest.main()
