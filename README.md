# folio

Book Study Companion — an e-book reader (Electron desktop + web) and MCP server that lets
a human and an LLM agent collaborate on ingesting books and building study materials.

A single per-machine backend service over one SQLite database is the source of truth; the
web UI, the desktop shell, and the MCP server are all clients of it. Packaged and deployed
by [anixpkgs](https://github.com/goromal/anixpkgs) (consumed as a non-flake input, like
`flasks`), on graphical machines only.

## Layout

| Dir | Stack | Purpose |
| --- | --- | --- |
| `backend/` | Python (FastAPI) | Data model, SQLite schema, EPUB ingestion, CRUD + FTS5 search API. Source of truth. |
| `frontend/` | TypeScript SPA | Reader (side-by-side block-flow, cross-page selection), markup tools, notes view. Served at `/folio`. |
| `desktop/` | Electron | Thin shell that loads the local served SPA (full parity with web). |
| `mcp/` | Python | MCP server over the backend API: nav/search, notes/passages/links, summaries, Notion export. |

## Data model

Books are ingested into **block-structured normalized text** (ordered typed blocks per
chapter). Passages/highlights/notes/tags/links anchor to `(block_id, offset)` ranges, so
pagination and text size are purely presentational. See the architecture design in the
workspace `sources/docs/folio-architecture.md`.
