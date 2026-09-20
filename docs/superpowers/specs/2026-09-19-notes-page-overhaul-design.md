# Notes page overhaul (workstream C)

Date: 2026-09-19
Repo: `folio` (backend + frontend)
Branch/PR: continues on `dev/editable-summaries` (PR #9), on top of workstream A.

## Problem

With the standard works loaded, the Notes page (`NotesView`) is hard to navigate and slow:

- It renders a `SummaryEditor` for **every chapter** (1,189 for the Bible).
- It pulls **every block in the book** (`api.getBlocks(id)`, ~31k rows) just to compute passage
  previews and chapter mapping, and fires **one `getLinks` request per passage**.
- Annotations are a flat list with a button-row tag filter and no search.

## Goals

1. **Tabs** — separate **Summaries** and **Notes & Annotations**.
2. **Fuzzy search** across annotations (preview, note bodies, tag names, chapter title).
3. **Tag picker** — multi-select (OR), replacing the button row.
4. **Navigable summaries** — show the book summary + only chapters that *have* a summary, plus
   an "add summary to a chapter" picker. No more 1,189 empty editors.
5. **Chapter grouping** for annotations (collapsible per-chapter sections).
6. **Perf** — stop pulling all blocks and stop per-passage link requests.

## Design

### Backend enrichment (removes the whole-book pull)

`list_book_passages` returns plain dicts (no `response_model`), so add fields directly:

- **`preview`** — the start block's text sliced `[start_off : start_off+200]` (server-side; a
  100-char-ish preview needs only the start block, so no cross-block join).
- **`chapter_id`** — the start block's `chapter_id`.
- **`link_count`** — `COUNT(*)` of `passage_links` where `from_passage = pid OR to_passage = pid`
  (matches the bidirectional `get_links`).

`book_toc` (`response_model=list[ChapterOut]`): add **`first_block_id`** per chapter
(`SELECT id FROM blocks WHERE chapter_id = c.id ORDER BY order_idx LIMIT 1`), so the client can
build the "jump to chapter" link without any blocks. `ChapterOut` gains
`first_block_id: Optional[int] = None`.

With these, `NotesView` no longer calls `getBlocks` at all, and no longer calls `getLinks`
per passage — the two sources of the sluggishness.

### Frontend data layer

- `client.ts`: `PassageDetail` gains `preview: string`, `chapter_id: number | null`,
  `link_count: number`; `Chapter` gains `first_block_id: number | null`.
- `NotesView.load()` drops `getBlocks` and the `getLinks` fan-out; `preview`, `chapter_id`,
  `link_count` come from `listPassages`; the chapter jump link uses `chapter.first_block_id`.
  `passageText` is no longer used by `NotesView` (left in place for the reader).

### Frontend UX (`NotesView`)

- **Tabs:** a `role="tablist"` with **Summaries** / **Notes** (state `tab`, default Notes).
  Persist the choice in `localStorage` (best-effort, try/catch).
- **Summaries tab:** the book `SummaryEditor` (from A) + a `SummaryEditor` for each chapter that
  **has** a summary (filter `chapters` to those whose id appears in a chapter summary's
  `scope_id`). An **"Add summary to chapter"** control: a searchable `<select>`/combobox of
  chapters without a summary; picking one reveals an editor that creates a chapter summary.
- **Notes tab:**
  - A **search** `<input>` (fuzzy) — filters passages by matching `preview`, any note body, any
    tag name, or the passage's chapter title.
  - A **tag picker** — multi-select checkboxes/chips of all tag names (with counts); selecting
    tags narrows to passages having **any** selected tag (OR). Replaces the button row.
  - **Chapter grouping:** the filtered passages grouped by `chapter_id`, each group a
    collapsible `<details>` titled by the chapter title (linking to `first_block_id`), ordered by
    chapter `order_idx`. Passages with no chapter fall under an "Unassigned" group.
  - Each passage row keeps today's content: preview, highlight dots, tag chips, notes (Markdown),
    `link_count` line, "Open in reader".
- **Fuzzy matcher:** a small `fuzzy.ts` util — case-insensitive subsequence match with a simple
  score (consecutive-run bonus); `fuzzyMatch(query, text) -> boolean`. Client-side over the
  loaded (now-small) annotation set; no backend search dependency.

## Testing

- **Backend:** `list_book_passages` returns `preview`/`chapter_id`/`link_count`;
  `book_toc` returns `first_block_id`.
- **Frontend:** `fuzzy.ts` unit tests; `NotesView` — tab switch shows summaries vs notes; search
  narrows rows; tag picker (multi) narrows rows; annotations are grouped by chapter; the
  Summaries tab shows only chapters with a summary + the add-to-chapter picker; no `getBlocks`
  call is made.

## Non-goals

- Backend FTS-backed search (client-side fuzzy is enough at this scale).
- Virtualized lists (grouping + filtering keep the DOM small enough for now).
- Changes to the reader, or to workstream A's editing behavior (reused as-is).

## Delivery

Commits continue on `dev/editable-summaries`; PR #9 is updated to cover A + C. No merge — left
for the user (workspace-development policy). Deploy only when the user merges and asks.
