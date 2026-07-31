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

    return app
