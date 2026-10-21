import hashlib
import json
import posixpath
import re
from datetime import datetime, timezone
from pathlib import Path

import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup
from bs4.element import NavigableString, PreformattedString

# Leaf blocks: their whole text becomes one block. A <p> takes the type of
# its context (para, or list/quote when inside <li>/<blockquote>).
LEAF_TAGS = {"p": None, "h1": "heading", "h2": "heading", "h3": "heading",
             "h4": "heading", "h5": "heading", "h6": "heading"}
# Containers that set the block type for the text inside them.
CONTEXT_TAGS = {"li": "list", "blockquote": "quote"}
INLINE_TAGS = {
    "a", "abbr", "b", "bdi", "bdo", "big", "br", "cite", "code", "dfn", "em",
    "font", "i", "img", "kbd", "mark", "q", "rp", "rt", "ruby", "s", "samp",
    "small", "span", "strike", "strong", "sub", "sup", "time", "tt", "u",
    "var", "wbr",
}
SKIP_TAGS = {"head", "script", "style", "title", "svg", "math", "template"}
# Converted (e.g. Kindle->EPUB) books mark headings as <div class="heading_x">.
_HEADING_CLASS = re.compile(r"heading|^(?:chapter[-_]?)?title$|^h[1-6]$", re.I)


def _now():
    return datetime.now(timezone.utc).isoformat()


def _meta(book, field, default=None):
    vals = book.get_metadata("DC", field)
    return vals[0][0] if vals else default


def _norm(text):
    return re.sub(r"\s+", " ", text).strip()


def _text(el):
    """Raw text of `el`. Inline tags join without a separator (so a drop cap
    <span>T</span>he reads "The"); <br> and block boundaries become spaces."""
    out = []
    for c in el.children:
        if isinstance(c, NavigableString):
            if not isinstance(c, PreformattedString):  # comments, PIs, doctype
                out.append(str(c))
        elif c.name in SKIP_TAGS:
            continue
        elif c.name == "br":
            out.append(" ")
        elif c.name in INLINE_TAGS:
            out.append(_text(c))
        else:
            out.append(" " + _text(c) + " ")
    return "".join(out)


def _context_kind(el, kind):
    if el.name in CONTEXT_TAGS:
        return CONTEXT_TAGS[el.name]
    if any(_HEADING_CLASS.search(c) for c in el.get("class") or []):
        return "heading"
    return kind


def _extract_blocks(root):
    """Ordered (type, text) blocks for a document. Walks the tree rather than
    matching a tag allowlist, so text in generic containers (<div>, <td>, ...)
    is kept; each run of inline content between block boundaries is a block."""
    blocks = []

    def emit(kind, text):
        text = _norm(text)
        if text:
            blocks.append((kind, text))

    def walk(el, kind):
        run = []
        for c in el.children:
            if isinstance(c, NavigableString):
                if not isinstance(c, PreformattedString):
                    run.append(str(c))
            elif c.name in SKIP_TAGS:
                continue
            elif c.name in INLINE_TAGS:
                run.append(" " if c.name == "br" else _text(c))
            else:
                emit(kind, "".join(run))
                run = []
                if c.name in LEAF_TAGS:
                    emit(LEAF_TAGS[c.name] or kind, _text(c))
                else:
                    walk(c, _context_kind(c, kind))
        emit(kind, "".join(run))

    walk(root, "para")
    return blocks


def _toc_titles(book):
    """Map spine file name -> title of the first TOC entry pointing into it."""
    titles = {}

    def visit(entries):
        for entry in entries:
            if isinstance(entry, (tuple, list)):
                visit(entry)
                continue
            href = (getattr(entry, "href", "") or "").split("#")[0]
            title = _norm(getattr(entry, "title", "") or "")
            if href and title:
                titles.setdefault(posixpath.normpath(href), title)

    visit(book.toc)
    return titles


def _lookup_title(titles, name):
    name = posixpath.normpath(name)
    if name in titles:
        return titles[name]
    # TOC hrefs are relative to the NCX/nav doc, which may sit in a different
    # directory than the OPF that item names are relative to.
    matches = [t for href, t in titles.items()
               if posixpath.basename(href) == posixpath.basename(name)]
    return matches[0] if len(matches) == 1 else None


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

    toc = _toc_titles(book)
    order = 0
    chap_order = 0
    chap_title = None
    chap_from_toc = False
    chapter_id = None  # created lazily, so docs with no text add no chapter
    for idref, linear in book.spine:
        item = book.get_item_with_id(idref)
        if item is None or item.get_type() != ebooklib.ITEM_DOCUMENT:
            continue
        if linear == "no":
            continue
        if isinstance(item, epub.EpubNav):
            continue
        if "nav" in (getattr(item, "properties", None) or []):
            continue
        soup = BeautifulSoup(item.get_content(), "html.parser")
        blocks = _extract_blocks(soup.body or soup)
        title = _lookup_title(toc, item.get_name())
        # A doc the TOC doesn't list (e.g. a split-off part, per-chapter
        # endnotes) continues the TOC chapter before it.
        if title is not None or not chap_from_toc:
            chap_title = title or next(
                (t for kind, t in blocks if kind == "heading"), item.get_name())
            chap_from_toc = title is not None
            chapter_id = None

        for kind, text in blocks:
            if chapter_id is None:
                ccur = conn.execute(
                    "INSERT INTO chapters (book_id, title, order_idx, parent_id) "
                    "VALUES (?,?,?,NULL)", (book_id, chap_title, chap_order))
                chapter_id = ccur.lastrowid
                chap_order += 1
            conn.execute(
                "INSERT INTO blocks (book_id, chapter_id, order_idx, type, text) "
                "VALUES (?,?,?,?,?)",
                (book_id, chapter_id, order, kind, text))
            order += 1

    conn.commit()
    return book_id


def ingest_scriptures(conn, volume):
    """Insert one normalized scripture volume as a folio book.

    `volume` = {title, label, chapters:[{title, verses:[{num, text}]}]}.
    One block per verse (type "para"), verse number prefixed into the text.
    Idempotent by content hash, mirroring ingest_epub."""
    canonical = json.dumps(volume, sort_keys=True, ensure_ascii=False).encode("utf-8")
    source_hash = hashlib.sha256(canonical).hexdigest()

    existing = conn.execute(
        "SELECT id FROM books WHERE source_hash = ?", (source_hash,)).fetchone()
    if existing:
        return existing["id"]

    cur = conn.execute(
        "INSERT INTO books (title, author, source_hash, created_at) VALUES (?,?,?,?)",
        (volume["title"], volume.get("label"), source_hash, _now()))
    book_id = cur.lastrowid

    order = 0
    for chap_order, chapter in enumerate(volume["chapters"]):
        ccur = conn.execute(
            "INSERT INTO chapters (book_id, title, order_idx, parent_id) "
            "VALUES (?,?,?,NULL)", (book_id, chapter["title"], chap_order))
        chapter_id = ccur.lastrowid
        for verse in chapter["verses"]:
            conn.execute(
                "INSERT INTO blocks (book_id, chapter_id, order_idx, type, text) "
                "VALUES (?,?,?,?,?)",
                (book_id, chapter_id, order, "para",
                 f'{verse["num"]} {verse["text"]}'))
            order += 1

    conn.commit()
    return book_id
