import os
import tempfile
import unittest

from folio_backend import ingest, store
from tests.helpers import temp_db, make_fixture_epub


class LinksSummariesTest(unittest.TestCase):
    def setUp(self):
        self.conn, _ = temp_db()
        epub_path = os.path.join(tempfile.mkdtemp(), "f.epub")
        make_fixture_epub(epub_path)
        self.book_id = ingest.ingest_epub(self.conn, epub_path)
        blocks = self.conn.execute(
            "SELECT id FROM blocks WHERE book_id = ? ORDER BY order_idx",
            (self.book_id,)).fetchall()
        self.p1 = store.create_passage(self.conn, self.book_id,
                                       blocks[0]["id"], 0, blocks[0]["id"], 3)
        self.p2 = store.create_passage(self.conn, self.book_id,
                                       blocks[1]["id"], 0, blocks[1]["id"], 3)

    def test_link_passages(self):
        lid = store.link_passages(self.conn, self.p1, self.p2, note="related")
        links = store.get_links(self.conn, self.p1)
        self.assertEqual(len(links), 1)
        self.assertEqual(links[0]["to_passage"], self.p2)
        self.assertEqual(links[0]["note"], "related")
        self.assertEqual(links[0]["id"], lid)

    def test_link_is_bidirectional(self):
        lid = store.link_passages(self.conn, self.p1, self.p2)
        # the link surfaces from the target end too
        links = store.get_links(self.conn, self.p2)
        self.assertEqual([l["id"] for l in links], [lid])
        self.assertEqual(links[0]["from_passage"], self.p1)

    def test_summary_default_generated_by(self):
        sid = store.create_summary(self.conn, "book", self.book_id, "the gist")
        rows = store.get_summaries(self.conn, "book", self.book_id)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["generated_by"], "user")
        self.assertEqual(rows[0]["id"], sid)

    def test_summary_agent_generated(self):
        store.create_summary(self.conn, "chapter", 1, "auto", generated_by="agent")
        rows = store.get_summaries(self.conn, "chapter", 1)
        self.assertEqual(rows[0]["generated_by"], "agent")


if __name__ == "__main__":
    unittest.main()
