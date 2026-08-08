import asyncio
import os
import socket
import sqlite3
import tempfile

import httpx

from fastapi import FastAPI, Depends, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse, FileResponse
from starlette.background import BackgroundTask

from folio_backend import ingest, search as search_mod, store
from folio_backend import lease as lease_mod
from folio_backend.lease import LeaseEnforcementMiddleware
from folio_backend.db import connect, init_db
from folio_backend.models import (
    BookOut, ChapterOut, BlockOut, SearchHit,
    PassageIn, PassageOut, HighlightIn, NoteIn, NoteUpdate, TagIn,
    LinkIn, SummaryIn, FocusIn, PositionIn, PositionOut, LeaseHolderIn,
)
from folio_backend.view import ViewState, focus_event_stream, ChangeBroadcastMiddleware


def create_app(db_path, static_dir=None):
    init_db(connect(db_path))
    app = FastAPI(title="folio-backend")
    app.state.db_path = db_path
    app.state.view = ViewState()
    app.state.machine = os.environ.get("FOLIO_MACHINE", socket.gethostname())
    app.state.is_hub = os.environ.get("FOLIO_IS_HUB", "").lower() in ("1", "true", "yes")
    app.state.dblock = asyncio.Lock()
    machine = app.state.machine
    is_hub = app.state.is_hub
    app.add_middleware(ChangeBroadcastMiddleware, view=app.state.view)
    enforce = is_hub or bool(os.environ.get("FOLIO_HUB_HOST"))
    if enforce:
        app.add_middleware(LeaseEnforcementMiddleware, db_path=db_path, machine=machine)

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

    # ---- agent view-follow ----
    @app.post("/view/focus")
    async def set_view_focus(body: FocusIn, conn=Depends(db)):
        row = conn.execute(
            "SELECT book_id, chapter_id FROM blocks WHERE id = ?", (body.block_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "block not found")
        return await app.state.view.publish(row["book_id"], row["chapter_id"], body.block_id)

    @app.get("/view/stream")
    async def view_stream():
        return StreamingResponse(
            focus_event_stream(app.state.view), media_type="text/event-stream")

    # ---- reading position (persisted; excluded from 'changed' broadcast) ----
    @app.put("/books/{book_id}/position", response_model=PositionOut)
    def save_position_ep(book_id: int, p: PositionIn, conn=Depends(db)):
        try:
            store.save_position(conn, book_id, p.chapter_id, p.block_id)
        except sqlite3.IntegrityError:
            raise HTTPException(404, "book not found")
        return dict(store.get_position(conn, book_id))

    @app.get("/books/{book_id}/position")
    def get_position_ep(book_id: int, conn=Depends(db)):
        row = store.get_position(conn, book_id)
        return dict(row) if row else None

    @app.get("/position")
    def get_last_position_ep(conn=Depends(db)):
        row = store.get_last_position(conn)
        return dict(row) if row else None

    # ---- hub role: lock server + DB transfer (only when FOLIO_IS_HUB) ----
    if is_hub:
        @app.get("/hub/lease")
        def hub_lease_status(conn=Depends(db)):
            return lease_mod.get_holder(conn)

        @app.post("/hub/lease/acquire")
        def hub_lease_acquire(body: LeaseHolderIn, conn=Depends(db)):
            if lease_mod.acquire(conn, body.holder):
                return lease_mod.get_holder(conn)
            raise HTTPException(423, detail=lease_mod.get_holder(conn))

        @app.post("/hub/lease/steal")
        def hub_lease_steal(body: LeaseHolderIn, conn=Depends(db)):
            lease_mod.steal(conn, body.holder)
            return lease_mod.get_holder(conn)

        @app.post("/hub/lease/release")
        def hub_lease_release(body: LeaseHolderIn, conn=Depends(db)):
            lease_mod.release(conn, body.holder, force=False)
            return lease_mod.get_holder(conn)

        def _require_holder(holder, conn):
            if lease_mod.get_holder(conn)["holder"] != holder:
                raise HTTPException(423, detail=lease_mod.get_holder(conn))

        @app.get("/hub/db")
        def hub_db_download(holder: str, conn=Depends(db)):
            _require_holder(holder, conn)
            snap = lease_mod.snapshot_db(app.state.db_path)
            return FileResponse(snap, media_type="application/octet-stream",
                                filename="folio.db",
                                background=BackgroundTask(os.unlink, snap))

        @app.post("/hub/db")
        async def hub_db_upload(holder: str, file: UploadFile = File(...)):
            data = await file.read()

            def _apply():
                conn = connect(app.state.db_path)
                try:
                    _require_holder(holder, conn)
                finally:
                    conn.close()
                fd, tmp = tempfile.mkstemp(suffix=".dbup")
                os.close(fd)
                try:
                    with open(tmp, "wb") as fh:
                        fh.write(data)
                    lease_mod.validate_db(tmp)
                    lease_mod.swap_database(app.state.db_path, tmp)
                finally:
                    if os.path.exists(tmp):
                        os.unlink(tmp)

            try:
                async with app.state.dblock:
                    await asyncio.to_thread(_apply)
            except ValueError as e:
                raise HTTPException(400, f"invalid database upload: {e}")
            return {"status": "ok"}

    # ---- local lease orchestration (all machines) ----
    @app.get("/lease")
    def lease_status(conn=Depends(db)):
        local = lease_mod.get_holder(conn)
        result = {
            "role": "hub" if is_hub else "spoke",
            "held": local["holder"] == machine,
            "holder": local["holder"],
        }
        if not is_hub:
            base = lease_mod.hub_base_url()
            if base:
                try:
                    r = httpx.get(f"{base}/hub/lease", verify=False, timeout=10)
                    result["hubHolder"] = r.json().get("holder")
                except Exception as e:  # hub unreachable -> report, don't crash
                    result["hubError"] = str(e)
        return result

    @app.post("/lease/acquire")
    def lease_acquire(conn=Depends(db)):
        if is_hub:
            if lease_mod.acquire(conn, machine):
                return {"held": True, "holder": machine}
            raise HTTPException(423, detail=lease_mod.get_holder(conn))
        base = lease_mod.hub_base_url()
        if not base:
            raise HTTPException(400, "no hub configured (FOLIO_HUB_HOST unset)")
        r = httpx.post(f"{base}/hub/lease/acquire", json={"holder": machine},
                       verify=False, timeout=10)
        if r.status_code == 423:
            raise HTTPException(423, detail=r.json().get("detail"))
        r.raise_for_status()
        dl = httpx.get(f"{base}/hub/db", params={"holder": machine}, verify=False, timeout=120)
        dl.raise_for_status()
        fd, tmp = tempfile.mkstemp(suffix=".dbdl")
        os.close(fd)
        try:
            with open(tmp, "wb") as fh:
                fh.write(dl.content)
            lease_mod.validate_db(tmp)
            lease_mod.swap_database(app.state.db_path, tmp)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
        return {"held": True, "holder": machine}

    @app.post("/lease/release")
    def lease_release(discard: bool = False, conn=Depends(db)):
        if is_hub:
            lease_mod.release(conn, machine, force=False)
            return {"held": False, "holder": None}
        base = lease_mod.hub_base_url()
        if not base:
            raise HTTPException(400, "no hub configured (FOLIO_HUB_HOST unset)")
        if discard:
            httpx.post(f"{base}/hub/lease/release", json={"holder": machine},
                       verify=False, timeout=10).raise_for_status()
            return {"held": False, "holder": None}
        # write-back: free the local row, snapshot, upload; restore local on failure.
        snap = None
        try:
            lease_mod.set_holder(conn, None)
            snap = lease_mod.snapshot_db(app.state.db_path)
            with open(snap, "rb") as fh:
                httpx.post(f"{base}/hub/db", params={"holder": machine},
                           files={"file": ("folio.db", fh, "application/octet-stream")},
                           verify=False, timeout=120).raise_for_status()
        except Exception:
            lease_mod.set_holder(conn, machine)  # roll back; keep editing locally
            raise
        finally:
            if snap and os.path.exists(snap):
                os.unlink(snap)
        return {"held": False, "holder": None}

    return app
