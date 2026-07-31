import glob
import os
import tempfile
import unittest

from fastapi.testclient import TestClient

from folio_backend.app import create_app
from tests.helpers import make_fixture_epub


class UploadCleanupTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        tmp.close()
        self.client = TestClient(create_app(tmp.name))
        self.epub_path = os.path.join(tempfile.mkdtemp(), "f.epub")
        make_fixture_epub(self.epub_path)

    def _epub_temp_files(self):
        return set(glob.glob(os.path.join(tempfile.gettempdir(), "*.epub")))

    def test_upload_does_not_leak_temp_file(self):
        before = self._epub_temp_files()
        with open(self.epub_path, "rb") as fh:
            r = self.client.post(
                "/books",
                files={"file": ("f.epub", fh, "application/epub+zip")})
        self.assertEqual(r.status_code, 201)
        after = self._epub_temp_files()
        leaked = after - before
        self.assertEqual(leaked, set(),
                         f"upload left temp file(s) behind: {leaked}")


if __name__ == "__main__":
    unittest.main()
