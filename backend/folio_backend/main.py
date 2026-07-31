import os

from folio_backend.app import create_app

DEFAULT_DB = "/var/lib/folio/folio.db"


def build_app(db_path=None):
    return create_app(db_path or os.environ.get("FOLIO_DB", DEFAULT_DB))


def run():
    import uvicorn
    host = os.environ.get("FOLIO_HOST", "127.0.0.1")
    port = int(os.environ.get("FOLIO_PORT", "8000"))
    uvicorn.run(build_app(), host=host, port=port)


if __name__ == "__main__":
    run()
