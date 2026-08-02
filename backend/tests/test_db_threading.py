import threading
import unittest

from tests.helpers import temp_db


class DbThreadingTest(unittest.TestCase):
    """Regression: a connection created in one thread must be usable + closable
    from another, because FastAPI's threadpool may run a sync dependency's setup
    and teardown on different threads (would 500 under real uvicorn otherwise)."""

    def test_connection_usable_and_closable_from_another_thread(self):
        conn, _path = temp_db()
        errors = []

        def worker():
            try:
                conn.execute("SELECT 1").fetchone()
                conn.close()
            except Exception as e:  # noqa: BLE001
                errors.append(e)

        t = threading.Thread(target=worker)
        t.start()
        t.join()
        self.assertEqual(errors, [], f"cross-thread connection use failed: {errors}")


if __name__ == "__main__":
    unittest.main()
