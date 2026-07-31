import os
import tempfile
import unittest

from fastapi.testclient import TestClient

from folio_backend.app import create_app
from tests.helpers import make_fixture_epub


class BlocksApiTest(unittest.TestCase):
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

    def test_block_ranges(self):
        r = self.client.get(f"/books/{self.book_id}/blocks")
        self.assertEqual(r.status_code, 200)
        blocks = r.json()
        self.assertTrue(len(blocks) >= 3)
        order = [b["order_idx"] for b in blocks]
        self.assertEqual(order, sorted(order))

    def test_block_search(self):
        r = self.client.get(f"/books/{self.book_id}/blocks/search", params={"q": "fox"})
        self.assertEqual(r.status_code, 200)
        hits = r.json()
        self.assertTrue(hits)
        self.assertIn("snippet", hits[0])
        self.assertTrue(all(h["book_id"] == self.book_id for h in hits))


if __name__ == "__main__":
    unittest.main()
