import importlib
import tempfile
import unittest

from fastapi.testclient import TestClient


class AppBootTest(unittest.TestCase):
    def test_boot_and_health(self):
        tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        tmp.close()
        main = importlib.import_module("folio_backend.main")
        app = main.build_app(tmp.name)
        client = TestClient(app)
        self.assertEqual(client.get("/health").status_code, 200)


if __name__ == "__main__":
    unittest.main()
