import unittest

from folio_backend import lease
from tests.helpers import temp_db


class LeaseStoreTest(unittest.TestCase):
    def setUp(self):
        self.conn, self.path = temp_db()

    def test_fresh_db_is_free(self):
        self.assertEqual(lease.get_holder(self.conn)["holder"], None)

    def test_acquire_when_free_then_blocks_others(self):
        self.assertTrue(lease.acquire(self.conn, "dell"))
        self.assertEqual(lease.get_holder(self.conn)["holder"], "dell")
        self.assertFalse(lease.acquire(self.conn, "laptop"))
        self.assertEqual(lease.get_holder(self.conn)["holder"], "dell")

    def test_release_only_by_holder(self):
        lease.acquire(self.conn, "dell")
        self.assertFalse(lease.release(self.conn, "laptop"))
        self.assertEqual(lease.get_holder(self.conn)["holder"], "dell")
        self.assertTrue(lease.release(self.conn, "dell"))
        self.assertIsNone(lease.get_holder(self.conn)["holder"])

    def test_steal_takes_regardless(self):
        lease.acquire(self.conn, "dell")
        lease.steal(self.conn, "laptop")
        self.assertEqual(lease.get_holder(self.conn)["holder"], "laptop")

    def test_set_holder(self):
        lease.set_holder(self.conn, "ats")
        self.assertEqual(lease.get_holder(self.conn)["holder"], "ats")
        lease.set_holder(self.conn, None)
        self.assertIsNone(lease.get_holder(self.conn)["holder"])


if __name__ == "__main__":
    unittest.main()
