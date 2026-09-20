import unittest

from fastapi.testclient import TestClient

from folio_backend import store
from folio_backend.app import create_app
from tests.helpers import temp_db


class NotesPageEnrichmentTest(unittest.TestCase):
    def setUp(self):
        self.conn, self.db_path = temp_db()
        self.conn.execute("INSERT INTO books (title, source_hash, created_at) VALUES ('B','h','t')")
        self.book = self.conn.execute("SELECT id FROM books").fetchone()["id"]
        self.conn.execute(
            "INSERT INTO chapters (book_id, title, order_idx) VALUES (?,?,0)", (self.book, "Ch1"))
        self.chap = self.conn.execute("SELECT id FROM chapters").fetchone()["id"]
        self.conn.execute(
            "INSERT INTO blocks (book_id, chapter_id, order_idx, type, text) VALUES (?,?,0,'para',?)",
            (self.book, self.chap, "Hello world, this is the passage text."))
        self.block = self.conn.execute("SELECT id FROM blocks").fetchone()["id"]
        self.conn.commit()
        p1 = store.create_passage(self.conn, self.book, self.block, 0, self.block, 20000)
        p2 = store.create_passage(self.conn, self.book, self.block, 0, self.block, 20000)
        store.link_passages(self.conn, p1, p2, note="rel")
        self.p1 = p1
        self.client = TestClient(create_app(self.db_path))

    def test_passages_enriched(self):
        rows = self.client.get(f"/books/{self.book}/passages").json()
        row = next(r for r in rows if r["id"] == self.p1)
        self.assertTrue(row["preview"].startswith("Hello world"))
        self.assertLessEqual(len(row["preview"]), 200)
        self.assertEqual(row["chapter_id"], self.chap)
        self.assertEqual(row["link_count"], 1)

    def test_toc_has_first_block(self):
        toc = self.client.get(f"/books/{self.book}/toc").json()
        self.assertEqual(toc[0]["first_block_id"], self.block)


if __name__ == "__main__":
    unittest.main()
