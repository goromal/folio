# Editable Summaries — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users edit existing summaries in place (like notes), including agent-generated ones, which relabel to user summaries when edited.

**Architecture:** Add `PUT /summaries/{id}` (mirroring `PUT /notes/{id}`), an `updateSummary` client method, and rework `SummaryEditor` to the notes-style Markdown-with-Edit-button model. No schema change.

**Tech Stack:** FastAPI/SQLite backend (`unittest`); React + Vitest frontend.

**Spec:** `docs/superpowers/specs/2026-09-19-editable-summaries-design.md`

---

## Background

- Notes model to mirror: `store.update_note` (`store.py:48`), `PUT /notes/{note_id}` (`app.py:140`), and the inline note editor in `PassagePanel.tsx` (Markdown + Edit → textarea + Save/Cancel).
- Summaries today: `store.create_summary`/`get_summaries`/`delete_summary`; endpoints `POST /summaries`, `GET /summaries`, `DELETE /summaries/{id}`; `SummaryEditor` in `NotesView.tsx` fakes edit via delete+recreate and shows agent summaries read-only.
- Summaries table columns: `id, scope, scope_id, body, generated_by, created_at` (no `updated_at`).
- Backend tests: `nix-shell -p 'python3.withPackages(ps: with ps; [ fastapi uvicorn pydantic httpx werkzeug python-multipart starlette ebooklib beautifulsoup4 ])' --run '<cmd>'`.
- Frontend tests: from `frontend/`, `node_modules/.bin/vitest run <file>` (node 22 + vitest present).

## File structure

- `backend/folio_backend/models.py` — add `SummaryUpdate`.
- `backend/folio_backend/store.py` — add `update_summary`.
- `backend/folio_backend/app.py` — add `PUT /summaries/{summary_id}`.
- `backend/tests/test_api_summary_update.py` — new backend test.
- `frontend/src/api/client.ts` — add `updateSummary`.
- `frontend/src/notesview/NotesView.tsx` — rework `SummaryEditor` + its wiring.
- `frontend/src/notesview/NotesView.test.tsx` — update summary tests.
- `frontend/src/notesview/NotesView.module.css` — minor classes if needed (reuse existing where possible).

---

### Task 1: Backend `PUT /summaries/{id}`

**Goal:** Update a summary's body in place, optionally relabeling `generated_by`.

**Files:**
- Modify: `backend/folio_backend/models.py`, `store.py`, `app.py`
- Create: `backend/tests/test_api_summary_update.py`

**Acceptance Criteria:**
- [ ] `PUT /summaries/{id}` with `{body}` updates the row's body in place (same id, `GET` reflects it), returns `{"id": id}`.
- [ ] `PUT` with `{body, generated_by: "user"}` relabels an agent summary to user.
- [ ] Existing suite still passes.

**Verify:** `nix-shell -p 'python3.withPackages(ps: with ps; [ fastapi uvicorn pydantic httpx werkzeug python-multipart starlette ebooklib beautifulsoup4 ])' --run 'python -m unittest tests.test_api_summary_update -v && python -m unittest discover -s tests'` → OK

**Steps:**

- [ ] **Step 1: Write the failing test** — `backend/tests/test_api_summary_update.py`

```python
import unittest

from fastapi.testclient import TestClient

from folio_backend.app import create_app
from tests.helpers import temp_db


class SummaryUpdateApiTest(unittest.TestCase):
    def setUp(self):
        self.conn, self.db_path = temp_db()
        self.client = TestClient(create_app(self.db_path))

    def _rows(self, scope, scope_id):
        return self.client.get(f"/summaries?scope={scope}&scope_id={scope_id}").json()

    def test_put_updates_body_in_place(self):
        sid = self.client.post(
            "/summaries", json={"scope": "book", "scope_id": 1, "body": "first"}
        ).json()["id"]
        r = self.client.put(f"/summaries/{sid}", json={"body": "second"})
        self.assertEqual(r.status_code, 200)
        rows = self._rows("book", 1)
        self.assertEqual([row["id"] for row in rows], [sid])
        self.assertEqual(rows[0]["body"], "second")
        self.assertEqual(rows[0]["generated_by"], "user")

    def test_put_relabels_agent_to_user(self):
        sid = self.client.post(
            "/summaries",
            json={"scope": "book", "scope_id": 1, "body": "a", "generated_by": "agent"},
        ).json()["id"]
        self.client.put(f"/summaries/{sid}", json={"body": "edited", "generated_by": "user"})
        rows = self._rows("book", 1)
        self.assertEqual(rows[0]["generated_by"], "user")
        self.assertEqual(rows[0]["body"], "edited")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run it, confirm it FAILS** (405/404 for PUT, or the relabel assertion fails).

- [ ] **Step 3: Implement.**

In `models.py`, add after `SummaryIn`:
```python
class SummaryUpdate(BaseModel):
    body: str
    generated_by: str | None = None
```

In `store.py`, add after `create_summary`/`get_summaries`:
```python
def update_summary(conn, summary_id, body, generated_by=None):
    if generated_by is None:
        conn.execute("UPDATE summaries SET body = ? WHERE id = ?", (body, summary_id))
    else:
        conn.execute(
            "UPDATE summaries SET body = ?, generated_by = ? WHERE id = ?",
            (body, generated_by, summary_id))
    conn.commit()
```

In `app.py`, import `SummaryUpdate` (add it to the `from folio_backend.models import (...)` list), and add the endpoint next to `create_summary_ep`/`list_summaries_ep`:
```python
    @app.put("/summaries/{summary_id}", status_code=200)
    def update_summary_ep(summary_id: int, s: SummaryUpdate, conn=Depends(db)):
        store.update_summary(conn, summary_id, s.body, s.generated_by)
        return {"id": summary_id}
```

- [ ] **Step 4: Run the module test + full suite; confirm OK.**

- [ ] **Step 5: Commit**

```bash
git add folio_backend/models.py folio_backend/store.py folio_backend/app.py tests/test_api_summary_update.py
git commit -m "feat(summaries): add PUT /summaries/{id} for in-place edit + relabel

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Frontend editable summaries UI

**Goal:** Rework `SummaryEditor` to edit summaries in place (Markdown + Edit → textarea), make agent summaries editable (relabel to user on save), and add new summaries via a create control.

**Files:**
- Modify: `frontend/src/api/client.ts`, `frontend/src/notesview/NotesView.tsx`, `frontend/src/notesview/NotesView.test.tsx`, `frontend/src/notesview/NotesView.module.css` (as needed)

**Acceptance Criteria:**
- [ ] Editing an existing summary calls `api.updateSummary(id, body)` (not delete+create) and preserves its id.
- [ ] Editing an agent summary calls `api.updateSummary(id, body, 'user')`.
- [ ] The Add control calls `api.createSummary(scope, scopeId, body)`.
- [ ] All NotesView tests pass; full frontend suite passes.

**Verify:** from `frontend/`: `node_modules/.bin/vitest run src/notesview/NotesView.test.tsx` then `node_modules/.bin/vitest run` → all pass.

**Steps:**

- [ ] **Step 1: Update the tests** — `frontend/src/notesview/NotesView.test.tsx`

Add `updateSummary` to the `api` mock object (line ~17) and, in `beforeEach`, `(api.updateSummary as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1 });`.

**Remove** the tests `saving the book summary replaces + recreates` and `an existing user summary prefills the editor after load`. **Add** these:

```tsx
test('adding a book summary creates it', async () => {
  renderNotes();
  await screen.findByText('The quick');
  await userEvent.type(screen.getByLabelText('Book summary'), 'the gist');
  await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);
  await waitFor(() => expect(api.createSummary).toHaveBeenCalledWith('book', 7, 'the gist'));
});

test('editing an existing summary updates it in place', async () => {
  (api.listBookSummaries as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: 9, scope: 'book', scope_id: 7, body: 'saved gist', generated_by: 'user', created_at: '' },
  ]);
  renderNotes();
  await screen.findByText('saved gist');
  await userEvent.click(screen.getAllByRole('button', { name: 'Edit summary' })[0]);
  const box = screen.getByLabelText('Edit summary');
  await userEvent.clear(box);
  await userEvent.type(box, 'new gist');
  await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);
  await waitFor(() => expect(api.updateSummary).toHaveBeenCalledWith(9, 'new gist', undefined));
});

test('editing an agent summary relabels it to user', async () => {
  (api.listBookSummaries as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: 12, scope: 'book', scope_id: 7, body: 'agent gist', generated_by: 'agent', created_at: '' },
  ]);
  renderNotes();
  await screen.findByText('agent gist');
  await userEvent.click(screen.getAllByRole('button', { name: 'Edit summary' })[0]);
  const box = screen.getByLabelText('Edit summary');
  await userEvent.clear(box);
  await userEvent.type(box, 'my version');
  await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);
  await waitFor(() => expect(api.updateSummary).toHaveBeenCalledWith(12, 'my version', 'user'));
});
```

- [ ] **Step 2: Run the NotesView test, confirm it FAILS** (`api.updateSummary` undefined / old UI).

- [ ] **Step 3: Implement.**

In `client.ts`, add after `createSummary` (line ~118):
```ts
  updateSummary: (id: number, body: string, generatedBy?: string) =>
    req<{ id: number }>(`/summaries/${id}`, jsonInit('PUT', { body, generated_by: generatedBy })),
```

In `NotesView.tsx`, replace the `saveSummary` function (lines ~94–107) with two handlers:
```tsx
  async function createSummaryFor(scope: 'book' | 'chapter', scopeId: number, body: string): Promise<boolean> {
    try {
      await api.createSummary(scope, scopeId, body.trim());
      await load();
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  }

  async function updateSummaryBody(id: number, body: string, generatedBy?: string): Promise<boolean> {
    try {
      await api.updateSummary(id, body.trim(), generatedBy);
      await load();
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  }
```

Update the two `<SummaryEditor .../>` usages to pass the new props (book and chapter):
```tsx
        <SummaryEditor
          label="Book summary"
          summaries={summaries.filter((s) => s.scope === 'book' && s.scope_id === id)}
          onCreate={(body) => createSummaryFor('book', id, body)}
          onUpdate={updateSummaryBody}
        />
```
```tsx
            <SummaryEditor
              key={c.id}
              label={label}
              summaries={summaries.filter((s) => s.scope === 'chapter' && s.scope_id === c.id)}
              onCreate={(body) => createSummaryFor('chapter', c.id, body)}
              onUpdate={updateSummaryBody}
            />
```

Replace the `SummaryEditor` component (lines ~205–259) with:
```tsx
function SummaryEditor({
  label,
  summaries,
  onCreate,
  onUpdate,
}: {
  label: ReactNode;
  summaries: Summary[];
  onCreate: (body: string) => Promise<boolean>;
  onUpdate: (id: number, body: string, generatedBy?: string) => Promise<boolean>;
}) {
  const headingId = useId();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingBody, setEditingBody] = useState('');
  const [draft, setDraft] = useState('');
  const [saved, setSaved] = useState(false);

  return (
    <div className={styles.summary}>
      <h3 id={headingId} className={styles.summaryLabel}>{label}</h3>
      <ul className={styles.summaryList}>
        {summaries.map((s) =>
          editingId === s.id ? (
            <li key={s.id} className={styles.agentSummary}>
              <textarea
                aria-label="Edit summary"
                className={styles.summaryText}
                value={editingBody}
                onChange={(e) => setEditingBody(e.target.value)}
              />
              <div className={styles.summaryActions}>
                <button
                  className={styles.open}
                  onClick={async () => {
                    const body = editingBody.trim();
                    if (body) {
                      await onUpdate(s.id, body, s.generated_by !== 'user' ? 'user' : undefined);
                    }
                    setEditingId(null);
                  }}
                >
                  Save
                </button>
                <button className={styles.open} onClick={() => setEditingId(null)}>
                  Cancel
                </button>
              </div>
            </li>
          ) : (
            <li key={s.id} className={styles.agentSummary}>
              {s.generated_by !== 'user' && <span className={styles.badge}>agent</span>}
              <Markdown>{s.body}</Markdown>
              <button
                aria-label="Edit summary"
                className={styles.open}
                onClick={() => {
                  setEditingId(s.id);
                  setEditingBody(s.body);
                }}
              >
                Edit
              </button>
            </li>
          ),
        )}
      </ul>
      <textarea
        aria-labelledby={headingId}
        className={styles.summaryText}
        placeholder="Add a summary…"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setSaved(false);
        }}
      />
      <div className={styles.summaryActions}>
        <button
          className={styles.open}
          onClick={async () => {
            const body = draft.trim();
            if (body && (await onCreate(body))) {
              setDraft('');
              setSaved(true);
            }
          }}
        >
          Save
        </button>
        {saved && (
          <span className={styles.saved} role="status">Saved ✓</span>
        )}
      </div>
    </div>
  );
}
```

Add a `.summaryList` class to `NotesView.module.css` if desired (e.g. `list-style:none; padding:0; margin:0;`); the other classes (`summary`, `summaryLabel`, `summaryText`, `summaryActions`, `agentSummary`, `badge`, `open`, `saved`) already exist.

- [ ] **Step 4: Run the NotesView test then the full frontend suite; confirm all pass.**

- [ ] **Step 5: Commit**

```bash
git add src/api/client.ts src/notesview/NotesView.tsx src/notesview/NotesView.test.tsx src/notesview/NotesView.module.css
git commit -m "feat(summaries): edit summaries in place, incl. agent summaries (relabel to user)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-review (author checklist — done)

- **Spec coverage:** `PUT /summaries/{id}` + store + model (Task 1) ✓; in-place edit replacing delete+recreate, agent-editable + relabel, Add control, `updateSummary` client (Task 2) ✓; no schema/`updated_at` change ✓; MCP untouched ✓.
- **Placeholders:** none — full code and test code throughout.
- **Type/name consistency:** `SummaryUpdate{body, generated_by}` ↔ `update_summary(conn, id, body, generated_by=None)` ↔ `PUT /summaries/{id}` ↔ `updateSummary(id, body, generatedBy?)` ↔ `SummaryEditor` `onUpdate(id, body, generatedBy?)`; relabel passes `'user'` only for agent rows.

## Deferred (workstream C, separate)

Notes-page overhaul: tabs (summaries vs notes), fuzzy search, tag picker, chapter grouping, and the payload/perf fix (stop pulling every block; batch link fetches).
