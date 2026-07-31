import unittest

from tests.helpers import temp_db

EXPECTED_TABLES = {
    "books", "chapters", "blocks", "blocks_fts",
    "passages", "highlights", "notes", "tags",
    "passage_tags", "passage_links", "summaries",
}


class SchemaTest(unittest.TestCase):
    def setUp(self):
        self.conn, self._path = temp_db()

    def test_all_tables_exist(self):
        rows = self.conn.execute(
            "SELECT name FROM sqlite_master WHERE type IN ('table')"
        ).fetchall()
        names = {r["name"] for r in rows}
        self.assertTrue(EXPECTED_TABLES.issubset(names),
                        f"missing: {EXPECTED_TABLES - names}")

    def test_fts_trigger_populates_on_insert(self):
        self.conn.execute(
            "INSERT INTO books (title, source_hash, created_at) VALUES (?,?,?)",
            ("B", "h1", "2026-01-01T00:00:00Z"))
        self.conn.execute(
            "INSERT INTO blocks (book_id, chapter_id, order_idx, type, text) "
            "VALUES (1, NULL, 0, 'para', 'hello searchable world')")
        self.conn.commit()
        hit = self.conn.execute(
            "SELECT rowid FROM blocks_fts WHERE blocks_fts MATCH 'searchable'"
        ).fetchone()
        self.assertIsNotNone(hit)

    def test_foreign_keys_enabled(self):
        fk = self.conn.execute("PRAGMA foreign_keys").fetchone()[0]
        self.assertEqual(fk, 1)


if __name__ == "__main__":
    unittest.main()
