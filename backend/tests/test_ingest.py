import os
import tempfile
import unittest

from folio_backend import ingest
from tests.helpers import temp_db, make_fixture_epub


class IngestTest(unittest.TestCase):
    def setUp(self):
        self.conn, self._path = temp_db()
        self._epub = os.path.join(tempfile.mkdtemp(), "fixture.epub")
        make_fixture_epub(self._epub)

    def test_ingest_creates_book_chapters_blocks(self):
        book_id = ingest.ingest_epub(self.conn, self._epub)
        book = self.conn.execute(
            "SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()
        self.assertEqual(book["title"], "Test Book")
        self.assertEqual(book["author"], "Test Author")

        chapters = self.conn.execute(
            "SELECT title FROM chapters WHERE book_id = ? ORDER BY order_idx",
            (book_id,)).fetchall()
        self.assertEqual([c["title"] for c in chapters],
                         ["Chapter One", "Chapter Two"])

        blocks = self.conn.execute(
            "SELECT type, text FROM blocks WHERE book_id = ? ORDER BY order_idx",
            (book_id,)).fetchall()
        texts = [b["text"] for b in blocks]
        self.assertIn("The quick brown fox.", texts)
        self.assertIn("Jumps over the lazy dog.", texts)
        self.assertTrue(all(b["type"] in {"para", "heading", "list", "quote"}
                            for b in blocks))

    def test_ingest_is_idempotent(self):
        first = ingest.ingest_epub(self.conn, self._epub)
        second = ingest.ingest_epub(self.conn, self._epub)
        self.assertEqual(first, second)
        count = self.conn.execute("SELECT COUNT(*) c FROM books").fetchone()["c"]
        self.assertEqual(count, 1)


if __name__ == "__main__":
    unittest.main()
