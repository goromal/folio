PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS books (
    id           INTEGER PRIMARY KEY,
    title        TEXT NOT NULL,
    author       TEXT,
    source_hash  TEXT NOT NULL UNIQUE,
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chapters (
    id         INTEGER PRIMARY KEY,
    book_id    INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    order_idx  INTEGER NOT NULL,
    parent_id  INTEGER REFERENCES chapters(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS blocks (
    id         INTEGER PRIMARY KEY,
    book_id    INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
    order_idx  INTEGER NOT NULL,
    type       TEXT NOT NULL,
    text       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blocks_book_order ON blocks(book_id, order_idx);

CREATE VIRTUAL TABLE IF NOT EXISTS blocks_fts USING fts5(
    text, content='blocks', content_rowid='id'
);
CREATE TRIGGER IF NOT EXISTS blocks_ai AFTER INSERT ON blocks BEGIN
  INSERT INTO blocks_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS blocks_ad AFTER DELETE ON blocks BEGIN
  INSERT INTO blocks_fts(blocks_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
CREATE TRIGGER IF NOT EXISTS blocks_au AFTER UPDATE ON blocks BEGIN
  INSERT INTO blocks_fts(blocks_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO blocks_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE TABLE IF NOT EXISTS passages (
    id          INTEGER PRIMARY KEY,
    book_id     INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    start_block INTEGER NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
    start_off   INTEGER NOT NULL,
    end_block   INTEGER NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
    end_off     INTEGER NOT NULL,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS highlights (
    id         INTEGER PRIMARY KEY,
    passage_id INTEGER NOT NULL REFERENCES passages(id) ON DELETE CASCADE,
    color      TEXT NOT NULL DEFAULT 'yellow'
);

CREATE TABLE IF NOT EXISTS notes (
    id         INTEGER PRIMARY KEY,
    passage_id INTEGER REFERENCES passages(id) ON DELETE CASCADE,
    chapter_id INTEGER REFERENCES chapters(id) ON DELETE CASCADE,
    book_id    INTEGER REFERENCES books(id) ON DELETE CASCADE,
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK ((passage_id IS NOT NULL) + (chapter_id IS NOT NULL) + (book_id IS NOT NULL) = 1)
);

CREATE TABLE IF NOT EXISTS tags (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS passage_tags (
    passage_id INTEGER NOT NULL REFERENCES passages(id) ON DELETE CASCADE,
    tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (passage_id, tag_id)
);

CREATE TABLE IF NOT EXISTS passage_links (
    id           INTEGER PRIMARY KEY,
    from_passage INTEGER NOT NULL REFERENCES passages(id) ON DELETE CASCADE,
    to_passage   INTEGER NOT NULL REFERENCES passages(id) ON DELETE CASCADE,
    note         TEXT
);

CREATE TABLE IF NOT EXISTS summaries (
    id           INTEGER PRIMARY KEY,
    scope        TEXT NOT NULL,
    scope_id     INTEGER NOT NULL,
    body         TEXT NOT NULL,
    generated_by TEXT NOT NULL DEFAULT 'user',
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reading_position (
    book_id    INTEGER PRIMARY KEY REFERENCES books(id)    ON DELETE CASCADE,
    chapter_id INTEGER              REFERENCES chapters(id) ON DELETE SET NULL,
    block_id   INTEGER              REFERENCES blocks(id)   ON DELETE SET NULL,
    updated_at TEXT NOT NULL
);
