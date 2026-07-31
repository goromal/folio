import sqlite3
import tempfile
from pathlib import Path
from ebooklib import epub

from folio_backend import db


def temp_db():
    """Return an initialized db on a temp file path."""
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    conn = db.connect(tmp.name)
    db.init_db(conn)
    return conn, tmp.name


def make_fixture_epub(path):
    """Deterministic 2-chapter EPUB used across ingestion/search/API tests."""
    book = epub.EpubBook()
    book.set_identifier("folio-fixture-001")
    book.set_title("Test Book")
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
    book.add_item(c1)
    book.add_item(c2)
    book.toc = (c1, c2)
    book.spine = [c1, c2]
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    epub.write_epub(str(path), book)
    return str(path)
