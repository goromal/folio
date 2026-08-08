class FakeFolioClient:
    """Records calls and returns canned data for MCP dispatch tests."""

    def __init__(self, **canned):
        self.calls = []
        self.canned = canned

    def _record(self, _tool_name, **kwargs):
        self.calls.append((_tool_name, kwargs))
        return self.canned.get(_tool_name, {"ok": _tool_name})

    def list_books(self):
        return self._record("list_books")

    def get_toc(self, book_id):
        return self._record("get_toc", book_id=book_id)

    def get_blocks(self, book_id, chapter_id=None):
        return self._record("get_blocks", book_id=book_id, chapter_id=chapter_id)

    def search(self, book_id, query, limit=20):
        return self._record("search", book_id=book_id, query=query, limit=limit)

    def get_passage(self, passage_id):
        return self._record("get_passage", passage_id=passage_id)

    def create_passage(self, book_id, start_block, start_off, end_block, end_off):
        return self._record("create_passage", book_id=book_id, start_block=start_block,
                            start_off=start_off, end_block=end_block, end_off=end_off)

    def add_note(self, body, passage_id=None, chapter_id=None, book_id=None):
        return self._record("add_note", body=body, passage_id=passage_id,
                            chapter_id=chapter_id, book_id=book_id)

    def add_highlight(self, passage_id, color="yellow"):
        return self._record("add_highlight", passage_id=passage_id, color=color)

    def add_tag(self, passage_id, name):
        return self._record("add_tag", passage_id=passage_id, name=name)

    def link_passages(self, from_passage, to_passage, note=None):
        return self._record("link_passages", from_passage=from_passage,
                            to_passage=to_passage, note=note)

    def goto(self, block_id):
        return self._record("goto", block_id=block_id)

    def delete_passage(self, passage_id):
        return self._record("delete_passage", passage_id=passage_id)

    def delete_highlight(self, highlight_id):
        return self._record("delete_highlight", highlight_id=highlight_id)

    def delete_tag(self, passage_id, tag_id):
        return self._record("delete_tag", passage_id=passage_id, tag_id=tag_id)

    def delete_note(self, note_id):
        return self._record("delete_note", note_id=note_id)

    # higher-order (used by later tasks' tests)
    def store_summary(self, scope, scope_id, body):
        return self._record("store_summary", scope=scope, scope_id=scope_id, body=body)

    def get_summaries(self, scope, scope_id):
        return self._record("get_summaries", scope=scope, scope_id=scope_id)

    def list_book_notes(self, book_id, chapter_id=None):
        return self._record("list_book_notes", book_id=book_id, chapter_id=chapter_id)

    def list_book_passages(self, book_id):
        return self._record("list_book_passages", book_id=book_id)

    def list_book_summaries(self, book_id):
        return self._record("list_book_summaries", book_id=book_id)


class ErrorClient:
    def list_books(self):
        raise Exception("boom")
