import os
import tempfile
import unittest

from fastapi.testclient import TestClient

from folio_backend.app import create_app
from tests.helpers import make_fixture_epub


class PositionApiTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False); tmp.close()
        self.client = TestClient(create_app(tmp.name))
        ep = os.path.join(tempfile.mkdtemp(), "f.epub"); make_fixture_epub(ep)
        with open(ep, "rb") as fh:
            self.bid = self.client.post(
                "/books", files={"file": ("f.epub", fh, "application/epub+zip")}).json()["id"]
        self.b0 = self.client.get(f"/books/{self.bid}/blocks").json()[0]

    def test_put_and_get_position(self):
        r = self.client.put(
            f"/books/{self.bid}/position",
            json={"chapter_id": self.b0["chapter_id"], "block_id": self.b0["id"]})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["block_id"], self.b0["id"])
        g = self.client.get(f"/books/{self.bid}/position").json()
        self.assertEqual(g["book_id"], self.bid)
        self.assertEqual(g["block_id"], self.b0["id"])

    def test_get_position_null_when_unset(self):
        self.assertIsNone(self.client.get(f"/books/{self.bid}/position").json())

    def test_put_bad_book_404(self):
        r = self.client.put("/books/999999/position", json={"block_id": 1})
        self.assertEqual(r.status_code, 404)

    def test_last_position(self):
        self.assertIsNone(self.client.get("/position").json())
        self.client.put(
            f"/books/{self.bid}/position",
            json={"chapter_id": self.b0["chapter_id"], "block_id": self.b0["id"]})
        last = self.client.get("/position").json()
        self.assertEqual(last["book_id"], self.bid)


if __name__ == "__main__":
    unittest.main()
