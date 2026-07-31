import os
import tempfile
import unittest

from ebooklib import epub

from folio_backend import ingest
from tests.helpers import temp_db


def _make_epub_with_nav(path):
    """2-chapter EPUB whose spine includes the nav doc and a non-linear
    extra doc, to prove ingestion skips both."""
    book = epub.EpubBook()
    book.set_identifier("folio-fixture-nav-001")
    book.set_title("Nav Test Book")
    book.add_author("Test Author")

    c1 = epub.EpubHtml(title="Chapter One", file_name="c1.xhtml", lang="en")
    c1.content = (
        "<h1>Chapter One</h1>"
        "<p>The quick brown fox.</p>"
        "<p>Jumps over the lazy dog.</p>"
    )
    c2 = epub.EpubHtml(title="Chapter Two", file_name="c2.xhtml", lang="en")
    c2.content = (
        "<h1>Chapter Two</h1>"
        "<p>Second chapter paragraph about foxes.</p>"
    )
    extra = epub.EpubHtml(title="Extra", file_name="extra.xhtml", lang="en")
    extra.content = "<h1>Extra</h1><p>Should not be ingested.</p>"

    book.add_item(c1)
    book.add_item(c2)
    book.add_item(extra)
    book.toc = (c1, c2)

    nav = epub.EpubNav()
    book.add_item(nav)
    book.add_item(epub.EpubNcx())

    # spine includes the nav doc, plus a non-linear extra doc.
    book.spine = ["nav", c1, c2, (extra, "no")]

    epub.write_epub(str(path), book)
    return str(path)


class IngestNavTest(unittest.TestCase):
    def setUp(self):
        self.conn, _ = temp_db()
        self._epub = os.path.join(tempfile.mkdtemp(), "nav_fixture.epub")
        _make_epub_with_nav(self._epub)

    def test_nav_and_nonlinear_docs_skipped(self):
        book_id = ingest.ingest_epub(self.conn, self._epub)
        chapters = self.conn.execute(
            "SELECT title FROM chapters WHERE book_id = ? ORDER BY order_idx",
            (book_id,)).fetchall()
        self.assertEqual([c["title"] for c in chapters],
                         ["Chapter One", "Chapter Two"])


if __name__ == "__main__":
    unittest.main()
