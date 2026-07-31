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
        else:
            return {"error": f"Unknown tool: {name}"}
    except Exception as e:
        return {"error": str(e)}
