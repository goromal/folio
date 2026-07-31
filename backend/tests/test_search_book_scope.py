import os
import tempfile
import unittest
from datetime import datetime, timezone

from folio_backend import ingest, search
from tests.helpers import temp_db, make_fixture_epub


class SearchBookScopeTest(unittest.TestCase):
    def setUp(self):
        self.conn, _ = temp_db()
        epub_path = os.path.join(tempfile.mkdtemp(), "f.epub")
        make_fixture_epub(epub_path)
        self.book1_id = ingest.ingest_epub(self.conn, epub_path)

        now = datetime.now(timezone.utc).isoformat()
        cur = self.conn.execute(
            "INSERT INTO books (title, author, source_hash, created_at) "
            "VALUES (?,?,?,?)",
            ("Other Book", "Other Author", "other-hash", now))
        self.book2_id = cur.lastrowid

        # Insert the second book's fox-matching block FIRST so that a
        # global (unscoped) LIMIT 1 by rank/insertion would surface it
        # ahead of book1's blocks, proving the scoping actually applies
        # the book filter before LIMIT rather than after.
        self.conn.execute(
            "INSERT INTO chapters (book_id, title, order_idx, parent_id) "
            "VALUES (?,?,?,NULL)", (self.book2_id, "Only Chapter", 0))
        chapter2_id = self.conn.execute(
            "SELECT id FROM chapters WHERE book_id = ?",
            (self.book2_id,)).fetchone()["id"]
        self.conn.execute(
            "INSERT INTO blocks (book_id, chapter_id, order_idx, type, text) "
            "VALUES (?,?,?,?,?)",
            (self.book2_id, chapter2_id, 0, "para", "A fox in book two."))
        self.conn.commit()

    def test_book_scoped_search_excludes_other_books(self):
        hits = search.search_blocks(self.conn, "fox", limit=1, book_id=self.book1_id)
        self.assertTrue(hits)
        self.assertTrue(all(h["book_id"] == self.book1_id for h in hits))


if __name__ == "__main__":
    unittest.main()
