def search_blocks(conn, query, limit=20):
    """Keyword search over blocks via FTS5. Returns ranked hits with snippets."""
    rows = conn.execute(
        """
        SELECT b.id AS block_id, b.book_id AS book_id, b.chapter_id AS chapter_id,
               snippet(blocks_fts, 0, '[', ']', '…', 12) AS snippet
        FROM blocks_fts
        JOIN blocks b ON b.id = blocks_fts.rowid
        WHERE blocks_fts MATCH ?
        ORDER BY rank
        LIMIT ?
        """,
        (query, limit)).fetchall()
    return [dict(r) for r in rows]
