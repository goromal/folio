import os
import tempfile

from fastapi import FastAPI, Depends, UploadFile, File, HTTPException

from folio_backend import ingest, search as search_mod, store
from folio_backend.db import connect, init_db
from folio_backend.models import (
    BookOut, ChapterOut, BlockOut, SearchHit,
    PassageIn, PassageOut, HighlightIn, NoteIn, NoteUpdate, TagIn,
    LinkIn, SummaryIn,
)


def create_app(db_path, static_dir=None):
    init_db(connect(db_path))
    app = FastAPI(title="folio-backend")
    app.state.db_path = db_path

    def db():
        conn = connect(db_path)
        try:
            yield conn
        finally:
            conn.close()

    @app.get("/health")
    def health():
        return {"status": "ok"}

    # ---- books ----
    @app.post("/books", status_code=201, response_model=BookOut)
    def upload_book(file: UploadFile = File(...), conn=Depends(db)):
        suffix = os.path.splitext(file.filename or "")[1] or ".epub"
        tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
        tmp.write(file.file.read())
        tmp.close()
        try:
            book_id = ingest.ingest_epub(conn, tmp.name)
        finally:
            os.unlink(tmp.name)
        row = conn.execute("SELECT id, title, author FROM books WHERE id = ?",
                           (book_id,)).fetchone()
        return dict(row)

    @app.get("/books", response_model=list[BookOut])
    def list_books(conn=Depends(db)):
        rows = conn.execute("SELECT id, title, author FROM books ORDER BY id").fetchall()
        return [dict(r) for r in rows]

    @app.get("/books/{book_id}/toc", response_model=list[ChapterOut])
    def book_toc(book_id: int, conn=Depends(db)):
        rows = conn.execute(
            "SELECT id, title, order_idx, parent_id FROM chapters "
            "WHERE book_id = ? ORDER BY order_idx", (book_id,)).fetchall()
        if not rows:
            exists = conn.execute("SELECT 1 FROM books WHERE id = ?",
                                 (book_id,)).fetchone()
            if not exists:
                raise HTTPException(404, "book not found")
        return [dict(r) for r in rows]

    # ---- blocks ----
    @app.get("/books/{book_id}/blocks", response_model=list[BlockOut])
    def list_blocks(book_id: int, chapter_id: int | None = None, conn=Depends(db)):
        if chapter_id is None:
            rows = conn.execute(
                "SELECT id, chapter_id, order_idx, type, text FROM blocks "
                "WHERE book_id = ? ORDER BY order_idx", (book_id,)).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, chapter_id, order_idx, type, text FROM blocks "
                "WHERE book_id = ? AND chapter_id = ? ORDER BY order_idx",
                (book_id, chapter_id)).fetchall()
        return [dict(r) for r in rows]

    @app.get("/books/{book_id}/blocks/search", response_model=list[SearchHit])
    def search_blocks_ep(book_id: int, q: str, limit: int = 20, conn=Depends(db)):
        return search_mod.search_blocks(conn, q, limit=limit, book_id=book_id)

    # ---- passages + attachments ----
    @app.post("/passages", status_code=201, response_model=PassageOut)
    def create_passage_ep(p: PassageIn, conn=Depends(db)):
        pid = store.create_passage(conn, p.book_id, p.start_block, p.start_off,
                                   p.end_block, p.end_off)
        return dict(store.get_passage(conn, pid))

    @app.get("/passages/{passage_id}")
    def get_passage_ep(passage_id: int, conn=Depends(db)):
        p = store.get_passage(conn, passage_id)
        if p is None:
            raise HTTPException(404, "passage not found")
        highlights = conn.execute(
            "SELECT id, color FROM highlights WHERE passage_id = ? ORDER BY id",
            (passage_id,)).fetchall()
        notes = conn.execute(
            "SELECT id, body, created_at, updated_at FROM notes "
            "WHERE passage_id = ? ORDER BY id", (passage_id,)).fetchall()
        tags = store.get_passage_tags(conn, passage_id)
        result = dict(p)
        result["highlights"] = [dict(h) for h in highlights]
        result["notes"] = [dict(n) for n in notes]
        result["tags"] = [dict(t) for t in tags]
        return result

    @app.post("/passages/{passage_id}/highlights", status_code=201)
    def add_highlight_ep(passage_id: int, h: HighlightIn, conn=Depends(db)):
        hid = store.add_highlight(conn, passage_id, color=h.color)
        return {"id": hid}

    @app.post("/notes", status_code=201)
    def add_note_ep(n: NoteIn, conn=Depends(db)):
        try:
            nid = store.add_note(conn, n.body, passage_id=n.passage_id,
                                 chapter_id=n.chapter_id, book_id=n.book_id)
        except Exception as e:
            raise HTTPException(400, f"invalid note scope: {e}")
        return {"id": nid}

    @app.put("/notes/{note_id}", status_code=200)
    def update_note_ep(note_id: int, n: NoteUpdate, conn=Depends(db)):
        store.update_note(conn, note_id, n.body)
        return {"id": note_id}

    @app.post("/passages/{passage_id}/tags", status_code=201)
    def tag_passage_ep(passage_id: int, t: TagIn, conn=Depends(db)):
        tag_id = store.add_tag(conn, t.name)
        store.tag_passage(conn, passage_id, tag_id)
        return {"tag_id": tag_id}

    # ---- links + summaries ----
    @app.post("/passages/{passage_id}/links", status_code=201)
    def create_link_ep(passage_id: int, link: LinkIn, conn=Depends(db)):
        lid = store.link_passages(conn, passage_id, link.to_passage, note=link.note)
        return {"id": lid}

    @app.get("/passages/{passage_id}/links")
    def list_links_ep(passage_id: int, conn=Depends(db)):
        return [dict(r) for r in store.get_links(conn, passage_id)]

    @app.post("/summaries", status_code=201)
    def create_summary_ep(s: SummaryIn, conn=Depends(db)):
        sid = store.create_summary(conn, s.scope, s.scope_id, s.body,
                                   generated_by=s.generated_by)
        return {"id": sid}

    @app.get("/summaries")
    def list_summaries_ep(scope: str, scope_id: int, conn=Depends(db)):
        return [dict(r) for r in store.get_summaries(conn, scope, scope_id)]

    # ---- annotation lists (MCP + notes view) ----
    @app.get("/books/{book_id}/notes")
    def list_book_notes(book_id: int, chapter_id: int | None = None, conn=Depends(db)):
        if chapter_id is not None:
            rows = conn.execute(
                "SELECT id, passage_id, chapter_id, book_id, body, created_at, updated_at "
                "FROM notes WHERE chapter_id = ? ORDER BY id", (chapter_id,)).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, passage_id, chapter_id, book_id, body, created_at, updated_at "
                "FROM notes WHERE book_id = ? "
                "OR passage_id IN (SELECT id FROM passages WHERE book_id = ?) "
                "OR chapter_id IN (SELECT id FROM chapters WHERE book_id = ?) "
                "ORDER BY id", (book_id, book_id, book_id)).fetchall()
        return [dict(r) for r in rows]

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
            d = dict(p)
            d["highlights"] = [dict(h) for h in highlights]
            d["notes"] = [dict(n) for n in notes]
            d["tags"] = [dict(t) for t in tags]
            result.append(d)
        return result

    @app.get("/books/{book_id}/summaries")
    def list_book_summaries(book_id: int, conn=Depends(db)):
        rows = conn.execute(
            "SELECT * FROM summaries WHERE (scope = 'book' AND scope_id = ?) "
            "OR (scope = 'chapter' AND scope_id IN "
            "(SELECT id FROM chapters WHERE book_id = ?)) ORDER BY id",
            (book_id, book_id)).fetchall()
        return [dict(r) for r in rows]

    # ---- deletes ----
    @app.delete("/books/{book_id}", status_code=204)
    def delete_book_ep(book_id: int, conn=Depends(db)):
        store.delete_book(conn, book_id)

    @app.delete("/passages/{passage_id}", status_code=204)
    def delete_passage_ep(passage_id: int, conn=Depends(db)):
        store.delete_passage(conn, passage_id)

    @app.delete("/highlights/{highlight_id}", status_code=204)
    def delete_highlight_ep(highlight_id: int, conn=Depends(db)):
        store.delete_highlight(conn, highlight_id)

    @app.delete("/notes/{note_id}", status_code=204)
    def delete_note_ep(note_id: int, conn=Depends(db)):
        store.delete_note(conn, note_id)

    @app.delete("/passages/{passage_id}/tags/{tag_id}", status_code=204)
    def untag_passage_ep(passage_id: int, tag_id: int, conn=Depends(db)):
        store.untag_passage(conn, passage_id, tag_id)

    @app.delete("/links/{link_id}", status_code=204)
    def delete_link_ep(link_id: int, conn=Depends(db)):
        store.delete_link(conn, link_id)

    @app.delete("/summaries/{summary_id}", status_code=204)
    def delete_summary_ep(summary_id: int, conn=Depends(db)):
        store.delete_summary(conn, summary_id)

    # ---- serve built SPA at /folio (env-gated) ----
    resolved_static = static_dir or os.environ.get("FOLIO_STATIC_DIR")
    if resolved_static and os.path.isdir(resolved_static):
        from fastapi.staticfiles import StaticFiles
        app.mount("/folio", StaticFiles(directory=resolved_static, html=True),
                  name="folio")

    return app
