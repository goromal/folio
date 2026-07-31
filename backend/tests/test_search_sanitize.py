import os
import tempfile
import unittest

from folio_backend import ingest, search
from tests.helpers import temp_db, make_fixture_epub


class SearchSanitizeTest(unittest.TestCase):
    def setUp(self):
        self.conn, _ = temp_db()
        epub_path = os.path.join(tempfile.mkdtemp(), "f.epub")
        make_fixture_epub(epub_path)
        ingest.ingest_epub(self.conn, epub_path)

    def test_weird_inputs_do_not_raise(self):
        for raw in ['research:', 'foo"bar', 'C++', 'trailing AND', '*', '', '   ']:
            with self.subTest(raw=raw):
                hits = search.search_blocks(self.conn, raw)
                self.assertIsInstance(hits, list)

    def test_normal_term_still_matches(self):
        hits = search.search_blocks(self.conn, "fox")
        self.assertTrue(hits)


if __name__ == "__main__":
    unittest.main()
