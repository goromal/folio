# Editable summaries

Date: 2026-09-19
Repo: `folio` (backend + frontend)

## Problem

Notes are fully editable in place (`PUT /notes/{id}` + inline edit in `PassagePanel`), but
summaries are not:

- The backend has `POST /summaries` and `DELETE /summaries/{id}` but **no update** endpoint.
- `NotesView`'s `SummaryEditor` fakes editing a user summary by **delete-then-recreate**
  (`saveSummary`), which churns the row id/`created_at`.
- **Agent-generated** summaries (`generated_by != "user"`) are rendered **read-only**.

The user wants to edit existing summaries "just like existing notes," including agent ones.

## Decisions

- **Edit in place** via a new `PUT /summaries/{id}` — no more delete+recreate.
- **Agent summaries are editable**, and editing one **relabels it to a user summary**
  (`generated_by` → `"user"`, the "agent" badge drops). Chosen over keeping provenance.
- **No schema migration.** Summaries have no `updated_at` column; the update sets `body`
  (and `generated_by` when relabeling) only. Adding `updated_at` is out of scope.
- **UI mirrors notes:** each summary renders as Markdown with an **Edit** button that swaps to
  a textarea with **Save/Cancel**; a separate **Add** control creates new summaries. This
  replaces the single always-on user textarea.
- **MCP is out of scope** — this is a UI/editing feature. `folio_store_summary` (create) is
  unchanged; an MCP update tool can come later if wanted.

## Backend

- **`models.py`** — add `SummaryUpdate`:
  ```python
  class SummaryUpdate(BaseModel):
      body: str
      generated_by: str | None = None
  ```
- **`store.py`** — add `update_summary(conn, summary_id, body, generated_by=None)`: updates
  `body`, and `generated_by` too when provided (for the agent→user relabel). Mirrors
  `update_note`.
- **`app.py`** — add `@app.put("/summaries/{summary_id}", status_code=200)` →
  `store.update_summary(conn, summary_id, s.body, s.generated_by)`; returns `{"id": summary_id}`.
  Mirrors the `PUT /notes/{note_id}` handler.

## Frontend

- **`api/client.ts`** — add
  `updateSummary(id, body, generatedBy?) => req('/summaries/{id}', PUT, {body, generated_by})`,
  mirroring `updateNote`.
- **`notesview/NotesView.tsx` `SummaryEditor`** — rework to the notes-style model:
  - Render **every** summary for the scope as an item: `Markdown(body)`, an "agent" badge when
    `generated_by != "user"`, and an **Edit** button.
  - **Edit** → textarea + **Save**/**Cancel**. Save calls
    `updateSummary(s.id, body, s.generated_by !== "user" ? "user" : undefined)` then reloads,
    so editing an agent summary relabels it to a user summary.
  - An **Add** control (a textarea labelled by the scope heading + **Save**) calls
    `createSummary(scope, scopeId, body)` then reloads — for adding a brand-new summary.
  - Remove the delete-then-recreate `saveSummary`; `NotesView` passes `createSummary` /
    `updateSummary` / a reload callback down.

## Testing

- **Backend** (`tests/test_api_summaries.py` or extend existing summary tests): `PUT` updates
  body in place (same id, list reflects new body); `PUT` with `generated_by="user"` relabels an
  agent summary; unknown id is a no-op/!500.
- **Frontend** (`notesview/NotesView.test.tsx`): editing an existing summary calls
  `updateSummary` (not delete+create) and preserves its id; editing an agent summary passes
  `generated_by: "user"`; the Add control calls `createSummary`. Update the existing
  delete+recreate / prefill tests to the new in-place model.

## Out of scope

- `updated_at` for summaries (schema migration).
- MCP summary-update tool.
- The broader Notes-page overhaul (workstream C: tabs, fuzzy search, tag picker, perf).
