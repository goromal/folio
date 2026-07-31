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


def create_app(db_path):
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
        book_id = ingest.ingest_epub(conn, tmp.name)
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
        hits = search_mod.search_blocks(conn, q, limit=limit)
        return [h for h in hits if h["book_id"] == book_id]

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

    return app
