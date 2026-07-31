import hashlib
from datetime import datetime, timezone
from pathlib import Path

import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup

BLOCK_TAGS = {
    "p": "para",
    "h1": "heading", "h2": "heading", "h3": "heading",
    "h4": "heading", "h5": "heading", "h6": "heading",
    "li": "list", "blockquote": "quote",
}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _meta(book, field, default=None):
    vals = book.get_metadata("DC", field)
    return vals[0][0] if vals else default


def ingest_epub(conn, path):
    """Parse an EPUB into books/chapters/blocks. Idempotent by content hash."""
    data = Path(path).read_bytes()
    source_hash = hashlib.sha256(data).hexdigest()

    existing = conn.execute(
        "SELECT id FROM books WHERE source_hash = ?", (source_hash,)).fetchone()
    if existing:
        return existing["id"]

    book = epub.read_epub(path)
    title = _meta(book, "title", Path(path).stem)
    author = _meta(book, "creator")

    cur = conn.execute(
        "INSERT INTO books (title, author, source_hash, created_at) VALUES (?,?,?,?)",
        (title, author, source_hash, _now()))
    book_id = cur.lastrowid

    order = 0
    chap_order = 0
    for idref, _linear in book.spine:
        item = book.get_item_with_id(idref)
        if item is None or item.get_type() != ebooklib.ITEM_DOCUMENT:
            continue
        soup = BeautifulSoup(item.get_content(), "html.parser")
        heading = soup.find(["h1", "h2", "h3"])
        chap_title = heading.get_text(strip=True) if heading else item.get_name()
        ccur = conn.execute(
            "INSERT INTO chapters (book_id, title, order_idx, parent_id) "
            "VALUES (?,?,?,NULL)", (book_id, chap_title, chap_order))
        chapter_id = ccur.lastrowid
        chap_order += 1

        for el in soup.find_all(list(BLOCK_TAGS.keys())):
            text = el.get_text(" ", strip=True)
            if not text:
                continue
            conn.execute(
                "INSERT INTO blocks (book_id, chapter_id, order_idx, type, text) "
                "VALUES (?,?,?,?,?)",
                (book_id, chapter_id, order, BLOCK_TAGS[el.name], text))
            order += 1

    conn.commit()
    return book_id
