# LDS Standard Works Ingestion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bulk-import the four public-domain LDS standard works into folio as four books with one block per verse, so the user can study topically with folio's existing passage/tag/link/note tools.

**Architecture:** A translation-agnostic ingester (`ingest_scriptures`) inserts a normalized *volume* into the folio DB (mirroring `ingest_epub`, idempotent by content hash). A source adapter (`scriptures_source`) turns the `bcbooks/scriptures-json` public-domain dataset into those normalized volumes. A one-off CLI (`import_scriptures`) wires dataset → adapter → ingester against the live SQLite DB.

**Tech Stack:** Python 3, SQLite (stdlib `sqlite3`), `unittest`, FastAPI backend package `folio_backend`. No new dependencies. Tests run in the folio nix-shell (see Verify commands).

**Spec:** `docs/superpowers/specs/2026-09-19-lds-standard-works-folio-design.md`

---

## Background the implementer needs

- **Repo:** work happens in `folio/backend/` (package `folio_backend`). Run all commands from `folio/backend`.
- **DB model:** `books → chapters → blocks`. A *block* is one unit of text (`type` in `para|heading|list|quote`). Markup anchors to `(block_id, offset)`, so **one verse per block** is the whole point. Schema: `folio_backend/schema.sql`.
- **Existing pattern to imitate:** `folio_backend/ingest.py::ingest_epub` — reads a source, inserts one `books` row (dedup by `source_hash`), then `chapters` and `blocks` with monotonically increasing `order_idx`. Copy its style exactly. `_now()` and the `hashlib`/`json` imports live here too.
- **FTS is automatic:** the `blocks_ai` trigger indexes every inserted block; no extra work for search.
- **DB helpers:** `folio_backend/db.py::connect(path)` and `init_db(conn)` (idempotent — all `CREATE ... IF NOT EXISTS`). Test helper `tests/helpers.py::temp_db()` returns `(conn, path)` on an initialized temp DB.
- **Lease:** the single-writer lease is enforced **only at the HTTP layer** (`app.py::_require_holder` → 423). A direct-SQLite CLI write bypasses it. So the importer must run on the machine that owns the DB file, with the backend idle (SQLite locking serializes writes, but idle avoids contention).

### The dataset: `bcbooks/scriptures-json`

Public domain. Five files, each fetched into a local directory:

| File | Top-level shape |
| --- | --- |
| `old-testament.json` | `{"books": [ {"book": "Genesis", "chapters": [ {"chapter": 1, "reference": "Genesis 1", "verses": [...] } ] } ]}` |
| `new-testament.json` | same `books[]` shape |
| `book-of-mormon.json` | same `books[]` shape |
| `pearl-of-great-price.json` | same `books[]` shape |
| `doctrine-and-covenants.json` | `{"sections": [ {"section": "1", "reference": "D&C 1", "verses": [...] } ]}` — **no book level** |

Every verse object is `{"reference": "1 Nephi 1:1", "text": "I, Nephi, ...", "verse": "1"}`.
Every chapter/section already carries a ready-made `reference` (`"Genesis 1"`, `"1 Nephi 1"`,
`"D&C 1"`, `"Articles of Faith 1"`) — **use it directly as the folio chapter title**.

**Known exclusions** (dataset omits copyrighted material): footnotes, chapter summaries,
and the D&C Official Declarations. Verse text only — which matches the spec's raw-text decision.

### The normalized `Volume` shape (contract between adapter and ingester)

```python
# One folio book. Chapters are flat (folio parent_id = NULL); the full
# reference lives in each chapter title, so no separate book grouping is needed.
Volume = {
    "title": str,           # folio book title, e.g. "The Book of Mormon"
    "label": str | None,    # folio books.author, e.g. "King James Version"
    "chapters": [
        {
            "title": str,            # e.g. "1 Nephi 1", "Genesis 1", "D&C 76"
            "verses": [
                {"num": str, "text": str},   # num is the verse label, e.g. "1"
                ...
            ],
        },
        ...
    ],
}
```

### Expected magnitudes (real dataset totals — use as sanity checks)

| Volume | folio book title | chapters | verses (blocks) |
| --- | --- | --- | --- |
| Bible (KJV, OT+NT combined) | The Holy Bible (King James Version) | 1189 | 31102 |
| Book of Mormon | The Book of Mormon | 239 | 6604 |
| Doctrine and Covenants | The Doctrine and Covenants | 138 | 3654 |
| Pearl of Great Price | The Pearl of Great Price | 16 | 635 |
| **Total** | (4 books) | **1582** | **41995** |

---

## File structure

- `folio_backend/ingest.py` — **modify**: add `ingest_scriptures(conn, volume)` next to `ingest_epub`. Pure DB insertion; no I/O.
- `folio_backend/scriptures_source.py` — **create**: dataset → `Volume` list. Owns all format-specific parsing.
- `folio_backend/import_scriptures.py` — **create**: CLI wiring dataset dir → adapter → ingester against the live DB.
- `tests/test_ingest_scriptures.py` — **create**: unit tests for the ingester (fixture `Volume`).
- `tests/test_scriptures_source.py` — **create**: unit tests for the adapter (tiny JSON files written to a temp dir).
- `tests/test_import_scriptures.py` — **create**: end-to-end CLI test against a temp DB + temp data dir.

---

### Task 1: `ingest_scriptures()` core ingester

**Goal:** A translation-agnostic function that inserts one normalized `Volume` into the folio DB as a book with one block per verse, idempotent by content hash.

**Files:**
- Modify: `folio_backend/ingest.py` (add `import json` at top if absent; add the function)
- Test: `tests/test_ingest_scriptures.py`

**Acceptance Criteria:**
- [ ] `ingest_scriptures(conn, volume)` inserts one `books` row with `title`/`author` from the volume.
- [ ] Each chapter → one `chapters` row titled `chapter["title"]`, ordered; each verse → one `blocks` row `type="para"`, `text = f'{num} {text}'`, `order_idx` monotonic across the whole book.
- [ ] Re-running with the same volume returns the same `book_id` and does not duplicate rows.
- [ ] A distinctive verse word is findable via FTS (`blocks_fts`).

**Verify:** `nix-shell -p 'python3.withPackages(ps: with ps; [ fastapi uvicorn pydantic httpx werkzeug python-multipart starlette ebooklib beautifulsoup4 ])' --run 'python -m unittest tests.test_ingest_scriptures -v'` → OK (4 tests)

**Steps:**

- [ ] **Step 1: Write the failing test** — `tests/test_ingest_scriptures.py`

```python
import unittest

from folio_backend import ingest
from tests.helpers import temp_db


def _fixture_volume():
    return {
        "title": "Test Scriptures",
        "label": "Test Edition",
        "chapters": [
            {"title": "Alpha 1", "verses": [
                {"num": "1", "text": "In the beginning was the seedling."},
                {"num": "2", "text": "And the seedling grew."},
            ]},
            {"title": "Alpha 2", "verses": [
                {"num": "1", "text": "A second chapter about foxes."},
            ]},
        ],
    }


class IngestScripturesTest(unittest.TestCase):
    def setUp(self):
        self.conn, self._path = temp_db()

    def test_creates_book_chapters_blocks(self):
        book_id = ingest.ingest_scriptures(self.conn, _fixture_volume())
        book = self.conn.execute(
            "SELECT title, author FROM books WHERE id = ?", (book_id,)).fetchone()
        self.assertEqual(book["title"], "Test Scriptures")
        self.assertEqual(book["author"], "Test Edition")

        chapters = self.conn.execute(
            "SELECT title FROM chapters WHERE book_id = ? ORDER BY order_idx",
            (book_id,)).fetchall()
        self.assertEqual([c["title"] for c in chapters], ["Alpha 1", "Alpha 2"])

        blocks = self.conn.execute(
            "SELECT type, text, order_idx FROM blocks WHERE book_id = ? ORDER BY order_idx",
            (book_id,)).fetchall()
        self.assertEqual([b["order_idx"] for b in blocks], [0, 1, 2])
        self.assertTrue(all(b["type"] == "para" for b in blocks))
        # Verse number is prefixed into the block text.
        self.assertEqual(blocks[0]["text"], "1 In the beginning was the seedling.")
        self.assertEqual(blocks[2]["text"], "1 A second chapter about foxes.")

    def test_is_idempotent(self):
        first = ingest.ingest_scriptures(self.conn, _fixture_volume())
        second = ingest.ingest_scriptures(self.conn, _fixture_volume())
        self.assertEqual(first, second)
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) c FROM books").fetchone()["c"], 1)
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) c FROM blocks").fetchone()["c"], 3)

    def test_distinct_volumes_are_separate_books(self):
        v = _fixture_volume()
        other = _fixture_volume(); other["title"] = "Other Scriptures"
        a = ingest.ingest_scriptures(self.conn, v)
        b = ingest.ingest_scriptures(self.conn, other)
        self.assertNotEqual(a, b)

    def test_verse_is_searchable_via_fts(self):
        book_id = ingest.ingest_scriptures(self.conn, _fixture_volume())
        rows = self.conn.execute(
            "SELECT b.id FROM blocks b JOIN blocks_fts f ON f.rowid = b.id "
            "WHERE b.book_id = ? AND blocks_fts MATCH ?", (book_id, "foxes")).fetchall()
        self.assertEqual(len(rows), 1)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix-shell -p 'python3.withPackages(ps: with ps; [ fastapi uvicorn pydantic httpx werkzeug python-multipart starlette ebooklib beautifulsoup4 ])' --run 'python -m unittest tests.test_ingest_scriptures -v'`
Expected: FAIL — `AttributeError: module 'folio_backend.ingest' has no attribute 'ingest_scriptures'`.

- [ ] **Step 3: Write minimal implementation** — append to `folio_backend/ingest.py`

Ensure the file imports `json` at the top (add `import json` beside the existing `import hashlib` if not present), then add:

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nix-shell -p 'python3.withPackages(ps: with ps; [ fastapi uvicorn pydantic httpx werkzeug python-multipart starlette ebooklib beautifulsoup4 ])' --run 'python -m unittest tests.test_ingest_scriptures -v'`
Expected: PASS — OK (4 tests).

- [ ] **Step 5: Commit**

```bash
git add folio_backend/ingest.py tests/test_ingest_scriptures.py
git commit -m "feat(ingest): add ingest_scriptures for verse-level scripture import"
```

---

### Task 2: Dataset source adapter

**Goal:** Turn the five `bcbooks/scriptures-json` files in a directory into the four normalized `Volume`s (Bible = OT+NT combined; D&C from `sections`).

**Files:**
- Create: `folio_backend/scriptures_source.py`
- Test: `tests/test_scriptures_source.py`

**Acceptance Criteria:**
- [ ] `load_volumes(data_dir)` returns a dict with keys `bible`, `bom`, `dc`, `pgp`, each a valid `Volume`.
- [ ] Bible chapters = OT chapters followed by NT chapters; chapter titles come from each chapter's `reference`.
- [ ] D&C chapters are built from `sections`, titled by their `reference` (e.g. `"D&C 1"`).
- [ ] Verses map `{"verse","text"}` → `{"num","text"}`; the resulting volumes ingest cleanly via `ingest_scriptures`.

**Verify:** `nix-shell -p 'python3.withPackages(ps: with ps; [ fastapi uvicorn pydantic httpx werkzeug python-multipart starlette ebooklib beautifulsoup4 ])' --run 'python -m unittest tests.test_scriptures_source -v'` → OK

**Steps:**

- [ ] **Step 1: Write the failing test** — `tests/test_scriptures_source.py`

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix-shell -p 'python3.withPackages(ps: with ps; [ fastapi uvicorn pydantic httpx werkzeug python-multipart starlette ebooklib beautifulsoup4 ])' --run 'python -m unittest tests.test_scriptures_source -v'`
Expected: FAIL — `ModuleNotFoundError: No module named 'folio_backend.scriptures_source'`.

- [ ] **Step 3: Write minimal implementation** — `folio_backend/scriptures_source.py`

```python
"""Turn the bcbooks/scriptures-json dataset into normalized volumes.

Dataset: https://github.com/bcbooks/scriptures-json (public domain). Download the
five JSON files into a directory and pass it to load_volumes(). The dataset omits
copyrighted material (footnotes, chapter summaries, D&C Official Declarations)."""
import json
from pathlib import Path

_BIBLE_LABEL = "King James Version"
_CHURCH = "The Church of Jesus Christ of Latter-day Saints"


def _verses(raw_verses):
    return [{"num": v["verse"], "text": v["text"]} for v in raw_verses]


def _chapters_from_books(books):
    """BoM / Bible / PoGP shape: books[] -> flat chapters[] titled by `reference`."""
    chapters = []
    for book in books:
        for chapter in book["chapters"]:
            chapters.append({
                "title": chapter["reference"],
                "verses": _verses(chapter["verses"]),
            })
    return chapters


def _chapters_from_sections(sections):
    """D&C shape: sections[] each already carrying a `reference` like 'D&C 1'."""
    return [{"title": s["reference"], "verses": _verses(s["verses"])}
            for s in sections]


def _load(data_dir, name):
    return json.loads((Path(data_dir) / name).read_text(encoding="utf-8"))


def load_volumes(data_dir):
    """Return {slug: Volume} for bible, bom, dc, pgp."""
    ot = _load(data_dir, "old-testament.json")
    nt = _load(data_dir, "new-testament.json")
    bom = _load(data_dir, "book-of-mormon.json")
    dc = _load(data_dir, "doctrine-and-covenants.json")
    pgp = _load(data_dir, "pearl-of-great-price.json")

    return {
        "bible": {
            "title": "The Holy Bible (King James Version)",
            "label": _BIBLE_LABEL,
            "chapters": _chapters_from_books(ot["books"])
                        + _chapters_from_books(nt["books"]),
        },
        "bom": {
            "title": "The Book of Mormon",
            "label": _CHURCH,
            "chapters": _chapters_from_books(bom["books"]),
        },
        "dc": {
            "title": "The Doctrine and Covenants",
            "label": _CHURCH,
            "chapters": _chapters_from_sections(dc["sections"]),
        },
        "pgp": {
            "title": "The Pearl of Great Price",
            "label": _CHURCH,
            "chapters": _chapters_from_books(pgp["books"]),
        },
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nix-shell -p 'python3.withPackages(ps: with ps; [ fastapi uvicorn pydantic httpx werkzeug python-multipart starlette ebooklib beautifulsoup4 ])' --run 'python -m unittest tests.test_scriptures_source -v'`
Expected: PASS — OK (4 tests).

- [ ] **Step 5: Commit**

```bash
git add folio_backend/scriptures_source.py tests/test_scriptures_source.py
git commit -m "feat(ingest): add scriptures-json source adapter"
```

---

### Task 3: Import CLI

**Goal:** A `python -m folio_backend.import_scriptures` command that loads a dataset directory and imports the selected volumes into a folio DB, printing a per-volume summary.

**Files:**
- Create: `folio_backend/import_scriptures.py`
- Test: `tests/test_import_scriptures.py`

**Acceptance Criteria:**
- [ ] `main(argv)` accepts `--data <dir>` (required), `--db <path>` (default `$FOLIO_DB` or `/var/lib/folio/folio.db`), `--volumes` (comma list, default all four).
- [ ] Unknown volume slugs cause a non-zero exit with a clear error.
- [ ] Running against a temp DB + sample data dir creates the selected books; a second run reports "already present" and does not duplicate.
- [ ] Prints one summary line per volume with book_id, status, chapter count, verse count.

**Verify:** `nix-shell -p 'python3.withPackages(ps: with ps; [ fastapi uvicorn pydantic httpx werkzeug python-multipart starlette ebooklib beautifulsoup4 ])' --run 'python -m unittest tests.test_import_scriptures -v'` → OK

**Steps:**

- [ ] **Step 1: Write the failing test** — `tests/test_import_scriptures.py`

```python
import unittest

from folio_backend import import_scriptures
from tests.helpers import temp_db
from tests.test_scriptures_source import _write_sample  # reuse the sample fixtures
import tempfile


class ImportScripturesCliTest(unittest.TestCase):
    def setUp(self):
        self.conn, self.db_path = temp_db()
        self.conn.close()  # CLI opens its own connection
        self.data = tempfile.mkdtemp()
        _write_sample(self.data)

    def _books(self):
        from folio_backend import db
        c = db.connect(self.db_path)
        try:
            return [dict(r) for r in c.execute(
                "SELECT title FROM books ORDER BY id").fetchall()]
        finally:
            c.close()

    def test_imports_selected_volumes(self):
        rc = import_scriptures.main(["--data", self.data, "--db", self.db_path,
                                     "--volumes", "bom,dc"])
        self.assertEqual(rc, 0)
        titles = [b["title"] for b in self._books()]
        self.assertEqual(titles, ["The Book of Mormon", "The Doctrine and Covenants"])

    def test_rerun_is_idempotent(self):
        import_scriptures.main(["--data", self.data, "--db", self.db_path])
        import_scriptures.main(["--data", self.data, "--db", self.db_path])
        self.assertEqual(len(self._books()), 4)

    def test_unknown_volume_errors(self):
        with self.assertRaises(SystemExit) as ctx:
            import_scriptures.main(["--data", self.data, "--db", self.db_path,
                                    "--volumes", "bogus"])
        self.assertNotEqual(ctx.exception.code, 0)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix-shell -p 'python3.withPackages(ps: with ps; [ fastapi uvicorn pydantic httpx werkzeug python-multipart starlette ebooklib beautifulsoup4 ])' --run 'python -m unittest tests.test_import_scriptures -v'`
Expected: FAIL — `ModuleNotFoundError: No module named 'folio_backend.import_scriptures'`.

- [ ] **Step 3: Write minimal implementation** — `folio_backend/import_scriptures.py`

```python
"""One-off importer for the LDS standard works.

Fetch the five bcbooks/scriptures-json files into a directory first (see the
plan's "How to run" section), then:

    python -m folio_backend.import_scriptures --data ./scriptures-json

Writes directly to the SQLite DB (like the test suite), bypassing the HTTP lease
guard, so run it on the machine that owns the DB with the backend idle."""
import argparse
import os

from folio_backend import db, ingest, scriptures_source

DEFAULT_DB = os.environ.get("FOLIO_DB", "/var/lib/folio/folio.db")
ALL_VOLUMES = ("bible", "bom", "dc", "pgp")


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Import the LDS standard works into a folio database.")
    parser.add_argument("--data", required=True,
                        help="directory holding the bcbooks/scriptures-json files")
    parser.add_argument("--db", default=DEFAULT_DB, help="folio SQLite DB path")
    parser.add_argument("--volumes", default=",".join(ALL_VOLUMES),
                        help="comma-separated subset of: " + ", ".join(ALL_VOLUMES))
    args = parser.parse_args(argv)

    selected = [v.strip() for v in args.volumes.split(",") if v.strip()]
    unknown = [v for v in selected if v not in ALL_VOLUMES]
    if unknown:
        parser.error("unknown volume(s): %s; choose from %s"
                     % (", ".join(unknown), ", ".join(ALL_VOLUMES)))

    volumes = scriptures_source.load_volumes(args.data)
    conn = db.connect(args.db)
    try:
        for slug in selected:
            vol = volumes[slug]
            before = conn.execute("SELECT COUNT(*) c FROM books").fetchone()["c"]
            book_id = ingest.ingest_scriptures(conn, vol)
            after = conn.execute("SELECT COUNT(*) c FROM books").fetchone()["c"]
            n_ch = conn.execute("SELECT COUNT(*) c FROM chapters WHERE book_id=?",
                                (book_id,)).fetchone()["c"]
            n_bl = conn.execute("SELECT COUNT(*) c FROM blocks WHERE book_id=?",
                                (book_id,)).fetchone()["c"]
            status = "created" if after > before else "already present"
            print("[%s] %s: book_id=%d (%s); %d chapters, %d verses"
                  % (slug, vol["title"], book_id, status, n_ch, n_bl))
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nix-shell -p 'python3.withPackages(ps: with ps; [ fastapi uvicorn pydantic httpx werkzeug python-multipart starlette ebooklib beautifulsoup4 ])' --run 'python -m unittest tests.test_import_scriptures -v'`
Expected: PASS — OK (3 tests).

- [ ] **Step 5: Run the full backend suite (no regressions)**

Run: `nix-shell -p 'python3.withPackages(ps: with ps; [ fastapi uvicorn pydantic httpx werkzeug python-multipart starlette ebooklib beautifulsoup4 ])' --run 'python -m unittest discover -s tests'`
Expected: OK — all pre-existing tests plus the three new modules pass.

- [ ] **Step 6: Commit**

```bash
git add folio_backend/import_scriptures.py tests/test_import_scriptures.py
git commit -m "feat(ingest): add import_scriptures CLI for the standard works"
```

---

## How to run the real import (operational — after Task 3)

Run on the machine that owns the folio DB, with the backend idle.

1. **Fetch the dataset** (curl is unavailable in this environment; use Python):

```bash
mkdir -p /tmp/scriptures-json && cd /tmp/scriptures-json
python3 - <<'PY'
import urllib.request
base = "https://raw.githubusercontent.com/bcbooks/scriptures-json/master/"
for f in ("old-testament.json", "new-testament.json", "book-of-mormon.json",
          "doctrine-and-covenants.json", "pearl-of-great-price.json"):
    urllib.request.urlretrieve(base + f, f)
    print("fetched", f)
PY
```

2. **Import** (from `folio/backend`, in the nix-shell so `folio_backend` imports resolve):

```bash
nix-shell -p 'python3.withPackages(ps: with ps; [ fastapi uvicorn pydantic httpx werkzeug python-multipart starlette ebooklib beautifulsoup4 ])' \
  --run 'FOLIO_DB=/var/lib/folio/folio.db python -m folio_backend.import_scriptures --data /tmp/scriptures-json'
```

Expected output (sanity-check magnitudes):

```
[bible] The Holy Bible (King James Version): book_id=15 (created); 1189 chapters, 31102 verses
[bom] The Book of Mormon: book_id=16 (created); 239 chapters, 6604 verses
[dc] The Doctrine and Covenants: book_id=17 (created); 138 chapters, 3654 verses
[pgp] The Pearl of Great Price: book_id=18 (created); 16 chapters, 635 verses
```

3. **Verify in the reader** — the four books appear in the library; open one and confirm verses render with leading numbers, and that `folio_search` finds a known verse.

---

## Self-review (author checklist — done)

- **Spec coverage:** verse=block ingester (Task 1) ✓; one folio book per volume, chapters titled by reference (Tasks 1–2) ✓; translation-agnostic ingester for later modern translation (Task 1 — `Volume` is source-neutral) ✓; static-dataset source with D&C/single-chapter quirks (Task 2) ✓; CLI run on the DB-owning host, lease reality documented (Task 3 + How-to-run) ✓; idempotency by `source_hash` (Task 1) ✓; tests mirroring `test_ingest.py` (all tasks) ✓; raw-text-only / exclusions noted ✓.
- **Spec deviations recorded:** dataset omits D&C Official Declarations (spec had listed them); OT+NT are combined into one Bible book; chapter titles use the dataset's `reference` field rather than reconstructing `f"{book} {chapter}"` (same result, more robust). None change the agreed shape.
- **Placeholder scan:** none — every step carries runnable code/commands.
- **Type consistency:** `Volume` keys (`title`/`label`/`chapters`/`title`/`verses`/`num`/`text`) are identical across `ingest_scriptures`, `scriptures_source`, and all tests; `load_volumes` slugs (`bible`/`bom`/`dc`/`pgp`) match the CLI's `ALL_VOLUMES`.

## Deferred (separate specs/plans — not in scope here)

1. **Modern Bible translation** (one of NRSV/ESV/NIV/NKJV/NLT/NIrV) — copyrighted; needs a license-compatible source. Slots in as a 5th `Volume`, no ingester change.
2. **On-demand api.nephi.org lookup helper** for live passage pulls during study.
