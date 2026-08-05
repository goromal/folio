#!/usr/bin/env python3
# folio MCP Server — gives Claude Code access to the folio study backend.
import sys
import json
import os
import urllib.request
import urllib.error
import urllib.parse


class FolioClient:
    """Client for the folio backend REST API."""

    def __init__(self, base_url):
        self.base_url = base_url.rstrip("/")

    def _request(self, method, endpoint, data=None):
        url = f"{self.base_url}{endpoint}"
        headers = {"Content-Type": "application/json"}
        body = json.dumps(data).encode("utf-8") if data is not None else None
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req) as resp:
                text = resp.read().decode("utf-8")
                return json.loads(text) if text else None
        except urllib.error.HTTPError as e:
            err = e.read().decode("utf-8")
            raise Exception(f"API Error {e.code}: {err}")
        except urllib.error.URLError as e:
            raise Exception(f"Network error connecting to {url}: {e.reason}")

    # read / navigate
    def list_books(self):
        return self._request("GET", "/books")

    def get_toc(self, book_id):
        return self._request("GET", f"/books/{book_id}/toc")

    def get_blocks(self, book_id, chapter_id=None):
        q = f"?chapter_id={chapter_id}" if chapter_id is not None else ""
        return self._request("GET", f"/books/{book_id}/blocks{q}")

    def search(self, book_id, query, limit=20):
        qs = urllib.parse.urlencode({"q": query, "limit": limit})
        return self._request("GET", f"/books/{book_id}/blocks/search?{qs}")

    def get_passage(self, passage_id):
        return self._request("GET", f"/passages/{passage_id}")

    # write
    def create_passage(self, book_id, start_block, start_off, end_block, end_off):
        return self._request("POST", "/passages", {
            "book_id": book_id, "start_block": start_block, "start_off": start_off,
            "end_block": end_block, "end_off": end_off})

    def add_note(self, body, passage_id=None, chapter_id=None, book_id=None):
        return self._request("POST", "/notes", {
            "body": body, "passage_id": passage_id,
            "chapter_id": chapter_id, "book_id": book_id})

    def add_highlight(self, passage_id, color="yellow"):
        return self._request("POST", f"/passages/{passage_id}/highlights",
                             {"color": color})

    def add_tag(self, passage_id, name):
        return self._request("POST", f"/passages/{passage_id}/tags", {"name": name})

    def link_passages(self, from_passage, to_passage, note=None):
        return self._request("POST", f"/passages/{from_passage}/links",
                             {"to_passage": to_passage, "note": note})

    def goto(self, block_id):
        return self._request("POST", "/view/focus", {"block_id": block_id})

    # higher-order / lists
    def store_summary(self, scope, scope_id, body):
        return self._request("POST", "/summaries", {
            "scope": scope, "scope_id": scope_id,
            "body": body, "generated_by": "agent"})

    def get_summaries(self, scope, scope_id):
        qs = urllib.parse.urlencode({"scope": scope, "scope_id": scope_id})
        return self._request("GET", f"/summaries?{qs}")

    def list_book_notes(self, book_id, chapter_id=None):
        q = f"?chapter_id={chapter_id}" if chapter_id is not None else ""
        return self._request("GET", f"/books/{book_id}/notes{q}")

    def list_book_passages(self, book_id):
        return self._request("GET", f"/books/{book_id}/passages")

    def list_book_summaries(self, book_id):
        return self._request("GET", f"/books/{book_id}/summaries")


def export_prepare(client, book_id, chapter_id=None):
    """Compose a book's study materials into a Notion-ready {title, markdown}."""
    books = client.list_books() or []
    title = next((b["title"] for b in books if b["id"] == book_id),
                 f"Book {book_id}")
    summaries = client.list_book_summaries(book_id) or []
    notes = client.list_book_notes(book_id, chapter_id) or []
    passages = client.list_book_passages(book_id) or []

    lines = [f"# {title} — Study Notes", ""]
    if summaries:
        lines.append("## Summaries")
        for s in summaries:
            lines.append(
                f"- **{s['scope']} {s['scope_id']}** "
                f"({s.get('generated_by', 'user')}): {s['body']}")
        lines.append("")
    if notes:
        lines.append("## Notes")
        for n in notes:
            lines.append(f"- {n['body']}")
        lines.append("")
    highlighted = [p for p in passages if p.get("highlights")]
    if highlighted:
        lines.append("## Highlighted passages")
        for p in highlighted:
            tags = ", ".join(t["name"] for t in p.get("tags", []))
            suffix = f" _(tags: {tags})_" if tags else ""
            lines.append(
                f"- passage {p['id']} "
                f"[{p['start_block']}:{p['start_off']}–"
                f"{p['end_block']}:{p['end_off']}]{suffix}")
    return {"title": title, "markdown": "\n".join(lines)}


def handle_tool_call(client, name, args):
    """Dispatch an MCP tool call to the FolioClient. Returns JSON-serializable data."""
    try:
        if name == "folio_list_books":
            return client.list_books()
        elif name == "folio_get_toc":
            return client.get_toc(args["book_id"])
        elif name == "folio_get_section_text":
            blocks = client.get_blocks(args["book_id"], args.get("chapter_id"))
            return {"text": "\n\n".join(b["text"] for b in blocks)}
        elif name == "folio_search":
            return client.search(args["book_id"], args["query"],
                                 args.get("limit", 20))
        elif name == "folio_get_passage":
            return client.get_passage(args["passage_id"])
        elif name == "folio_create_passage":
            return client.create_passage(
                args["book_id"], args["start_block"], args["start_off"],
                args["end_block"], args["end_off"])
        elif name == "folio_add_note":
            return client.add_note(
                args["body"], passage_id=args.get("passage_id"),
                chapter_id=args.get("chapter_id"), book_id=args.get("book_id"))
        elif name == "folio_add_highlight":
            return client.add_highlight(args["passage_id"],
                                        color=args.get("color", "yellow"))
        elif name == "folio_add_tag":
            return client.add_tag(args["passage_id"], args["name"])
        elif name == "folio_link_passages":
            return client.link_passages(args["from_passage"], args["to_passage"],
                                        note=args.get("note"))
        elif name == "folio_store_summary":
            return client.store_summary(args["scope"], args["scope_id"], args["body"])
        elif name == "folio_get_summaries":
            return client.get_summaries(args["scope"], args["scope_id"])
        elif name == "folio_export_prepare":
            return export_prepare(client, args["book_id"], args.get("chapter_id"))
        elif name == "folio_goto":
            block_id = args.get("block_id")
            if block_id is None:
                pid = args.get("passage_id")
                if pid is None:
                    raise ValueError("folio_goto requires block_id or passage_id")
                block_id = client.get_passage(pid)["start_block"]
            return client.goto(block_id)
        else:
            return {"error": f"Unknown tool: {name}"}
    except Exception as e:
        return {"error": str(e)}


TOOLS = [
    {"name": "folio_list_books",
     "description": "List all books in folio.",
     "inputSchema": {"type": "object", "properties": {}, "required": []}},
    {"name": "folio_get_toc",
     "description": "Get the table of contents (chapters) for a book.",
     "inputSchema": {"type": "object",
                     "properties": {"book_id": {"type": "integer"}},
                     "required": ["book_id"]}},
    {"name": "folio_get_section_text",
     "description": "Get the token-efficient plain text of a book or chapter.",
     "inputSchema": {"type": "object",
                     "properties": {"book_id": {"type": "integer"},
                                    "chapter_id": {"type": "integer"}},
                     "required": ["book_id"]}},
    {"name": "folio_search",
     "description": "Keyword-search a book's text (FTS5); returns ranked block hits.",
     "inputSchema": {"type": "object",
                     "properties": {"book_id": {"type": "integer"},
                                    "query": {"type": "string"},
                                    "limit": {"type": "integer"}},
                     "required": ["book_id", "query"]}},
    {"name": "folio_get_passage",
     "description": "Get a passage with its highlights, notes, and tags.",
     "inputSchema": {"type": "object",
                     "properties": {"passage_id": {"type": "integer"}},
                     "required": ["passage_id"]}},
    {"name": "folio_create_passage",
     "description": "Mark a passage by (block_id, offset) start/end anchors.",
     "inputSchema": {"type": "object",
                     "properties": {"book_id": {"type": "integer"},
                                    "start_block": {"type": "integer"},
                                    "start_off": {"type": "integer"},
                                    "end_block": {"type": "integer"},
                                    "end_off": {"type": "integer"}},
                     "required": ["book_id", "start_block", "start_off",
                                  "end_block", "end_off"]}},
    {"name": "folio_add_note",
     "description": "Attach a note to a passage, chapter, or book (exactly one).",
     "inputSchema": {"type": "object",
                     "properties": {"body": {"type": "string"},
                                    "passage_id": {"type": "integer"},
                                    "chapter_id": {"type": "integer"},
                                    "book_id": {"type": "integer"}},
                     "required": ["body"]}},
    {"name": "folio_add_highlight",
     "description": "Add a colored highlight to a passage. color must be one of the "
                    "reader's palette: yellow, green, blue, pink, red (default yellow); "
                    "other values render as yellow.",
     "inputSchema": {"type": "object",
                     "properties": {"passage_id": {"type": "integer"},
                                    "color": {"type": "string",
                                              "enum": ["yellow", "green", "blue", "pink", "red"],
                                              "default": "yellow"}},
                     "required": ["passage_id"]}},
    {"name": "folio_add_tag",
     "description": "Tag a passage.",
     "inputSchema": {"type": "object",
                     "properties": {"passage_id": {"type": "integer"},
                                    "name": {"type": "string"}},
                     "required": ["passage_id", "name"]}},
    {"name": "folio_link_passages",
     "description": "Link one passage to another, with an optional note.",
     "inputSchema": {"type": "object",
                     "properties": {"from_passage": {"type": "integer"},
                                    "to_passage": {"type": "integer"},
                                    "note": {"type": "string"}},
                     "required": ["from_passage", "to_passage"]}},
    {"name": "folio_store_summary",
     "description": "Store an agent-written summary for a book or chapter.",
     "inputSchema": {"type": "object",
                     "properties": {"scope": {"type": "string"},
                                    "scope_id": {"type": "integer"},
                                    "body": {"type": "string"}},
                     "required": ["scope", "scope_id", "body"]}},
    {"name": "folio_get_summaries",
     "description": "Get stored summaries for a book or chapter.",
     "inputSchema": {"type": "object",
                     "properties": {"scope": {"type": "string"},
                                    "scope_id": {"type": "integer"}},
                     "required": ["scope", "scope_id"]}},
    {"name": "folio_export_prepare",
     "description": "Compose a book's study materials into a Notion-ready "
                    "{title, markdown} for the agent to push via the notion MCP.",
     "inputSchema": {"type": "object",
                     "properties": {"book_id": {"type": "integer"},
                                    "chapter_id": {"type": "integer"}},
                     "required": ["book_id"]}},
    {"name": "folio_goto",
     "description": "Point the human reader at a block (or a passage's start block): "
                    "their live view follows to that block's page.",
     "inputSchema": {"type": "object",
                     "properties": {"block_id": {"type": "integer"},
                                    "passage_id": {"type": "integer"}}}},
]


def handle_request(client, request):
    method = request.get("method")
    req_id = request.get("id")
    if method == "initialize":
        result = {"protocolVersion": "2024-11-05",
                  "capabilities": {"tools": {}},
                  "serverInfo": {"name": "folio-mcp-server", "version": "1.0.0"}}
    elif method == "tools/list":
        result = {"tools": TOOLS}
    elif method == "tools/call":
        params = request.get("params", {})
        tool_result = handle_tool_call(client, params.get("name"),
                                       params.get("arguments", {}))
        result = {"content": [{"type": "text", "text": json.dumps(tool_result)}]}
    else:
        return {"jsonrpc": "2.0", "id": req_id,
                "error": {"code": -32601, "message": f"Method not found: {method}"}}
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def main():
    base_url = os.environ.get("FOLIO_API_URL", "http://localhost:8000")
    client = FolioClient(base_url)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            continue
        if "id" not in request:  # notification — no response
            continue
        response = handle_request(client, request)
        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
