import asyncio
import os
import tempfile
import unittest

from fastapi.testclient import TestClient

from folio_backend.app import create_app
from folio_backend.view import ViewState, focus_event_stream, ChangeBroadcastMiddleware
from tests.helpers import make_fixture_epub


class ViewStateTest(unittest.TestCase):
    def test_publish_fanout_and_version(self):
        async def run():
            vs = ViewState()
            q = vs.subscribe()
            f = await vs.publish(1, 2, 3)
            self.assertEqual(f["version"], 1)
            self.assertEqual(f["block_id"], 3)
            self.assertEqual(q.get_nowait(), f)
            f2 = await vs.publish(1, 2, 4)
            self.assertEqual(f2["version"], 2)
        asyncio.run(run())

    def test_publish_change_fanout(self):
        async def run():
            vs = ViewState()
            q = vs.subscribe()
            await vs.publish_change()
            self.assertEqual(q.get_nowait(), {"type": "changed"})
        asyncio.run(run())

    def test_focus_event_is_typed(self):
        async def run():
            vs = ViewState()
            q = vs.subscribe()
            await vs.publish(1, 2, 3)
            self.assertEqual(q.get_nowait()["type"], "focus")
        asyncio.run(run())


class ViewApiTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False); tmp.close()
        self.app = create_app(tmp.name)
        self.client = TestClient(self.app)
        ep = os.path.join(tempfile.mkdtemp(), "f.epub"); make_fixture_epub(ep)
        with open(ep, "rb") as fh:
            self.bid = self.client.post(
                "/books", files={"file": ("f.epub", fh, "application/epub+zip")}).json()["id"]
        self.b0 = self.client.get(f"/books/{self.bid}/blocks").json()[0]

    def test_focus_resolves_book_and_chapter(self):
        r = self.client.post("/view/focus", json={"block_id": self.b0["id"]})
        self.assertEqual(r.status_code, 200)
        f = r.json()
        self.assertEqual(f["book_id"], self.bid)
        self.assertEqual(f["chapter_id"], self.b0["chapter_id"])
        self.assertEqual(f["block_id"], self.b0["id"])

    def test_focus_unknown_block_404(self):
        self.assertEqual(
            self.client.post("/view/focus", json={"block_id": 999999}).status_code, 404)

    def test_stream_route_registered(self):
        # Do NOT open the SSE stream over TestClient — an infinite event-stream
        # body deadlocks it (even on context close). Assert the route exists; the
        # body is unit-tested in FocusStreamTest and the media type is set where
        # the StreamingResponse is constructed.
        paths = [getattr(r, "path", None) for r in self.app.routes]
        self.assertIn("/view/stream", paths)


class FocusStreamTest(unittest.TestCase):
    def test_first_frame_is_current_focus(self):
        async def run():
            vs = ViewState()
            await vs.publish(4, 5, 6)
            gen = focus_event_stream(vs)
            try:
                first = await gen.__anext__()
                self.assertTrue(first.startswith("data:"))
                self.assertIn('"block_id": 6', first)
            finally:
                await gen.aclose()
        asyncio.run(run())


class ChangeMiddlewareTest(unittest.TestCase):
    def _run(self, method, path, status):
        async def run():
            vs = ViewState()
            q = vs.subscribe()

            async def app(scope, receive, send):
                await send({"type": "http.response.start", "status": status, "headers": []})
                await send({"type": "http.response.body", "body": b""})

            async def receive():
                return {"type": "http.request"}

            async def send(_m):
                pass

            mw = ChangeBroadcastMiddleware(app, vs)
            await mw({"type": "http", "method": method, "path": path}, receive, send)
            return q
        return asyncio.run(run())

    def test_broadcasts_on_successful_mutation(self):
        q = self._run("POST", "/passages", 201)
        self.assertEqual(q.get_nowait(), {"type": "changed"})

    def test_no_broadcast_on_get(self):
        self.assertTrue(self._run("GET", "/books", 200).empty())

    def test_no_broadcast_on_view_path(self):
        self.assertTrue(self._run("POST", "/view/focus", 200).empty())

    def test_no_broadcast_on_error(self):
        self.assertTrue(self._run("POST", "/passages", 400).empty())


if __name__ == "__main__":
    unittest.main()
