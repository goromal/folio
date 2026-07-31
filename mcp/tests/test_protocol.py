import unittest

import folio_mcp_server as srv
from tests.fakes import FakeFolioClient

EXPECTED_TOOLS = {
    "folio_list_books", "folio_get_toc", "folio_get_section_text", "folio_search",
    "folio_get_passage", "folio_create_passage", "folio_add_note",
    "folio_add_highlight", "folio_add_tag", "folio_link_passages",
    "folio_store_summary", "folio_get_summaries", "folio_export_prepare",
}


class ProtocolTest(unittest.TestCase):
    def test_tools_list_advertises_all(self):
        resp = srv.handle_request(FakeFolioClient(),
                                  {"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
        names = {t["name"] for t in resp["result"]["tools"]}
        self.assertEqual(names, EXPECTED_TOOLS)
        for t in resp["result"]["tools"]:
            self.assertIn("inputSchema", t)

    def test_initialize(self):
        resp = srv.handle_request(FakeFolioClient(),
                                  {"jsonrpc": "2.0", "id": 1, "method": "initialize"})
        self.assertEqual(resp["result"]["serverInfo"]["name"], "folio-mcp-server")

    def test_tools_call_wraps_result(self):
        c = FakeFolioClient(list_books=[{"id": 1}])
        resp = srv.handle_request(c, {
            "jsonrpc": "2.0", "id": 2, "method": "tools/call",
            "params": {"name": "folio_list_books", "arguments": {}}})
        content = resp["result"]["content"][0]
        self.assertEqual(content["type"], "text")
        self.assertIn('"id": 1', content["text"])

    def test_unknown_method(self):
        resp = srv.handle_request(FakeFolioClient(),
                                  {"jsonrpc": "2.0", "id": 3, "method": "bogus"})
        self.assertIn("error", resp)
        self.assertEqual(resp["error"]["code"], -32601)


if __name__ == "__main__":
    unittest.main()
