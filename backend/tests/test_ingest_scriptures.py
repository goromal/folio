import unittest

from folio_backend import ingest
from tests.helpers import temp_db


def _fixture_volume():
    return {
        "title": "Test Scriptures",
        "label": "Test Edition",
        "chapters": [
            {"title": "Alpha 1", "verses": [
                {"num": "1", "text": "In the beginning was the seedling."},
                {"num": "2", "text": "And the seedling grew."},
            ]},
            {"title": "Alpha 2", "verses": [
                {"num": "1", "text": "A second chapter about foxes."},
            ]},
        ],
    }


class IngestScripturesTest(unittest.TestCase):
    def setUp(self):
        self.conn, self._path = temp_db()

    def test_creates_book_chapters_blocks(self):
        book_id = ingest.ingest_scriptures(self.conn, _fixture_volume())
        book = self.conn.execute(
            "SELECT title, author FROM books WHERE id = ?", (book_id,)).fetchone()
        self.assertEqual(book["title"], "Test Scriptures")
        self.assertEqual(book["author"], "Test Edition")

        chapters = self.conn.execute(
            "SELECT title FROM chapters WHERE book_id = ? ORDER BY order_idx",
            (book_id,)).fetchall()
        self.assertEqual([c["title"] for c in chapters], ["Alpha 1", "Alpha 2"])

        blocks = self.conn.execute(
            "SELECT type, text, order_idx FROM blocks WHERE book_id = ? ORDER BY order_idx",
            (book_id,)).fetchall()
        self.assertEqual([b["order_idx"] for b in blocks], [0, 1, 2])
        self.assertTrue(all(b["type"] == "para" for b in blocks))
        self.assertEqual(blocks[0]["text"], "1 In the beginning was the seedling.")
        self.assertEqual(blocks[2]["text"], "1 A second chapter about foxes.")

    def test_is_idempotent(self):
        first = ingest.ingest_scriptures(self.conn, _fixture_volume())
        second = ingest.ingest_scriptures(self.conn, _fixture_volume())
        self.assertEqual(first, second)
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) c FROM books").fetchone()["c"], 1)
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) c FROM blocks").fetchone()["c"], 3)

    def test_distinct_volumes_are_separate_books(self):
        v = _fixture_volume()
        other = _fixture_volume(); other["title"] = "Other Scriptures"
        a = ingest.ingest_scriptures(self.conn, v)
        b = ingest.ingest_scriptures(self.conn, other)
        self.assertNotEqual(a, b)

    def test_verse_is_searchable_via_fts(self):
        book_id = ingest.ingest_scriptures(self.conn, _fixture_volume())
        rows = self.conn.execute(
            "SELECT b.id FROM blocks b JOIN blocks_fts f ON f.rowid = b.id "
            "WHERE b.book_id = ? AND blocks_fts MATCH ?", (book_id, "foxes")).fetchall()
        self.assertEqual(len(rows), 1)


if __name__ == "__main__":
    unittest.main()
