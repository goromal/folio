"""One-off importer for the LDS standard works.

Fetch the five bcbooks/scriptures-json files into a directory first, then:

    python -m folio_backend.import_scriptures --data ./scriptures-json

Writes directly to the SQLite DB (like the test suite), bypassing the HTTP lease
guard, so run it on the machine that owns the DB with the backend idle."""
import argparse
import os

from folio_backend import db, ingest, scriptures_source

DEFAULT_DB = os.environ.get("FOLIO_DB", "/var/lib/folio/folio.db")
ALL_VOLUMES = ("bible", "bom", "dc", "pgp")


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Import the LDS standard works into a folio database.")
    parser.add_argument("--data", required=True,
                        help="directory holding the bcbooks/scriptures-json files")
    parser.add_argument("--db", default=DEFAULT_DB, help="folio SQLite DB path")
    parser.add_argument("--volumes", default=",".join(ALL_VOLUMES),
                        help="comma-separated subset of: " + ", ".join(ALL_VOLUMES))
    args = parser.parse_args(argv)

    selected = [v.strip() for v in args.volumes.split(",") if v.strip()]
    unknown = [v for v in selected if v not in ALL_VOLUMES]
    if unknown:
        parser.error("unknown volume(s): %s; choose from %s"
                     % (", ".join(unknown), ", ".join(ALL_VOLUMES)))

    volumes = scriptures_source.load_volumes(args.data)
    conn = db.connect(args.db)
    try:
        for slug in selected:
            vol = volumes[slug]
            before = conn.execute("SELECT COUNT(*) c FROM books").fetchone()["c"]
            book_id = ingest.ingest_scriptures(conn, vol)
            after = conn.execute("SELECT COUNT(*) c FROM books").fetchone()["c"]
            n_ch = conn.execute("SELECT COUNT(*) c FROM chapters WHERE book_id=?",
                                (book_id,)).fetchone()["c"]
            n_bl = conn.execute("SELECT COUNT(*) c FROM blocks WHERE book_id=?",
                                (book_id,)).fetchone()["c"]
            status = "created" if after > before else "already present"
            print("[%s] %s: book_id=%d (%s); %d chapters, %d verses"
                  % (slug, vol["title"], book_id, status, n_ch, n_bl))
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
