import json
import tempfile

from folio_backend.app import create_app


def dump():
    """Return the backend's OpenAPI schema as a dict (used for TS client codegen)."""
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    return create_app(tmp.name).openapi()


def main():
    print(json.dumps(dump(), indent=2))


if __name__ == "__main__":
    main()
