# folio-mcp

MCP server giving Claude Code access to the folio study backend. Stdlib-only stdio
JSON-RPC (mirrors vikunja-mcp-server.py); talks to the folio backend over HTTP.

## Config

- `FOLIO_API_URL` — backend base URL (default `http://localhost:8000`).

The server is a thin data layer: it makes no LLM calls and holds no Notion credentials.
`folio_store_summary` persists agent-written summaries; `folio_export_prepare` returns a
Notion-ready `{title, markdown}` that the agent pushes via its own notion MCP.

## Tools

list_books, get_toc, get_section_text, search, get_passage, create_passage, add_note,
add_highlight, add_tag, link_passages, store_summary, get_summaries, export_prepare
(all prefixed `folio_`).

## Test

    cd mcp && python3 -m unittest discover -s tests -v
