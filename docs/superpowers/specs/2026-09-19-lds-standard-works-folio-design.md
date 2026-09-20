# LDS standard works ingestion for folio

Date: 2026-09-19
Repo: `folio` (backend)

## Overview

Bring the LDS standard works into the folio library as first-class books so
they can be studied with folio's existing passage / tag / note / link tools.
The stated purpose is **enhanced scripture study — linking passages across the
canon to study particular topics**. folio already has everything that workflow
needs (`passages`, `passage_tags`, `passage_links`, `notes`, FTS5 search); the
only gap is that ingestion today is EPUB-only, and scripture needs clean
**verse-level** structure that EPUB markup cannot reliably provide.

This spec covers a one-time bulk import of the four public-domain volumes with
one block per verse. Topical linking is **not** built during import — it grows
organically as the user studies (see Study workflow). Two follow-ups are
explicitly deferred: a modern Bible translation, and an optional on-demand
lookup helper.

### Decisions locked during brainstorming

- **Scope:** all four standard works (KJV Bible, Book of Mormon, Doctrine and
  Covenants, Pearl of Great Price), public domain. Plus a modern translation
  later (one of the six the Church added to Gospel Library) — **deferred**.
- **Structure:** one folio *book* per *volume* (~4 library entries), each
  scripture chapter a folio *chapter*, each verse a *block*.
- **Linking:** import raw verse text only; link/tag/annotate as the user studies.
- **Source:** a complete static public-domain dataset for the bulk load;
  api.nephi.org reserved for on-demand lookup (deferred helper).

## Data model mapping

folio's model is `book → chapter → block`, with markup anchored to
`(block_id, offset)` ranges. Scripture maps on as:

| Scripture level | folio level | Notes |
| --- | --- | --- |
| Volume (e.g. Book of Mormon) | `books` row | ~4 rows; `title` = volume name, `author` = translation/edition label |
| Book + chapter (e.g. 1 Nephi 1) | `chapters` row | `title` = `"1 Nephi 1"`; `order_idx` monotonic across the volume |
| Verse | `blocks` row | `type = "para"`; `text` = `"<n> <verse text>"` (verse number prefixed) |

- **Verse number is prefixed into the block text** (`"1 And it came to pass..."`)
  so verses stay visible in the reader, citeable, and findable via FTS. folio's
  block schema has no dedicated verse-number column, and adding one is out of
  scope; prefixing is the minimal, self-contained choice.
- FTS5 indexing is automatic — the existing `blocks_ai` trigger indexes every
  inserted block, so no extra work is needed for search.
- One block per verse is what makes precise passage-linking work: a passage over
  a single verse-block (`start_off = 0`, large `end_off`) selects exactly that
  verse.

### The four volumes

| folio book title | `author` label | Books covered |
| --- | --- | --- |
| The Holy Bible (King James Version) | King James Version | Genesis … Revelation |
| The Book of Mormon | The Church of Jesus Christ of Latter-day Saints | 1 Nephi … Moroni |
| The Doctrine and Covenants | The Church of Jesus Christ of Latter-day Saints | Sections 1 … 138, Official Declarations 1–2 |
| The Pearl of Great Price | The Church of Jesus Christ of Latter-day Saints | Moses, Abraham, Joseph Smith—Matthew, Joseph Smith—History, Articles of Faith |

Structural quirks handled by the normalizer, not the ingester:

- **D&C** is sections + verses, not book + chapter. Chapter title = `"D&C 1"`,
  `"D&C 76"`, etc. Official Declarations get titles `"Official Declaration 1"`
  and `"Official Declaration 2"`.
- **Pearl of Great Price** mixes chaptered books (Moses, Abraham) and short
  works (JS—History is one long chapter; Articles of Faith is a single chapter
  of 13 verses). Abraham facsimile captions are **not** verses — skip them.
- **Verse text only** — no chapter summaries/headings/study helps (copyrighted,
  and not wanted per the raw-text decision).

## Component: `ingest_scriptures()`

New function in `folio_backend/ingest.py`, alongside `ingest_epub()`. It is
**translation-agnostic** so a licensed modern-translation dataset later reuses
the identical code path.

**Input** — a normalized in-memory structure (produced by a source adapter, see
below), one per volume:

```python
Volume = {
    "title": str,          # folio book title, e.g. "The Book of Mormon"
    "label": str | None,   # folio book.author, e.g. "King James Version"
    "books": [             # ordered
        {
            "name": str,   # e.g. "1 Nephi"
            "chapters": [  # ordered
                {
                    "num": str,          # "1", or "76", or "" for single-chapter works
                    "verses": [          # ordered
                        {"num": int, "text": str},
                        ...
                    ],
                },
                ...
            ],
        },
        ...
    ],
}
```

**Behavior**

1. Compute `source_hash = sha256(label + canonical-serialized content)`. If a
   `books` row with that hash exists, return its id unchanged — **idempotent
   re-runs**, matching `ingest_epub`'s content-hash dedup.
2. Insert one `books` row (`title`, `author = label`, `source_hash`, `created_at`).
3. For each book → chapter, insert a `chapters` row with
   `title = f"{book_name} {chapter_num}".strip()` and a monotonic `order_idx`;
   `parent_id = NULL` (flat, per the chosen structure).
4. For each verse, insert a `blocks` row with `type = "para"`,
   `text = f"{verse.num} {verse.text}"`, and a monotonic `order_idx` that runs
   across the whole volume (consistent with `ingest_epub`, where `order` is
   book-global). FTS indexing follows automatically.
5. `conn.commit()` once at the end; return `book_id`.

The function takes an already-normalized `Volume` and does **no** network or
file I/O — it is pure DB insertion, so it is trivially unit-testable with a
small fixture. Sourcing and parsing live in the adapter.

## Component: source adapter + CLI

**Source adapter** — a small module that turns a downloaded public-domain
dataset (candidate: `bcbooks/scriptures-json`, a complete LDS-canon JSON dump;
exact dataset and its license pinned during implementation) into the four
`Volume` structures above. It owns all format-specific parsing and the
book-ordering / naming conventions. Isolating it here means swapping datasets or
adding the modern translation only touches the adapter, not the ingester.

**CLI** — `python -m folio_backend.import_scriptures --data <path> [--db <path>]
[--volumes bible,bom,dc,pgp]`:

- Reads the dataset via the adapter, opens the DB with the existing
  `folio_backend.db.connect`, and calls `ingest_scriptures()` once per selected
  volume.
- Prints a per-volume summary (book id, chapters, blocks; or "already present"
  when the hash matched).
- Run **on the hub machine while it holds the write-lease** — the DB's
  single-writer lease is enforced identically everywhere, so an import from a
  spoke would be rejected. This is a one-time admin op, so it is a CLI, not an
  HTTP endpoint (the EPUB `POST /books` path is for interactive uploads).

## Error handling

- **Missing/unreadable dataset:** the CLI fails fast with a clear message; no
  partial DB writes (the ingester commits once at the end, per volume).
- **Malformed volume (empty books/verses):** the adapter validates shape and
  raises before any insert; a volume with zero verses is an error, not a silent
  empty book.
- **Re-run / partial prior run:** `source_hash` dedup makes a completed volume a
  no-op. Because each volume commits once, a crash mid-import leaves earlier
  volumes committed and the failed one absent — safe to re-run.
- **Lease not held:** the write fails with the backend's existing lease error;
  the CLI surfaces it and exits non-zero.

## Testing

`backend/tests/test_ingest_scriptures.py`, following `test_ingest.py` patterns
(in-memory / temp SQLite via the existing test helpers):

- **Fixture** — a tiny hand-written `Volume` (2 books, 2 chapters each, 3 verses
  each) — the ingester takes normalized data, so no dataset download is needed.
- Asserts: correct `books` / `chapters` / `blocks` counts; chapter titles equal
  `"<book> <n>"`; block text is verse-number-prefixed; `order_idx` is
  contiguous and monotonic.
- **Idempotency:** calling `ingest_scriptures` twice returns the same `book_id`
  and does not duplicate blocks.
- **FTS:** a distinctive fixture word is findable via the search path.
- A small adapter test against a checked-in trimmed sample of the real dataset
  format (a few chapters), asserting the D&C-section and single-chapter-work
  naming quirks are handled.

## Study workflow (the payoff — no import code)

Per topic, entirely via existing tools:

1. `folio_search` across a volume for a distinctive keyword (single-keyword FTS).
2. `folio_create_passage` on each key verse-block.
3. `folio_add_tag` (e.g. `#faith`) to group them.
4. `folio_link_passages` to connect related verses, with a linking note.
5. `folio_add_note` to record the topical insight.

## Deferred follow-ups (separate specs)

1. **Modern translation** — one of NRSV / ESV / NIV / NKJV / NLT / NIrV. All are
   copyrighted; needs a license-compatible source (ESV and NLT have the
   friendliest free personal-use APIs; NRSV is the scholars' pick but harder).
   Slots into `ingest_scriptures` as a 5th `Volume` with no ingester changes.
2. **On-demand lookup helper** — a thin wrapper over `api.nephi.org/scriptures/?q=...`
   for pulling a passage live during study, where its query API is the right tool.

## Out of scope

- Chapter summaries / headnotes / footnotes / Topical Guide / cross-references
  (copyrighted study helps; and the raw-text-only decision).
- Nested chapters (volume → book → chapter tree).
- One-folio-book-per-scripture-book layout.
- Any HTTP ingestion endpoint for scripture.
