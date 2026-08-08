"""Whole-database lease: store functions, atomic DB swap, and hub resolution.

The lease is a single row (id=1) inside the folio DB. A machine may write iff
lease.holder equals its own machine name (FOLIO_MACHINE). Because the row lives
in the DB, it is carried along when the DB is copied between hub and spoke.
"""
import os
import shutil
import sqlite3
import tempfile
from datetime import datetime, timezone

from starlette.responses import JSONResponse

from folio_backend.db import connect


def _now():
    return datetime.now(timezone.utc).isoformat()


def get_holder(conn):
    row = conn.execute("SELECT holder, acquired_at FROM lease WHERE id = 1").fetchone()
    return dict(row) if row else {"holder": None, "acquired_at": None}


def acquire(conn, holder):
    """Atomically take the lease if free. Returns True iff granted."""
    cur = conn.execute(
        "UPDATE lease SET holder = ?, acquired_at = ? WHERE id = 1 AND holder IS NULL",
        (holder, _now()),
    )
    conn.commit()
    return cur.rowcount == 1


def steal(conn, holder):
    """Force-take the lease regardless of the current holder (crash recovery)."""
    conn.execute(
        "UPDATE lease SET holder = ?, acquired_at = ? WHERE id = 1", (holder, _now()))
    conn.commit()


def release(conn, holder, force=False):
    """Free the lease. Without force, only the current holder may release.
    Returns True iff the row was freed."""
    if force:
        cur = conn.execute("UPDATE lease SET holder = NULL, acquired_at = NULL WHERE id = 1")
    else:
        cur = conn.execute(
            "UPDATE lease SET holder = NULL, acquired_at = NULL WHERE id = 1 AND holder = ?",
            (holder,))
    conn.commit()
    return cur.rowcount == 1


def set_holder(conn, holder):
    """Directly set (or clear, with holder=None) the lease holder."""
    conn.execute(
        "UPDATE lease SET holder = ?, acquired_at = ? WHERE id = 1",
        (holder, _now() if holder else None))
    conn.commit()


def validate_db(path):
    """Raise ValueError if the file at path is not a healthy folio DB
    (integrity + lease row). Any sqlite-level error is normalized to ValueError."""
    conn = sqlite3.connect(path)
    try:
        status = conn.execute("PRAGMA integrity_check").fetchone()[0]
        if status != "ok":
            raise ValueError(f"integrity_check failed: {status}")
        if conn.execute("SELECT holder FROM lease WHERE id = 1").fetchone() is None:
            raise ValueError("missing lease row")
    except sqlite3.Error as e:
        raise ValueError(f"not a valid database: {e}")
    finally:
        conn.close()


def swap_database(db_path, source_path):
    """Atomically replace db_path with the SQLite file at source_path.
    Copies into the same directory then os.replace (atomic within one filesystem)."""
    dst_dir = os.path.dirname(os.path.abspath(db_path)) or "."
    fd, tmp = tempfile.mkstemp(dir=dst_dir, suffix=".swap")
    os.close(fd)
    try:
        shutil.copyfile(source_path, tmp)
        os.replace(tmp, db_path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def snapshot_db(db_path):
    """Return a temp-file path holding a consistent snapshot of db_path via
    sqlite3's online backup. Caller is responsible for deleting it."""
    fd, tmp = tempfile.mkstemp(suffix=".dbsnap")
    os.close(fd)
    src = connect(db_path)
    dst = sqlite3.connect(tmp)
    try:
        with dst:
            src.backup(dst)
    finally:
        src.close()
        dst.close()
    return tmp


def resolve_host(host):
    """Map an <name>.local host to a LAN IP via wormhole when available; otherwise
    return host unchanged. The import is lazy so folio's own tests need no wormhole."""
    try:
        from wormhole import resolve_host as _resolve
        return _resolve(host)
    except Exception:
        return host


def hub_base_url():
    """Build the hub's base URL from env, resolving the mDNS host. None if unset."""
    host = os.environ.get("FOLIO_HUB_HOST", "")
    if not host:
        return None
    ip = resolve_host(host)
    port = os.environ.get("FOLIO_HUB_PORT", "")
    return f"https://{ip}:{port}" if port else f"https://{ip}"


_MUTATING = {"POST", "PUT", "PATCH", "DELETE"}
_ALWAYS_ALLOWED_PREFIXES = ("/lease", "/hub", "/view/focus")


def _write_allowed_path(path):
    """True if a mutating request to path bypasses lease enforcement."""
    for p in _ALWAYS_ALLOWED_PREFIXES:
        if path == p or path.startswith(p + "/"):
            return True
    # saving the reading position: PUT /books/<id>/position
    return path.startswith("/books/") and path.endswith("/position")


class LeaseEnforcementMiddleware:
    """Reject content-mutating requests with 423 unless this machine holds the lease.

    Raw ASGI (not Starlette's BaseHTTPMiddleware, mirroring ChangeBroadcastMiddleware)
    so streaming responses (/view/stream SSE, /hub/db download) pass through unbuffered.
    """

    def __init__(self, app, db_path, machine):
        self.app = app
        self.db_path = db_path
        self.machine = machine

    async def __call__(self, scope, receive, send):
        if (
            scope["type"] == "http"
            and scope["method"] in _MUTATING
            and not _write_allowed_path(scope["path"])
        ):
            conn = connect(self.db_path)
            try:
                holder = get_holder(conn)["holder"]
            finally:
                conn.close()
            if holder != self.machine:
                response = JSONResponse(
                    status_code=423,
                    content={"detail": f"read-only: lease held by {holder}", "holder": holder})
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)
