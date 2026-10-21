import os
import tempfile
import unittest

from ebooklib import epub

from folio_backend import ingest
from tests.helpers import temp_db


def _make_div_epub(path):
    """EPUB shaped like Kindle->EPUB conversions (e.g. "Bad Blood"): no <p> or
    <h*> tags at all -- every paragraph and heading is a classed <div>, drop
    caps are split into <span>s, and per-chapter endnote files are left out
    of the TOC."""
    book = epub.EpubBook()
    book.set_identifier("folio-fixture-div-001")
    book.set_title("Div Book")
    book.add_author("Test Author")

    cover = epub.EpubHtml(title="Cover", file_name="cover.xhtml", lang="en")
    cover.content = '<div><img src="cover.jpg" alt="cover"/></div>'

    c1 = epub.EpubHtml(title="1. Goodbye East Paly", file_name="part0001.xhtml",
                       lang="en")
    c1.content = (
        '<div class="class_st"><div class="class_st">'
        '<div class="heading_s6m">| ONE |</div>'
        '<div class="heading_s6p">Goodbye East Paly</div>'
        '<div class="class_st"><span class="class_s6"><span class="class_s2j">'
        'I</span></span>n early 2008, Theranos moved.</div>'
        '<div class="class_s4p">Appearances in the Valley are paramount.</div>'
        '</div></div>'
    )
    notes = epub.EpubHtml(title="Notes", file_name="part0002.xhtml", lang="en")
    notes.content = '<div class="class_st"><div class="heading_s1uu">Notes</div></div>'
    notes1 = epub.EpubHtml(title="", file_name="part0003.xhtml", lang="en")
    notes1.content = (
        '<div class="class_st"><div class="heading_s1v">1. GOODBYE EAST PALY</div>'
        '<div class="class_s1v1"><a href="part0001.xhtml"><span>Theranos moved'
        '</span></a><span>:</span> Interview notes.</div></div>'
    )
    listy = epub.EpubHtml(title="Lists", file_name="part0004.xhtml", lang="en")
    listy.content = "<ul><li><p>Only once.</p></li></ul>"

    for item in (cover, c1, notes, notes1, listy):
        book.add_item(item)
    book.toc = (c1, notes, listy)
    book.spine = [cover, c1, notes, notes1, listy]
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    epub.write_epub(str(path), book)
    return str(path)


class IngestDivTest(unittest.TestCase):
    def setUp(self):
        self.conn, _ = temp_db()
        path = os.path.join(tempfile.mkdtemp(), "div_fixture.epub")
        self.book_id = ingest.ingest_epub(self.conn, _make_div_epub(path))

    def _chapters(self):
        return self.conn.execute(
            "SELECT id, title FROM chapters WHERE book_id = ? ORDER BY order_idx",
            (self.book_id,)).fetchall()

    def _blocks(self, chapter_id):
        return [(b["type"], b["text"]) for b in self.conn.execute(
            "SELECT type, text FROM blocks WHERE chapter_id = ? ORDER BY order_idx",
            (chapter_id,))]

    def test_div_text_becomes_blocks(self):
        chap = self._chapters()[0]
        self.assertEqual(self._blocks(chap["id"]), [
            ("heading", "| ONE |"),
            ("heading", "Goodbye East Paly"),
            ("para", "In early 2008, Theranos moved."),
            ("para", "Appearances in the Valley are paramount."),
        ])

    def test_chapter_titles_come_from_toc_and_empty_docs_are_dropped(self):
        self.assertEqual([c["title"] for c in self._chapters()],
                         ["1. Goodbye East Paly", "Notes", "Lists"])

    def test_docs_missing_from_toc_continue_previous_chapter(self):
        notes = self._chapters()[1]
        self.assertEqual(self._blocks(notes["id"]), [
            ("heading", "Notes"),
            ("heading", "1. GOODBYE EAST PALY"),
            ("para", "Theranos moved: Interview notes."),
        ])

    def test_nested_block_tags_are_not_duplicated(self):
        lists = self._chapters()[2]
        self.assertEqual(self._blocks(lists["id"]), [("list", "Only once.")])


if __name__ == "__main__":
    unittest.main()
