import tempfile
import unittest

from folio_backend import import_scriptures
from tests.helpers import temp_db
from tests.test_scriptures_source import _write_sample  # reuse the sample fixtures


class ImportScripturesCliTest(unittest.TestCase):
    def setUp(self):
        self.conn, self.db_path = temp_db()
        self.conn.close()  # CLI opens its own connection
        self.data = tempfile.mkdtemp()
        _write_sample(self.data)

    def _books(self):
        from folio_backend import db
        c = db.connect(self.db_path)
        try:
            return [dict(r) for r in c.execute(
                "SELECT title FROM books ORDER BY id").fetchall()]
        finally:
            c.close()

    def test_imports_selected_volumes(self):
        rc = import_scriptures.main(["--data", self.data, "--db", self.db_path,
                                     "--volumes", "bom,dc"])
        self.assertEqual(rc, 0)
        titles = [b["title"] for b in self._books()]
        self.assertEqual(titles, ["The Book of Mormon", "The Doctrine and Covenants"])

    def test_rerun_is_idempotent(self):
        import_scriptures.main(["--data", self.data, "--db", self.db_path])
        import_scriptures.main(["--data", self.data, "--db", self.db_path])
        self.assertEqual(len(self._books()), 4)

    def test_unknown_volume_errors(self):
        with self.assertRaises(SystemExit) as ctx:
            import_scriptures.main(["--data", self.data, "--db", self.db_path,
                                    "--volumes", "bogus"])
        self.assertNotEqual(ctx.exception.code, 0)


if __name__ == "__main__":
    unittest.main()
