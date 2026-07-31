import os
import tempfile
import unittest

from fastapi.testclient import TestClient

from folio_backend.app import create_app
from tests.helpers import make_fixture_epub


class LinksSummariesApiTest(unittest.TestCase):
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
        blocks = self.client.get(f"/books/{self.book_id}/blocks").json()
        self.p1 = self._passage(blocks[0]["id"])
        self.p2 = self._passage(blocks[1]["id"])

    def _passage(self, block_id):
        return self.client.post("/passages", json={
            "book_id": self.book_id, "start_block": block_id, "start_off": 0,
            "end_block": block_id, "end_off": 3}).json()["id"]

    def test_links(self):
        r = self.client.post(f"/passages/{self.p1}/links",
                             json={"to_passage": self.p2, "note": "cf."})
        self.assertEqual(r.status_code, 201)
        listing = self.client.get(f"/passages/{self.p1}/links").json()
        self.assertEqual(listing[0]["to_passage"], self.p2)

    def test_summaries(self):
        r = self.client.post("/summaries", json={
            "scope": "book", "scope_id": self.book_id, "body": "the gist"})
        self.assertEqual(r.status_code, 201)
        listing = self.client.get(
            "/summaries", params={"scope": "book", "scope_id": self.book_id}).json()
        self.assertEqual(listing[0]["body"], "the gist")
        self.assertEqual(listing[0]["generated_by"], "user")


if __name__ == "__main__":
    unittest.main()
