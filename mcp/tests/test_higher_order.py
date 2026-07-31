import unittest

import folio_mcp_server as srv
from tests.fakes import FakeFolioClient


class HigherOrderTest(unittest.TestCase):
    def test_store_summary(self):
        c = FakeFolioClient()
        srv.handle_tool_call(c, "folio_store_summary",
                             {"scope": "book", "scope_id": 1, "body": "gist"})
        self.assertEqual(c.calls[0],
                         ("store_summary", {"scope": "book", "scope_id": 1,
                                            "body": "gist"}))

    def test_get_summaries(self):
        c = FakeFolioClient()
        srv.handle_tool_call(c, "folio_get_summaries",
                             {"scope": "chapter", "scope_id": 3})
        self.assertEqual(c.calls[0],
                         ("get_summaries", {"scope": "chapter", "scope_id": 3}))

    def test_export_prepare_composes_markdown(self):
        c = FakeFolioClient(
            list_books=[{"id": 1, "title": "My Book"}],
            list_book_summaries=[{"scope": "book", "scope_id": 1,
                                  "generated_by": "agent", "body": "the gist"}],
            list_book_notes=[{"body": "a key note"}],
            list_book_passages=[{"id": 5, "start_block": 10, "start_off": 0,
                                 "end_block": 10, "end_off": 8,
                                 "highlights": [{"id": 1, "color": "green"}],
                                 "notes": [], "tags": [{"id": 1, "name": "theme"}]}],
        )
        out = srv.handle_tool_call(c, "folio_export_prepare", {"book_id": 1})
        self.assertEqual(out["title"], "My Book")
        md = out["markdown"]
        self.assertIn("My Book", md)
        self.assertIn("the gist", md)
        self.assertIn("a key note", md)
        self.assertIn("passage 5", md)
        self.assertIn("theme", md)


if __name__ == "__main__":
    unittest.main()
