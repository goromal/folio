import os

from folio_backend.app import create_app

DEFAULT_DB = "/var/lib/folio/folio.db"
# Open /view SSE streams never close on their own; without a cap uvicorn waits
# on them forever at shutdown and systemd only SIGKILLs it at its 90 s stop
# timeout, stalling every nixos-rebuild switch while a reader tab is open.
SHUTDOWN_GRACE_S = 3


def build_app(db_path=None):
    return create_app(db_path or os.environ.get("FOLIO_DB", DEFAULT_DB))


def run():
    import uvicorn
    host = os.environ.get("FOLIO_HOST", "127.0.0.1")
    port = int(os.environ.get("FOLIO_PORT", "8000"))
    uvicorn.run(build_app(), host=host, port=port,
                timeout_graceful_shutdown=SHUTDOWN_GRACE_S)


if __name__ == "__main__":
    run()
