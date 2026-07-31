import os
import tempfile
import unittest

from fastapi.testclient import TestClient

from folio_backend.app import create_app
from tests.helpers import make_fixture_epub


class ListsApiTest(unittest.TestCase):
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
        self.toc = self.client.get(f"/books/{self.book_id}/toc").json()
        self.ch1 = self.toc[0]["id"]
        blocks = self.client.get(f"/books/{self.book_id}/blocks").json()
        self.pid = self.client.post("/passages", json={
            "book_id": self.book_id, "start_block": blocks[0]["id"], "start_off": 0,
            "end_block": blocks[0]["id"], "end_off": 3}).json()["id"]
        self.client.post(f"/passages/{self.pid}/highlights", json={"color": "green"})
        self.client.post(f"/passages/{self.pid}/tags", json={"name": "theme"})
        self.client.post("/notes", json={"body": "passage note", "passage_id": self.pid})
        self.client.post("/notes", json={"body": "book note", "book_id": self.book_id})
        self.client.post("/notes", json={"body": "chapter note", "chapter_id": self.ch1})
        self.client.post("/summaries", json={
            "scope": "book", "scope_id": self.book_id, "body": "book gist"})
        self.client.post("/summaries", json={
            "scope": "chapter", "scope_id": self.ch1, "body": "ch1 gist"})

    def test_list_notes(self):
        notes = self.client.get(f"/books/{self.book_id}/notes").json()
        bodies = {n["body"] for n in notes}
        self.assertEqual(bodies, {"passage note", "book note", "chapter note"})

    def test_list_notes_chapter_scoped(self):
        notes = self.client.get(
            f"/books/{self.book_id}/notes", params={"chapter_id": self.ch1}).json()
        self.assertEqual([n["body"] for n in notes], ["chapter note"])

    def test_list_passages(self):
        passages = self.client.get(f"/books/{self.book_id}/passages").json()
        self.assertEqual(len(passages), 1)
        p = passages[0]
        self.assertEqual(p["highlights"][0]["color"], "green")
        self.assertEqual(p["tags"][0]["name"], "theme")
        self.assertEqual(p["notes"][0]["body"], "passage note")

    def test_list_summaries(self):
        summaries = self.client.get(f"/books/{self.book_id}/summaries").json()
        bodies = {s["body"] for s in summaries}
        self.assertEqual(bodies, {"book gist", "ch1 gist"})


if __name__ == "__main__":
    unittest.main()
