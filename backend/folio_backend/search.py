def _fts_query(raw):
    """Turn a raw user string into a safe FTS5 query by quoting each
    whitespace-separated term as a literal phrase."""
    terms = raw.split()
    return " ".join('"' + t.replace('"', '""') + '"' for t in terms)


def search_blocks(conn, query, limit=20, book_id=None):
    """Keyword search over blocks via FTS5. Returns ranked hits with snippets."""
    fts_query = _fts_query(query)
    if not fts_query:
        return []

    sql = """
        SELECT b.id AS block_id, b.book_id AS book_id, b.chapter_id AS chapter_id,
               snippet(blocks_fts, 0, '[', ']', '…', 12) AS snippet
        FROM blocks_fts
        JOIN blocks b ON b.id = blocks_fts.rowid
        WHERE blocks_fts MATCH ?
        """
    params = [fts_query]
    if book_id is not None:
        sql += " AND b.book_id = ?"
        params.append(book_id)
    sql += " ORDER BY rank LIMIT ?"
    params.append(limit)

    rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]
