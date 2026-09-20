"""Turn the bcbooks/scriptures-json dataset into normalized volumes.

Dataset: https://github.com/bcbooks/scriptures-json (public domain). Download the
five JSON files into a directory and pass it to load_volumes(). The dataset omits
copyrighted material (footnotes, chapter summaries, D&C Official Declarations)."""
import json
from pathlib import Path

_BIBLE_LABEL = "King James Version"
_CHURCH = "The Church of Jesus Christ of Latter-day Saints"


def _verses(raw_verses):
    return [{"num": v["verse"], "text": v["text"]} for v in raw_verses]


def _chapters_from_books(books):
    """BoM / Bible / PoGP shape: books[] -> flat chapters[] titled by `reference`."""
    chapters = []
    for book in books:
        for chapter in book["chapters"]:
            chapters.append({
                "title": chapter["reference"],
                "verses": _verses(chapter["verses"]),
            })
    return chapters


def _chapters_from_sections(sections):
    """D&C shape: sections[] each already carrying a `reference` like 'D&C 1'."""
    return [{"title": s["reference"], "verses": _verses(s["verses"])}
            for s in sections]


def _load(data_dir, name):
    return json.loads((Path(data_dir) / name).read_text(encoding="utf-8"))


def load_volumes(data_dir):
    """Return {slug: Volume} for bible, bom, dc, pgp."""
    ot = _load(data_dir, "old-testament.json")
    nt = _load(data_dir, "new-testament.json")
    bom = _load(data_dir, "book-of-mormon.json")
    dc = _load(data_dir, "doctrine-and-covenants.json")
    pgp = _load(data_dir, "pearl-of-great-price.json")

    return {
        "bible": {
            "title": "The Holy Bible (King James Version)",
            "label": _BIBLE_LABEL,
            "chapters": _chapters_from_books(ot["books"])
                        + _chapters_from_books(nt["books"]),
        },
        "bom": {
            "title": "The Book of Mormon",
            "label": _CHURCH,
            "chapters": _chapters_from_books(bom["books"]),
        },
        "dc": {
            "title": "The Doctrine and Covenants",
            "label": _CHURCH,
            "chapters": _chapters_from_sections(dc["sections"]),
        },
        "pgp": {
            "title": "The Pearl of Great Price",
            "label": _CHURCH,
            "chapters": _chapters_from_books(pgp["books"]),
        },
    }
