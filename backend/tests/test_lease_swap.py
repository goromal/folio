import os
import tempfile
import unittest

from folio_backend import lease
from tests.helpers import temp_db


class LeaseSwapTest(unittest.TestCase):
    def test_swap_database_replaces_contents(self):
        _, target = temp_db()
        conn_src, source = temp_db()
        lease.set_holder(conn_src, "dell")
        lease.swap_database(target, source)
        from folio_backend.db import connect
        self.assertEqual(connect(target).execute(
            "SELECT holder FROM lease WHERE id = 1").fetchone()["holder"], "dell")

    def test_snapshot_matches_and_leaves_origin(self):
        conn, path = temp_db()
        lease.set_holder(conn, "ats")
        snap = lease.snapshot_db(path)
        try:
            from folio_backend.db import connect
            self.assertEqual(connect(snap).execute(
                "SELECT holder FROM lease WHERE id = 1").fetchone()["holder"], "ats")
            self.assertEqual(connect(path).execute(
                "SELECT holder FROM lease WHERE id = 1").fetchone()["holder"], "ats")
        finally:
            os.unlink(snap)

    def test_validate_db_rejects_garbage(self):
        fd, junk = tempfile.mkstemp()
        os.write(fd, b"not a database")
        os.close(fd)
        try:
            with self.assertRaises(Exception):
                lease.validate_db(junk)
        finally:
            os.unlink(junk)

    def test_validate_db_accepts_real_db(self):
        _, path = temp_db()
        lease.validate_db(path)  # should not raise

    def test_resolve_host_identity_without_wormhole(self):
        self.assertEqual(lease.resolve_host("ats.local"), "ats.local")


if __name__ == "__main__":
    unittest.main()
