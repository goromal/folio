import os
import tempfile
import unittest

from fastapi.testclient import TestClient

from folio_backend.app import create_app
from tests.helpers import make_fixture_epub


class ShelvesApiTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        tmp.close()
        self.client = TestClient(create_app(tmp.name))
        epub_path = os.path.join(tempfile.mkdtemp(), "f.epub")
        make_fixture_epub(epub_path)
        with open(epub_path, "rb") as fh:
            self.book_id = self.client.post(
                "/books", files={"file": ("f.epub", fh, "application/epub+zip")}).json()["id"]

    def _shelf(self, name):
        r = self.client.post("/shelves", json={"name": name})
        self.assertEqual(r.status_code, 201)
        return r.json()

    def test_books_carry_library_metadata(self):
        b = self.client.get("/books").json()[0]
        self.assertEqual(b["shelf_ids"], [])
        self.assertIsNotNone(b["created_at"])
        self.assertIsNone(b["last_read_at"])
        self.client.put(f"/books/{self.book_id}/position", json={})
        self.assertIsNotNone(self.client.get("/books").json()[0]["last_read_at"])

    def test_create_list_sorted_with_counts(self):
        self._shelf("Philosophy")
        s = self._shelf("  ancient  ")
        self.assertEqual(s, {"id": s["id"], "name": "ancient", "book_count": 0})
        names = [x["name"] for x in self.client.get("/shelves").json()]
        self.assertEqual(names, ["ancient", "Philosophy"])

    def test_duplicate_and_empty_names_rejected(self):
        self._shelf("Fiction")
        self.assertEqual(self.client.post("/shelves", json={"name": "fiction"}).status_code, 409)
        self.assertEqual(self.client.post("/shelves", json={"name": "  "}).status_code, 422)

    def test_assign_book_to_shelves(self):
        a, b = self._shelf("A"), self._shelf("B")
        r = self.client.put(f"/books/{self.book_id}/shelves",
                            json={"shelf_ids": [b["id"], a["id"], a["id"]]})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(sorted(r.json()["shelf_ids"]), sorted([a["id"], b["id"]]))
        counts = {x["name"]: x["book_count"] for x in self.client.get("/shelves").json()}
        self.assertEqual(counts, {"A": 1, "B": 1})
        r = self.client.put(f"/books/{self.book_id}/shelves", json={"shelf_ids": [b["id"]]})
        self.assertEqual(r.json()["shelf_ids"], [b["id"]])

    def test_assign_unknown_shelf_or_book_404_and_keeps_state(self):
        a = self._shelf("A")
        self.client.put(f"/books/{self.book_id}/shelves", json={"shelf_ids": [a["id"]]})
        r = self.client.put(f"/books/{self.book_id}/shelves", json={"shelf_ids": [999]})
        self.assertEqual(r.status_code, 404)
        self.assertEqual(self.client.get("/books").json()[0]["shelf_ids"], [a["id"]])
        self.assertEqual(
            self.client.put("/books/999/shelves", json={"shelf_ids": []}).status_code, 404)

    def test_rename(self):
        a, _ = self._shelf("A"), self._shelf("B")
        r = self.client.put(f"/shelves/{a['id']}", json={"name": "Z"})
        self.assertEqual(r.json()["name"], "Z")
        self.assertEqual(self.client.put(f"/shelves/{a['id']}", json={"name": "b"}).status_code, 409)
        self.assertEqual(self.client.put("/shelves/999", json={"name": "Q"}).status_code, 404)

    def test_delete_shelf_keeps_books(self):
        a = self._shelf("A")
        self.client.put(f"/books/{self.book_id}/shelves", json={"shelf_ids": [a["id"]]})
        self.assertEqual(self.client.delete(f"/shelves/{a['id']}").status_code, 204)
        self.assertEqual(self.client.get("/shelves").json(), [])
        self.assertEqual(self.client.get("/books").json()[0]["shelf_ids"], [])

    def test_delete_book_drops_memberships(self):
        a = self._shelf("A")
        self.client.put(f"/books/{self.book_id}/shelves", json={"shelf_ids": [a["id"]]})
        self.client.delete(f"/books/{self.book_id}")
        self.assertEqual(self.client.get("/shelves").json()[0]["book_count"], 0)


if __name__ == "__main__":
    unittest.main()
