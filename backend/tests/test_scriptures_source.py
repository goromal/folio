import json
import os
import tempfile
import unittest

from folio_backend import scriptures_source, ingest
from tests.helpers import temp_db


def _books_file(books):
    return {"books": books}


def _write_sample(data_dir):
    # Minimal but real-shaped fixtures for each of the five files.
    ch = lambda ref, verses: {"chapter": 1, "reference": ref, "verses": verses}
    vs = lambda *pairs: [{"reference": f"{r}", "text": t, "verse": n}
                         for (r, n, t) in pairs]
    files = {
        "old-testament.json": _books_file([
            {"book": "Genesis", "chapters": [
                ch("Genesis 1", vs(("Genesis 1:1", "1", "In the beginning."))),
            ]},
        ]),
        "new-testament.json": _books_file([
            {"book": "Matthew", "chapters": [
                ch("Matthew 1", vs(("Matthew 1:1", "1", "The book of the generation."))),
            ]},
        ]),
        "book-of-mormon.json": _books_file([
            {"book": "1 Nephi", "chapters": [
                ch("1 Nephi 1", vs(("1 Nephi 1:1", "1", "I, Nephi, having been born."))),
            ]},
        ]),
        "pearl-of-great-price.json": _books_file([
            {"book": "Articles of Faith", "chapters": [
                ch("Articles of Faith 1", vs(("A of F 1:1", "1", "We believe in God."))),
            ]},
        ]),
        "doctrine-and-covenants.json": {"sections": [
            {"section": "1", "reference": "D&C 1",
             "verses": vs(("D&C 1:1", "1", "Hearken, O ye people."))},
        ]},
    }
    for name, payload in files.items():
        with open(os.path.join(data_dir, name), "w", encoding="utf-8") as fh:
            json.dump(payload, fh)


class ScripturesSourceTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        _write_sample(self.dir)
        self.vols = scriptures_source.load_volumes(self.dir)

    def test_returns_four_volumes(self):
        self.assertEqual(set(self.vols), {"bible", "bom", "dc", "pgp"})

    def test_bible_combines_ot_then_nt(self):
        titles = [c["title"] for c in self.vols["bible"]["chapters"]]
        self.assertEqual(titles, ["Genesis 1", "Matthew 1"])
        self.assertEqual(self.vols["bible"]["title"],
                         "The Holy Bible (King James Version)")

    def test_dc_from_sections(self):
        chapters = self.vols["dc"]["chapters"]
        self.assertEqual(chapters[0]["title"], "D&C 1")
        self.assertEqual(chapters[0]["verses"][0], {"num": "1", "text": "Hearken, O ye people."})

    def test_volumes_ingest_cleanly(self):
        conn, _ = temp_db()
        for slug in ("bible", "bom", "dc", "pgp"):
            book_id = ingest.ingest_scriptures(conn, self.vols[slug])
            self.assertTrue(book_id > 0)
        self.assertEqual(
            conn.execute("SELECT COUNT(*) c FROM books").fetchone()["c"], 4)


if __name__ == "__main__":
    unittest.main()
