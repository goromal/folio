import os
import tempfile
import unittest

from folio_backend import ingest, store
from tests.helpers import temp_db, make_fixture_epub


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.conn, _ = temp_db()
        epub_path = os.path.join(tempfile.mkdtemp(), "f.epub")
        make_fixture_epub(epub_path)
        self.book_id = ingest.ingest_epub(self.conn, epub_path)
        blocks = self.conn.execute(
            "SELECT id FROM blocks WHERE book_id = ? ORDER BY order_idx",
            (self.book_id,)).fetchall()
        self.b0, self.b1 = blocks[0]["id"], blocks[1]["id"]

    def test_passage_roundtrip(self):
        pid = store.create_passage(self.conn, self.book_id,
                                   self.b0, 0, self.b1, 5)
        p = store.get_passage(self.conn, pid)
        self.assertEqual(p["start_block"], self.b0)
        self.assertEqual(p["end_off"], 5)

    def test_highlight(self):
        pid = store.create_passage(self.conn, self.book_id, self.b0, 0, self.b0, 3)
        hid = store.add_highlight(self.conn, pid, color="green")
        row = self.conn.execute(
            "SELECT color FROM highlights WHERE id = ?", (hid,)).fetchone()
        self.assertEqual(row["color"], "green")

    def test_note_scope_and_update(self):
        pid = store.create_passage(self.conn, self.book_id, self.b0, 0, self.b0, 3)
        nid = store.add_note(self.conn, "first", passage_id=pid)
        before = self.conn.execute(
            "SELECT updated_at FROM notes WHERE id = ?", (nid,)).fetchone()["updated_at"]
        store.update_note(self.conn, nid, "second")
        after = self.conn.execute(
            "SELECT body, updated_at FROM notes WHERE id = ?", (nid,)).fetchone()
        self.assertEqual(after["body"], "second")
        self.assertGreaterEqual(after["updated_at"], before)

    def test_note_requires_exactly_one_scope(self):
        import sqlite3
        with self.assertRaises(sqlite3.IntegrityError):
            store.add_note(self.conn, "bad",
                           passage_id=None, chapter_id=None, book_id=None)

    def test_tags_get_or_create_and_associate(self):
        pid = store.create_passage(self.conn, self.book_id, self.b0, 0, self.b0, 3)
        t1 = store.add_tag(self.conn, "theme")
        t2 = store.add_tag(self.conn, "theme")
        self.assertEqual(t1, t2)  # get-or-create
        store.tag_passage(self.conn, pid, t1)
        names = [t["name"] for t in store.get_passage_tags(self.conn, pid)]
        self.assertEqual(names, ["theme"])


if __name__ == "__main__":
    unittest.main()
