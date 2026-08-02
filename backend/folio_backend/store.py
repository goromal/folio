from datetime import datetime, timezone


def _now():
    return datetime.now(timezone.utc).isoformat()


# ---- passages -------------------------------------------------------------
def create_passage(conn, book_id, start_block, start_off, end_block, end_off):
    cur = conn.execute(
        "INSERT INTO passages (book_id, start_block, start_off, end_block, end_off, created_at) "
        "VALUES (?,?,?,?,?,?)",
        (book_id, start_block, start_off, end_block, end_off, _now()))
    conn.commit()
    return cur.lastrowid


def get_passage(conn, passage_id):
    return conn.execute(
        "SELECT * FROM passages WHERE id = ?", (passage_id,)).fetchone()


def list_passages(conn, book_id):
    return conn.execute(
        "SELECT * FROM passages WHERE book_id = ? ORDER BY id", (book_id,)).fetchall()


# ---- highlights -----------------------------------------------------------
def add_highlight(conn, passage_id, color="yellow"):
    cur = conn.execute(
        "INSERT INTO highlights (passage_id, color) VALUES (?,?)",
        (passage_id, color))
    conn.commit()
    return cur.lastrowid


# ---- notes ----------------------------------------------------------------
def add_note(conn, body, passage_id=None, chapter_id=None, book_id=None):
    now = _now()
    cur = conn.execute(
        "INSERT INTO notes (passage_id, chapter_id, book_id, body, created_at, updated_at) "
        "VALUES (?,?,?,?,?,?)",
        (passage_id, chapter_id, book_id, body, now, now))
    conn.commit()
    return cur.lastrowid


def update_note(conn, note_id, body):
    conn.execute(
        "UPDATE notes SET body = ?, updated_at = ? WHERE id = ?",
        (body, _now(), note_id))
    conn.commit()


# ---- tags -----------------------------------------------------------------
def add_tag(conn, name):
    conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (name,))
    conn.commit()
    return conn.execute("SELECT id FROM tags WHERE name = ?", (name,)).fetchone()["id"]


def tag_passage(conn, passage_id, tag_id):
    conn.execute(
        "INSERT OR IGNORE INTO passage_tags (passage_id, tag_id) VALUES (?,?)",
        (passage_id, tag_id))
    conn.commit()


def get_passage_tags(conn, passage_id):
    return conn.execute(
        "SELECT t.id, t.name FROM tags t "
        "JOIN passage_tags pt ON pt.tag_id = t.id "
        "WHERE pt.passage_id = ? ORDER BY t.name", (passage_id,)).fetchall()


# ---- passage links --------------------------------------------------------
def link_passages(conn, from_passage, to_passage, note=None):
    cur = conn.execute(
        "INSERT INTO passage_links (from_passage, to_passage, note) VALUES (?,?,?)",
        (from_passage, to_passage, note))
    conn.commit()
    return cur.lastrowid


def get_links(conn, passage_id):
    # Bidirectional: a link relates two passages, so it surfaces on both ends.
    return conn.execute(
        "SELECT * FROM passage_links WHERE from_passage = ? OR to_passage = ? ORDER BY id",
        (passage_id, passage_id)).fetchall()


# ---- summaries ------------------------------------------------------------
def create_summary(conn, scope, scope_id, body, generated_by="user"):
    cur = conn.execute(
        "INSERT INTO summaries (scope, scope_id, body, generated_by, created_at) "
        "VALUES (?,?,?,?,?)",
        (scope, scope_id, body, generated_by, _now()))
    conn.commit()
    return cur.lastrowid


def get_summaries(conn, scope, scope_id):
    return conn.execute(
        "SELECT * FROM summaries WHERE scope = ? AND scope_id = ? ORDER BY id",
        (scope, scope_id)).fetchall()


# ---- reading position -----------------------------------------------------
def save_position(conn, book_id, chapter_id, block_id):
    conn.execute(
        "INSERT INTO reading_position (book_id, chapter_id, block_id, updated_at) "
        "VALUES (?,?,?,?) "
        "ON CONFLICT(book_id) DO UPDATE SET "
        "chapter_id = excluded.chapter_id, block_id = excluded.block_id, "
        "updated_at = excluded.updated_at",
        (book_id, chapter_id, block_id, _now()))
    conn.commit()


def get_position(conn, book_id):
    return conn.execute(
        "SELECT * FROM reading_position WHERE book_id = ?", (book_id,)).fetchone()


def get_last_position(conn):
    return conn.execute(
        "SELECT * FROM reading_position ORDER BY updated_at DESC LIMIT 1").fetchone()


# ---- deletes --------------------------------------------------------------
def delete_book(conn, book_id):
    conn.execute("DELETE FROM books WHERE id = ?", (book_id,))
    conn.commit()


def delete_passage(conn, passage_id):
    conn.execute("DELETE FROM passages WHERE id = ?", (passage_id,))
    conn.commit()


def delete_highlight(conn, highlight_id):
    conn.execute("DELETE FROM highlights WHERE id = ?", (highlight_id,))
    conn.commit()


def delete_note(conn, note_id):
    conn.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    conn.commit()


def untag_passage(conn, passage_id, tag_id):
    conn.execute("DELETE FROM passage_tags WHERE passage_id = ? AND tag_id = ?",
                 (passage_id, tag_id))
    conn.commit()


def delete_link(conn, link_id):
    conn.execute("DELETE FROM passage_links WHERE id = ?", (link_id,))
    conn.commit()


def delete_summary(conn, summary_id):
    conn.execute("DELETE FROM summaries WHERE id = ?", (summary_id,))
    conn.commit()
