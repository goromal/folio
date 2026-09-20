# Notes Page Overhaul (workstream C) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Notes page navigable and fast for large volumes: tabs (summaries vs notes), fuzzy search, multi-select tag picker, chapter grouping, summaries only for chapters that have them, and a backend enrichment that removes the whole-book block pull and per-passage link requests.

**Architecture:** Enrich `list_book_passages` (preview, chapter_id, link_count) and `book_toc` (first_block_id) so the client stops calling `getBlocks`/`getLinks`; then rewrite `NotesView` into a tabbed, searchable, grouped view. Reuses workstream A's `SummaryEditor` unchanged.

**Tech Stack:** FastAPI/SQLite (`unittest`); React + Vitest.

**Spec:** `docs/superpowers/specs/2026-09-19-notes-page-overhaul-design.md`
**Branch:** continue on `dev/editable-summaries` (PR #9), on top of A. Do NOT merge — leave PR #9 for the user.

## Background

- `list_book_passages` (`app.py:192`) returns plain dicts (no response_model) → safe to add keys. `book_toc` (`app.py:71`) uses `response_model=list[ChapterOut]` → extend the model.
- `store.get_links` is bidirectional (from OR to), so `link_count` counts `passage_links` where the passage is either end.
- Current `NotesView` pulls `getBlocks(id)` (all blocks) for previews + chapter mapping and `getLinks(p.id)` per passage; both go away.
- Workstream A's `SummaryEditor` (Markdown + Edit + Add, agent relabel) stays as-is; C only changes how/where it's rendered.
- Backend tests: `nix-shell -p 'python3.withPackages(ps: with ps; [ fastapi uvicorn pydantic httpx werkzeug python-multipart starlette ebooklib beautifulsoup4 websockets ])' --run '<cmd>'` (include `websockets` — the terminal-proxy tests live on this branch via main). Frontend: from `frontend/`, `node_modules/.bin/vitest run` (Node 22; if `node` isn't on PATH, run via `nix-shell -p nodejs_22 --run '...'`).

## File structure

- `backend/folio_backend/app.py` — enrich `list_book_passages` + `book_toc`.
- `backend/folio_backend/models.py` — `ChapterOut.first_block_id`.
- `backend/tests/test_notes_page_enrichment.py` — new.
- `frontend/src/notesview/fuzzy.ts` (+ `fuzzy.test.ts`) — new.
- `frontend/src/api/client.ts` — extend `PassageDetail` + `Chapter` types.
- `frontend/src/notesview/NotesView.tsx` — rewrite the main component (keep `SummaryEditor`).
- `frontend/src/notesview/NotesView.test.tsx` — rewrite for the new UI.
- `frontend/src/notesview/NotesView.module.css` — add classes.

---

### Task 1: Backend enrichment

**Goal:** `list_book_passages` returns `preview`, `chapter_id`, `link_count`; `book_toc` returns `first_block_id`.

**Files:** Modify `app.py`, `models.py`; Create `tests/test_notes_page_enrichment.py`.

**Acceptance Criteria:**
- [ ] Each passage from `GET /books/{id}/passages` has `preview` (start-block text from `start_off`, ≤200 chars), `chapter_id` (start block's chapter), and `link_count`.
- [ ] Each chapter from `GET /books/{id}/toc` has `first_block_id` (first block by order_idx, or null).
- [ ] Existing suite passes.

**Verify:** `nix-shell -p 'python3.withPackages(ps: with ps; [ fastapi uvicorn pydantic httpx werkzeug python-multipart starlette ebooklib beautifulsoup4 websockets ])' --run 'python -m unittest tests.test_notes_page_enrichment -v && python -m unittest discover -s tests'` → OK

**Steps:**

- [ ] **Step 1: Failing test** — `backend/tests/test_notes_page_enrichment.py`

```python
import unittest

from fastapi.testclient import TestClient

from folio_backend import store
from folio_backend.app import create_app
from tests.helpers import temp_db


class NotesPageEnrichmentTest(unittest.TestCase):
    def setUp(self):
        self.conn, self.db_path = temp_db()
        # book/chapter/blocks
        self.conn.execute("INSERT INTO books (title, source_hash, created_at) VALUES ('B','h','t')")
        self.book = self.conn.execute("SELECT id FROM books").fetchone()["id"]
        self.conn.execute(
            "INSERT INTO chapters (book_id, title, order_idx) VALUES (?,?,0)", (self.book, "Ch1"))
        self.chap = self.conn.execute("SELECT id FROM chapters").fetchone()["id"]
        self.conn.execute(
            "INSERT INTO blocks (book_id, chapter_id, order_idx, type, text) VALUES (?,?,0,'para',?)",
            (self.book, self.chap, "Hello world, this is the passage text."))
        self.block = self.conn.execute("SELECT id FROM blocks").fetchone()["id"]
        self.conn.commit()
        p1 = store.create_passage(self.conn, self.book, self.block, 0, self.block, 20000)
        p2 = store.create_passage(self.conn, self.book, self.block, 0, self.block, 20000)
        store.link_passages(self.conn, p1, p2, note="rel")
        self.p1 = p1
        self.client = TestClient(create_app(self.db_path))

    def test_passages_enriched(self):
        rows = self.client.get(f"/books/{self.book}/passages").json()
        row = next(r for r in rows if r["id"] == self.p1)
        self.assertTrue(row["preview"].startswith("Hello world"))
        self.assertLessEqual(len(row["preview"]), 200)
        self.assertEqual(row["chapter_id"], self.chap)
        self.assertEqual(row["link_count"], 1)

    def test_toc_has_first_block(self):
        toc = self.client.get(f"/books/{self.book}/toc").json()
        self.assertEqual(toc[0]["first_block_id"], self.block)


if __name__ == "__main__":
    unittest.main()
```
(Confirm `store.create_passage(conn, book_id, start_block, start_off, end_block, end_off)` and `store.link_passages(conn, from, to, note=)` signatures against `store.py` before running; adjust the calls if the arg order differs.)

- [ ] **Step 2: Run, confirm FAIL** (KeyError preview/chapter_id/link_count; toc lacks first_block_id).

- [ ] **Step 3: Implement.**

`models.py` — `ChapterOut` gains a field:
```python
class ChapterOut(BaseModel):
    id: int
    title: str
    order_idx: int
    parent_id: Optional[int] = None
    first_block_id: Optional[int] = None
```

`app.py` `book_toc` — select the first block per chapter:
```python
    @app.get("/books/{book_id}/toc", response_model=list[ChapterOut])
    def book_toc(book_id: int, conn=Depends(db)):
        rows = conn.execute(
            "SELECT id, title, order_idx, parent_id, "
            "(SELECT id FROM blocks WHERE chapter_id = chapters.id "
            " ORDER BY order_idx LIMIT 1) AS first_block_id "
            "FROM chapters WHERE book_id = ? ORDER BY order_idx", (book_id,)).fetchall()
        if not rows:
            exists = conn.execute("SELECT 1 FROM books WHERE id = ?", (book_id,)).fetchone()
            if not exists:
                raise HTTPException(status_code=404, detail="book not found")
        return [dict(r) for r in rows]
```
(Preserve the existing 404-on-unknown-book behavior; splice the subquery into the existing handler, keeping its current not-found handling.)

`app.py` `list_book_passages` — enrich each passage:
```python
    @app.get("/books/{book_id}/passages")
    def list_book_passages(book_id: int, conn=Depends(db)):
        prows = conn.execute(
            "SELECT * FROM passages WHERE book_id = ? ORDER BY id", (book_id,)).fetchall()
        result = []
        for p in prows:
            pid = p["id"]
            highlights = conn.execute(
                "SELECT id, color FROM highlights WHERE passage_id = ? ORDER BY id",
                (pid,)).fetchall()
            notes = conn.execute(
                "SELECT id, body, created_at, updated_at FROM notes "
                "WHERE passage_id = ? ORDER BY id", (pid,)).fetchall()
            tags = store.get_passage_tags(conn, pid)
            sb = conn.execute(
                "SELECT chapter_id, text FROM blocks WHERE id = ?", (p["start_block"],)).fetchone()
            link_count = conn.execute(
                "SELECT COUNT(*) c FROM passage_links "
                "WHERE from_passage = ? OR to_passage = ?", (pid, pid)).fetchone()["c"]
            d = dict(p)
            d["highlights"] = [dict(h) for h in highlights]
            d["notes"] = [dict(n) for n in notes]
            d["tags"] = [dict(t) for t in tags]
            d["chapter_id"] = sb["chapter_id"] if sb else None
            d["preview"] = (sb["text"][p["start_off"]:p["start_off"] + 200] if sb else "")
            d["link_count"] = link_count
            result.append(d)
        return result
```

- [ ] **Step 4: Run module test + full suite; confirm OK.**
- [ ] **Step 5: Commit**
```bash
git add folio_backend/app.py folio_backend/models.py tests/test_notes_page_enrichment.py
git commit -m "feat(notes): enrich passages (preview/chapter/link_count) + toc first_block_id

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Frontend Notes page overhaul

**Goal:** Rewrite `NotesView` into a tabbed (Summaries / Notes), searchable, tag-filtered, chapter-grouped view fed by the enriched endpoints (no `getBlocks`/`getLinks`). Summaries tab shows the book summary + only chapters that have a summary, plus an add-to-chapter picker. Reuse workstream A's `SummaryEditor` unchanged.

**Files:** Modify `frontend/src/api/client.ts`, `frontend/src/notesview/NotesView.tsx`, `frontend/src/notesview/NotesView.test.tsx`, `frontend/src/notesview/NotesView.module.css`; Create `frontend/src/notesview/fuzzy.ts` + `frontend/src/notesview/fuzzy.test.ts`.

**Acceptance Criteria:**
- [ ] `load()` calls only `getToc`, `listPassages`, `listBookSummaries` — **never `getBlocks`**, and no per-passage `getLinks`.
- [ ] Tabs switch between Summaries and Notes (default Notes).
- [ ] Search narrows annotation rows (fuzzy); the tag picker (multi-select, OR) narrows rows; annotations are grouped by chapter.
- [ ] Summaries tab renders the book summary + only chapters that have a summary, and an "Add summary to chapter" select of chapters without one.
- [ ] Editing behavior from A still works (edit in place; agent relabel; add). Full frontend suite + `npm run build` pass.

**Verify:** from `frontend/`: `node_modules/.bin/vitest run src/notesview/` then `node_modules/.bin/vitest run` and `npm run build` → all pass.

**Steps:**

- [ ] **Step 1: Write `fuzzy.ts` + its test.**

`frontend/src/notesview/fuzzy.ts`:
```ts
/** Case-insensitive subsequence match: every char of `query` appears in `text` in order. */
export function fuzzyMatch(query: string, text: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const t = text.toLowerCase();
  let i = 0;
  for (let j = 0; j < t.length && i < q.length; j++) {
    if (t[j] === q[i]) i++;
  }
  return i === q.length;
}
```
`frontend/src/notesview/fuzzy.test.ts`:
```ts
import { expect, test } from 'vitest';
import { fuzzyMatch } from './fuzzy';

test('empty query matches anything', () => expect(fuzzyMatch('', 'abc')).toBe(true));
test('subsequence matches', () => expect(fuzzyMatch('brwn', 'the quick brown fox')).toBe(true));
test('out-of-order does not match', () => expect(fuzzyMatch('nworb', 'brown')).toBe(false));
test('missing chars do not match', () => expect(fuzzyMatch('xyz', 'abc')).toBe(false));
test('case-insensitive', () => expect(fuzzyMatch('FOX', 'the fox')).toBe(true));
```

- [ ] **Step 2: Extend client types** — in `frontend/src/api/client.ts`, add to the `PassageDetail` interface: `preview: string; chapter_id: number | null; link_count: number;`, and to the `Chapter` type add `first_block_id: number | null` (if `Chapter` is `components['schemas']['ChapterOut']` from generated types, run `npm run gen-api` after Task 1 is built, or add an intersection type `export type Chapter = components['schemas']['ChapterOut'] & { first_block_id: number | null }` — prefer regenerating).

- [ ] **Step 3: Rewrite `NotesView.tsx`** — replace the `NotesView` component (keep the `SummaryEditor` component from workstream A at the bottom of the file unchanged). New component:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { api, subscribeEvents, type Chapter, type PassageDetail, type Summary } from '../api/client';
import { Markdown } from '../markdown/Markdown';
import { fuzzyMatch } from './fuzzy';
import styles from './NotesView.module.css';

type Tab = 'summaries' | 'notes';
const TAB_KEY = 'folio.notesTab';

export function NotesView() {
  const { bookId } = useParams();
  const id = Number(bookId);
  const navigate = useNavigate();

  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [passages, setPassages] = useState<PassageDetail[]>([]);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [tab, setTab] = useState<Tab>(() => {
    try { return (localStorage.getItem(TAB_KEY) as Tab) || 'notes'; } catch { return 'notes'; }
  });
  const [query, setQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [addChapter, setAddChapter] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [toc, ps, sums] = await Promise.all([
        api.getToc(id), api.listPassages(id), api.listBookSummaries(id),
      ]);
      setChapters(toc); setPassages(ps); setSummaries(sums);
    } catch (e) { setError(String(e)); }
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = subscribeEvents((e) => {
      if (e.type === 'changed') { clearTimeout(t); t = setTimeout(() => { void load(); }, 300); }
    });
    return () => { clearTimeout(t); off(); };
  }, [load]);

  function selectTab(next: Tab) {
    setTab(next);
    try { localStorage.setItem(TAB_KEY, next); } catch { /* ignore */ }
  }
  const chapterTitle = useCallback(
    (cid: number | null) => chapters.find((c) => c.id === cid)?.title ?? null, [chapters]);

  async function createSummaryFor(scope: 'book' | 'chapter', scopeId: number, body: string): Promise<boolean> {
    try { await api.createSummary(scope, scopeId, body.trim()); await load(); return true; }
    catch (e) { setError(String(e)); return false; }
  }
  async function updateSummaryBody(sid: number, body: string, generatedBy?: string): Promise<boolean> {
    try { await api.updateSummary(sid, body.trim(), generatedBy); await load(); return true; }
    catch (e) { setError(String(e)); return false; }
  }
  function openInReader(p: PassageDetail) {
    navigate(`/book/${id}?focus=${p.start_block}${p.chapter_id != null ? `&ch=${p.chapter_id}` : ''}`);
  }
  function toggleTag(name: string) {
    setSelectedTags((cur) => cur.includes(name) ? cur.filter((t) => t !== name) : [...cur, name]);
  }

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    passages.forEach((p) => p.tags.forEach((t) => counts.set(t.name, (counts.get(t.name) ?? 0) + 1)));
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [passages]);

  const shown = useMemo(() => passages.filter((p) => {
    if (selectedTags.length && !p.tags.some((t) => selectedTags.includes(t.name))) return false;
    if (query.trim()) {
      const hay = [p.preview, ...p.notes.map((n) => n.body), ...p.tags.map((t) => t.name),
                   chapterTitle(p.chapter_id) ?? ''].join(' \n ');
      if (!fuzzyMatch(query, hay)) return false;
    }
    return true;
  }), [passages, selectedTags, query, chapterTitle]);

  const groups = useMemo(() => {
    const order = new Map(chapters.map((c, i) => [c.id, i] as const));
    const byChapter = new Map<number | null, PassageDetail[]>();
    shown.forEach((p) => {
      const k = p.chapter_id ?? null;
      if (!byChapter.has(k)) byChapter.set(k, []);
      byChapter.get(k)!.push(p);
    });
    return [...byChapter.entries()].sort((a, b) => {
      const ai = a[0] == null ? Infinity : (order.get(a[0]) ?? Infinity);
      const bi = b[0] == null ? Infinity : (order.get(b[0]) ?? Infinity);
      return ai - bi;
    });
  }, [shown, chapters]);

  const bookSummaries = summaries.filter((s) => s.scope === 'book' && s.scope_id === id);
  const chapterSummaryIds = new Set(
    summaries.filter((s) => s.scope === 'chapter').map((s) => s.scope_id));
  const chaptersWithSummary = chapters.filter((c) => chapterSummaryIds.has(c.id));
  const chaptersWithout = chapters.filter((c) => !chapterSummaryIds.has(c.id));

  return (
    <main className={styles.notesview}>
      <header className={styles.head}>
        <h1>Notes</h1>
        <RouterLink to={`/book/${id}`}>← Back to reader</RouterLink>
      </header>
      {error && <p role="alert">{error}</p>}

      <div role="tablist" className={styles.tabs}>
        <button role="tab" aria-selected={tab === 'notes'}
          className={tab === 'notes' ? styles.tabActive : styles.tab}
          onClick={() => selectTab('notes')}>Notes &amp; Annotations</button>
        <button role="tab" aria-selected={tab === 'summaries'}
          className={tab === 'summaries' ? styles.tabActive : styles.tab}
          onClick={() => selectTab('summaries')}>Summaries</button>
      </div>

      {tab === 'summaries' ? (
        <section>
          <SummaryEditor label="Book summary" summaries={bookSummaries}
            onCreate={(b) => createSummaryFor('book', id, b)} onUpdate={updateSummaryBody} />
          {chaptersWithSummary.map((c) => (
            <SummaryEditor key={c.id}
              label={c.first_block_id != null
                ? <RouterLink to={`/book/${id}?focus=${c.first_block_id}&ch=${c.id}`}>{`Chapter: ${c.title}`}</RouterLink>
                : `Chapter: ${c.title}`}
              summaries={summaries.filter((s) => s.scope === 'chapter' && s.scope_id === c.id)}
              onCreate={(b) => createSummaryFor('chapter', c.id, b)} onUpdate={updateSummaryBody} />
          ))}
          <div className={styles.addChapter}>
            <label>
              Add summary to chapter:{' '}
              <select aria-label="Add summary to chapter" value={addChapter}
                onChange={(e) => setAddChapter(e.target.value ? Number(e.target.value) : '')}>
                <option value="">Select a chapter…</option>
                {chaptersWithout.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </label>
            {addChapter !== '' && (
              <SummaryEditor
                label={`Chapter: ${chapters.find((c) => c.id === addChapter)?.title ?? ''}`}
                summaries={[]}
                onCreate={(b) => createSummaryFor('chapter', addChapter as number, b)}
                onUpdate={updateSummaryBody} />
            )}
          </div>
        </section>
      ) : (
        <section>
          <input className={styles.search} type="search" placeholder="Search notes…"
            aria-label="Search notes" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className={styles.filters}>
            {allTags.map(([name, count]) => (
              <label key={name}
                className={selectedTags.includes(name) ? styles.filterActive : styles.filter}>
                <input type="checkbox" checked={selectedTags.includes(name)}
                  onChange={() => toggleTag(name)} /> {name} ({count})
              </label>
            ))}
          </div>
          {groups.map(([cid, ps]) => (
            <details key={cid ?? 'none'} open className={styles.group}>
              <summary className={styles.groupTitle}>
                {chapterTitle(cid) ?? 'Unassigned'} ({ps.length})
              </summary>
              <ul className={styles.rows}>
                {ps.map((p) => (
                  <li key={p.id} className={styles.row}>
                    <p className={styles.preview}>{p.preview || `passage ${p.id}`}</p>
                    <div className={styles.meta}>
                      {p.highlights.map((h) => (
                        <span key={h.id} className={styles.dot}
                          style={{ background: `var(--hl-${h.color})` }} />
                      ))}
                      {p.tags.map((t) => <span key={t.id} className={styles.tag}>{t.name}</span>)}
                    </div>
                    {p.notes.map((n) => <Markdown key={n.id} className={styles.note}>{n.body}</Markdown>)}
                    {p.link_count > 0 && <p className={styles.linkline}>{p.link_count} link(s)</p>}
                    <button className={styles.open} onClick={() => openInReader(p)}>Open in reader</button>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </section>
      )}
    </main>
  );
}
```
Keep the `SummaryEditor` function (from workstream A) below this, unchanged. Remove now-unused imports (`useId` is still used by `SummaryEditor`; `Link`/`Block`/`passageText` are no longer used by this file — drop those imports). `tsc` (via `npm run build`) will flag any leftover unused import.

- [ ] **Step 4: Add CSS** — in `NotesView.module.css`, add: `.tabs` (flex, gap, margin), `.tab`/`.tabActive` (button styling, active underline/weight), `.search` (full-width input), `.group`/`.groupTitle` (details/summary spacing), `.addChapter` (margin), and `.summaryList` if not already added by A. Reuse existing `.filters/.filter/.filterActive/.rows/.row/.preview/.meta/.dot/.tag/.note/.linkline/.open`.

- [ ] **Step 5: Rewrite `NotesView.test.tsx`** to the new UI. Mock `api` with `getToc, listPassages, listBookSummaries, createSummary, updateSummary` (NO `getBlocks`/`getLinks`) and `subscribeEvents`. `beforeEach` mocks:
```tsx
(api.getToc as ReturnType<typeof vi.fn>).mockResolvedValue([
  { id: 1, title: 'Chapter One', order_idx: 0, parent_id: null, first_block_id: 10 },
]);
(api.listPassages as ReturnType<typeof vi.fn>).mockResolvedValue([
  { id: 5, book_id: 7, start_block: 10, start_off: 0, end_block: 10, end_off: 9,
    preview: 'The quick brown fox', chapter_id: 1, link_count: 1,
    highlights: [{ id: 1, color: 'yellow' }], notes: [{ id: 2, body: 'a note', created_at: '', updated_at: '' }],
    tags: [{ id: 3, name: 'kant' }] },
  { id: 6, book_id: 7, start_block: 10, start_off: 10, end_block: 10, end_off: 15,
    preview: 'ethics preview', chapter_id: 1, link_count: 0,
    highlights: [], notes: [], tags: [{ id: 4, name: 'ethics' }] },
]);
(api.listBookSummaries as ReturnType<typeof vi.fn>).mockResolvedValue([]);
(api.createSummary as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1 });
(api.updateSummary as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1 });
```
Provide these tests (Notes tab is default; summary tests click the Summaries tab first):
```tsx
test('lists annotations grouped by chapter with preview and tags', async () => {
  renderNotes();
  expect(await screen.findByText('The quick brown fox')).toBeInTheDocument();
  expect(screen.getByText(/Chapter One \(2\)/)).toBeInTheDocument();
  expect(screen.getByText('kant', { selector: 'span' })).toBeInTheDocument();
  expect(screen.getByText('a note')).toBeInTheDocument();
});

test('does not fetch all blocks', async () => {
  renderNotes();
  await screen.findByText('The quick brown fox');
  expect((api as Record<string, unknown>).getBlocks).toBeUndefined();
});

test('fuzzy search narrows rows', async () => {
  renderNotes();
  await screen.findByText('The quick brown fox');
  await userEvent.type(screen.getByLabelText('Search notes'), 'ethics');
  expect(screen.queryByText('The quick brown fox')).not.toBeInTheDocument();
  expect(screen.getByText('ethics preview')).toBeInTheDocument();
});

test('tag picker narrows rows', async () => {
  renderNotes();
  await screen.findByText('The quick brown fox');
  await userEvent.click(screen.getByRole('checkbox', { name: /ethics/ }));
  expect(screen.queryByText('The quick brown fox')).not.toBeInTheDocument();
  expect(screen.getByText('ethics preview')).toBeInTheDocument();
});

test('open in reader navigates with focus + chapter', async () => {
  renderNotes();
  await screen.findByText('The quick brown fox');
  await userEvent.click(screen.getAllByRole('button', { name: 'Open in reader' })[0]);
  expect(navigate).toHaveBeenCalledWith('/book/7?focus=10&ch=1');
});

test('summaries tab shows only chapters with a summary + an add picker', async () => {
  (api.listBookSummaries as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: 1, scope: 'book', scope_id: 7, body: 'book gist', generated_by: 'user', created_at: '' },
  ]);
  renderNotes();
  await screen.findByText('The quick brown fox');
  await userEvent.click(screen.getByRole('tab', { name: /Summaries/ }));
  expect(screen.getByText('Book summary')).toBeInTheDocument();
  // Chapter One has no summary -> not shown as an editor, but appears in the add picker
  expect(screen.queryByText('Chapter: Chapter One')).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Add summary to chapter' })).toBeInTheDocument();
});

test('editing an agent summary relabels it to user', async () => {
  (api.listBookSummaries as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: 12, scope: 'book', scope_id: 7, body: 'agent gist', generated_by: 'agent', created_at: '' },
  ]);
  renderNotes();
  await screen.findByText('The quick brown fox');
  await userEvent.click(screen.getByRole('tab', { name: /Summaries/ }));
  await screen.findByText('agent gist');
  await userEvent.click(screen.getAllByRole('button', { name: 'Edit summary' })[0]);
  const box = screen.getByLabelText('Edit summary');
  await userEvent.clear(box); await userEvent.type(box, 'mine');
  await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);
  await waitFor(() => expect(api.updateSummary).toHaveBeenCalledWith(12, 'mine', 'user'));
});
```
Keep the live-sync test (adapted: assert `api.listPassages` is re-called on a `changed` event). Remove tests that referenced blocks/getLinks or the old flat list.

- [ ] **Step 6: Run `node_modules/.bin/vitest run src/notesview/` (fuzzy + NotesView), then the full suite, then `npm run build`; confirm all pass.**

- [ ] **Step 7: Commit**
```bash
git add src/api/client.ts src/notesview/fuzzy.ts src/notesview/fuzzy.test.ts \
  src/notesview/NotesView.tsx src/notesview/NotesView.test.tsx src/notesview/NotesView.module.css
git commit -m "feat(notes): tabs, fuzzy search, tag picker, chapter grouping; drop whole-book pull

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-review (author checklist — done)

- **Spec coverage:** tabs ✓, fuzzy search ✓, multi-select tag picker ✓, chapter grouping ✓, summaries-only-with-content + add-to-chapter ✓, perf (drop getBlocks + per-passage getLinks via preview/chapter_id/link_count/first_block_id) ✓.
- **Placeholders:** none — full code for backend, fuzzy util, component, and tests.
- **Type/name consistency:** `preview`/`chapter_id`/`link_count` (backend dict ↔ `PassageDetail`), `first_block_id` (`ChapterOut` ↔ `Chapter`), `fuzzyMatch`, tab keys, `SummaryEditor` props (`onCreate`/`onUpdate`) match workstream A.
- **Risk note:** if `Chapter`/`PassageDetail` come from generated `schema.d.ts`, regenerate with `npm run gen-api` after Task 1 builds, or intersect the extra fields as noted; the implementer should confirm the generated shape and adjust.

## Delivery

Commits continue on `dev/editable-summaries`; after Task 2, update PR #9 to describe A + C. Do NOT merge — leave PR #9 for the user; deploy only when the user merges and requests it.
