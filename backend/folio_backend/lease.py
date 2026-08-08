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
    """Raise if the file at path is not a healthy folio DB (integrity + lease row)."""
    conn = sqlite3.connect(path)
    try:
        status = conn.execute("PRAGMA integrity_check").fetchone()[0]
        if status != "ok":
            raise ValueError(f"integrity_check failed: {status}")
        if conn.execute("SELECT holder FROM lease WHERE id = 1").fetchone() is None:
            raise ValueError("missing lease row")
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
