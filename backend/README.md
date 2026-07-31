# folio-backend

The folio source-of-truth service: SQLite schema, EPUB ingestion, study-material
CRUD, FTS5 search, and a FastAPI HTTP API. Consumed by the web SPA, the Electron
shell, the MCP server, and (read-only over wormhole) the Tester.

## Run

    FOLIO_DB=/var/lib/folio/folio.db FOLIO_PORT=8000 folio-backend

Env vars: `FOLIO_DB` (default `/var/lib/folio/folio.db`), `FOLIO_HOST`
(default `127.0.0.1`), `FOLIO_PORT` (default `8000`).

## Test

    nix-shell -p 'python313.withPackages(ps: with ps; [ fastapi uvicorn ebooklib beautifulsoup4 pydantic httpx python-multipart ])' \
      --run 'cd backend && python -m unittest discover -s tests -v'

## API surface

- `GET  /health`
- `POST /books` (EPUB upload) · `GET /books` · `GET /books/{id}/toc`
- `GET  /books/{id}/blocks[?chapter_id=]` · `GET /books/{id}/blocks/search?q=`
- `POST /passages` · `GET /passages/{id}` (with highlights/notes/tags)
- `POST /passages/{id}/highlights` · `POST /notes` · `PUT /notes/{id}` · `POST /passages/{id}/tags`
- `POST/GET /passages/{id}/links`
- `POST /summaries` · `GET /summaries?scope=&scope_id=`
