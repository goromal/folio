import unittest

import folio_mcp_server as srv
from tests.fakes import FakeFolioClient, ErrorClient


class ToolDispatchTest(unittest.TestCase):
    def test_list_books(self):
        c = FakeFolioClient(list_books=[{"id": 1, "title": "B"}])
        out = srv.handle_tool_call(c, "folio_list_books", {})
        self.assertEqual(out, [{"id": 1, "title": "B"}])
        self.assertEqual(c.calls[0], ("list_books", {}))

    def test_get_toc(self):
        c = FakeFolioClient()
        srv.handle_tool_call(c, "folio_get_toc", {"book_id": 7})
        self.assertEqual(c.calls[0], ("get_toc", {"book_id": 7}))

    def test_get_section_text_joins_blocks(self):
        c = FakeFolioClient(get_blocks=[{"text": "one"}, {"text": "two"}])
        out = srv.handle_tool_call(
            c, "folio_get_section_text", {"book_id": 1, "chapter_id": 2})
        self.assertEqual(out, {"text": "one\n\ntwo"})
        self.assertEqual(c.calls[0], ("get_blocks", {"book_id": 1, "chapter_id": 2}))

    def test_get_blocks_returns_blocks_with_ids(self):
        blocks = [{"id": 10, "text": "one"}, {"id": 11, "text": "two"}]
        c = FakeFolioClient(get_blocks=blocks)
        out = srv.handle_tool_call(
            c, "folio_get_blocks", {"book_id": 1, "chapter_id": 2})
        self.assertEqual(out, blocks)
        self.assertEqual(c.calls[0], ("get_blocks", {"book_id": 1, "chapter_id": 2}))

    def test_delete_passage(self):
        c = FakeFolioClient(delete_passage=None)
        out = srv.handle_tool_call(c, "folio_delete_passage", {"passage_id": 3})
        self.assertEqual(out, {"deleted": True})
        self.assertEqual(c.calls[0], ("delete_passage", {"passage_id": 3}))

    def test_delete_highlight(self):
        c = FakeFolioClient(delete_highlight=None)
        srv.handle_tool_call(c, "folio_delete_highlight", {"highlight_id": 9})
        self.assertEqual(c.calls[0], ("delete_highlight", {"highlight_id": 9}))

    def test_delete_tag(self):
        c = FakeFolioClient(delete_tag=None)
        srv.handle_tool_call(c, "folio_delete_tag", {"passage_id": 3, "tag_id": 2})
        self.assertEqual(c.calls[0], ("delete_tag", {"passage_id": 3, "tag_id": 2}))

    def test_delete_note(self):
        c = FakeFolioClient(delete_note=None)
        srv.handle_tool_call(c, "folio_delete_note", {"note_id": 4})
        self.assertEqual(c.calls[0], ("delete_note", {"note_id": 4}))

    def test_search(self):
        c = FakeFolioClient()
        srv.handle_tool_call(c, "folio_search",
                             {"book_id": 1, "query": "fox", "limit": 5})
        self.assertEqual(c.calls[0],
                         ("search", {"book_id": 1, "query": "fox", "limit": 5}))

    def test_create_passage(self):
        c = FakeFolioClient()
        srv.handle_tool_call(c, "folio_create_passage", {
            "book_id": 1, "start_block": 10, "start_off": 0,
            "end_block": 10, "end_off": 4})
        self.assertEqual(c.calls[0][0], "create_passage")
        self.assertEqual(c.calls[0][1]["end_off"], 4)

    def test_add_note_scope_passthrough(self):
        c = FakeFolioClient()
        srv.handle_tool_call(c, "folio_add_note", {"body": "n", "passage_id": 3})
        self.assertEqual(c.calls[0],
                         ("add_note", {"body": "n", "passage_id": 3,
                                       "chapter_id": None, "book_id": None}))

    def test_add_highlight_default_color(self):
        c = FakeFolioClient()
        srv.handle_tool_call(c, "folio_add_highlight", {"passage_id": 3})
        self.assertEqual(c.calls[0],
                         ("add_highlight", {"passage_id": 3, "color": "yellow"}))

    def test_add_tag(self):
        c = FakeFolioClient()
        srv.handle_tool_call(c, "folio_add_tag", {"passage_id": 3, "name": "x"})
        self.assertEqual(c.calls[0], ("add_tag", {"passage_id": 3, "name": "x"}))

    def test_link_passages(self):
        c = FakeFolioClient()
        srv.handle_tool_call(c, "folio_link_passages",
                             {"from_passage": 1, "to_passage": 2})
        self.assertEqual(c.calls[0],
                         ("link_passages",
                          {"from_passage": 1, "to_passage": 2, "note": None}))

    def test_goto_with_block_id(self):
        c = FakeFolioClient()
        srv.handle_tool_call(c, "folio_goto", {"block_id": 5})
        self.assertEqual(c.calls[-1], ("goto", {"block_id": 5}))

    def test_goto_resolves_passage_to_start_block(self):
        c = FakeFolioClient(get_passage={"start_block": 7})
        srv.handle_tool_call(c, "folio_goto", {"passage_id": 2})
        self.assertEqual(c.calls[-1], ("goto", {"block_id": 7}))

    def test_goto_requires_an_id(self):
        c = FakeFolioClient()
        # Missing ids surface as a graceful {"error": ...} (the stdio loop has no
        # outer try/except — a raised exception would crash the server).
        result = srv.handle_tool_call(c, "folio_goto", {})
        self.assertIn("error", result)

    def test_unknown_tool(self):
        out = srv.handle_tool_call(FakeFolioClient(), "folio_nope", {})
        self.assertEqual(out, {"error": "Unknown tool: folio_nope"})

    def test_client_exception_becomes_error(self):
        out = srv.handle_tool_call(ErrorClient(), "folio_list_books", {})
        self.assertEqual(out, {"error": "boom"})


class LeaseToolTest(unittest.TestCase):
    def test_lease_status(self):
        c = FakeFolioClient(lease_status={"role": "spoke", "held": False, "holder": None})
        out = srv.handle_tool_call(c, "folio_lease_status", {})
        self.assertEqual(out, {"role": "spoke", "held": False, "holder": None})
        self.assertEqual(c.calls[0], ("lease_status", {}))

    def test_lease_acquire(self):
        c = FakeFolioClient(lease_acquire={"held": True, "holder": "dell"})
        out = srv.handle_tool_call(c, "folio_lease_acquire", {})
        self.assertEqual(out, {"held": True, "holder": "dell"})
        self.assertEqual(c.calls[0], ("lease_acquire", {}))

    def test_lease_release(self):
        c = FakeFolioClient(lease_release={"held": False, "holder": None})
        out = srv.handle_tool_call(c, "folio_lease_release", {"discard": True})
        self.assertEqual(out, {"held": False, "holder": None})
        self.assertEqual(c.calls[0], ("lease_release", {"discard": True}))


if __name__ == "__main__":
    unittest.main()
