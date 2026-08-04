import unittest

from folio_backend import store
from tests.helpers import temp_db


def _seed_book(conn, title="Bk"):
    now = "2026-01-01T00:00:00+00:00"
    bid = conn.execute(
        "INSERT INTO books (title, author, source_hash, created_at) VALUES (?,?,?,?)",
        (title, None, f"hash-{title}", now)).lastrowid
    cid = conn.execute(
        "INSERT INTO chapters (book_id, title, order_idx) VALUES (?,?,?)",
        (bid, "Ch1", 0)).lastrowid
    blk = conn.execute(
        "INSERT INTO blocks (book_id, chapter_id, order_idx, type, text) VALUES (?,?,?,?,?)",
        (bid, cid, 0, "para", "hello")).lastrowid
    conn.commit()
    return bid, cid, blk


class PositionStoreTest(unittest.TestCase):
    def setUp(self):
        self.conn, _ = temp_db()

    def test_save_then_get(self):
        bid, cid, blk = _seed_book(self.conn)
        store.save_position(self.conn, bid, cid, blk)
        row = store.get_position(self.conn, bid)
        self.assertEqual(row["book_id"], bid)
        self.assertEqual(row["chapter_id"], cid)
        self.assertEqual(row["block_id"], blk)
        self.assertTrue(row["updated_at"])

    def test_get_missing_returns_none(self):
        bid, _, _ = _seed_book(self.conn)
        self.assertIsNone(store.get_position(self.conn, bid))

    def test_upsert_replaces(self):
        bid, cid, blk = _seed_book(self.conn)
        blk2 = self.conn.execute(
            "INSERT INTO blocks (book_id, chapter_id, order_idx, type, text) "
            "VALUES (?,?,?,?,?)", (bid, cid, 1, "para", "world")).lastrowid
        self.conn.commit()
        store.save_position(self.conn, bid, cid, blk)
        store.save_position(self.conn, bid, cid, blk2)
        rows = self.conn.execute(
            "SELECT * FROM reading_position WHERE book_id = ?", (bid,)).fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["block_id"], blk2)

    def test_last_position_is_most_recent(self):
        b1, c1, k1 = _seed_book(self.conn, "One")
        b2, c2, k2 = _seed_book(self.conn, "Two")
        store.save_position(self.conn, b1, c1, k1)
        store.save_position(self.conn, b2, c2, k2)
        self.conn.execute(
            "UPDATE reading_position SET updated_at = ? WHERE book_id = ?",
            ("2999-01-01T00:00:00+00:00", b1))
        self.conn.commit()
        self.assertEqual(store.get_last_position(self.conn)["book_id"], b1)

    def test_last_position_none_when_empty(self):
        self.assertIsNone(store.get_last_position(self.conn))

    def test_delete_book_cascades_position(self):
        bid, cid, blk = _seed_book(self.conn)
        store.save_position(self.conn, bid, cid, blk)
        store.delete_book(self.conn, bid)
        self.assertIsNone(store.get_position(self.conn, bid))


if __name__ == "__main__":
    unittest.main()
