import os
import tempfile
import unittest

from folio_backend import ingest, search
from tests.helpers import temp_db, make_fixture_epub


class SearchTest(unittest.TestCase):
    def setUp(self):
        self.conn, _ = temp_db()
        epub_path = os.path.join(tempfile.mkdtemp(), "f.epub")
        make_fixture_epub(epub_path)
        ingest.ingest_epub(self.conn, epub_path)

    def test_search_returns_hits(self):
        hits = search.search_blocks(self.conn, "fox")
        self.assertTrue(hits)
        first = hits[0]
        self.assertIn("block_id", first)
        self.assertIn("book_id", first)
        self.assertIn("chapter_id", first)
        self.assertIn("snippet", first)

    def test_search_scoped_term(self):
        hits = search.search_blocks(self.conn, "lazy")
        texts = [
            self.conn.execute("SELECT text FROM blocks WHERE id = ?",
                              (h["block_id"],)).fetchone()["text"]
            for h in hits
        ]
        self.assertTrue(all("lazy" in t for t in texts))

    def test_search_no_match(self):
        self.assertEqual(search.search_blocks(self.conn, "unicorn"), [])


if __name__ == "__main__":
    unittest.main()
