import sqlite3
from pathlib import Path

SCHEMA_PATH = Path(__file__).parent / "schema.sql"


def connect(db_path):
    # check_same_thread=False: FastAPI runs sync endpoint dependencies in a
    # threadpool and may run the db() generator's teardown (conn.close()) on a
    # different thread than its setup. Each request still uses its own connection
    # (no concurrent sharing), so relaxing the thread check is safe and avoids a
    # sqlite3.ProgrammingError -> HTTP 500 under a real uvicorn server.
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(conn):
    conn.executescript(SCHEMA_PATH.read_text())
    conn.execute("PRAGMA foreign_keys = ON")
    conn.commit()
