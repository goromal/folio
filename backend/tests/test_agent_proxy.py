import asyncio
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

import websockets
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from folio_backend import agent_proxy
from folio_backend.agent_router import COOKIE


class FakeAuth:
    def is_authenticated(self, cookie):
        return cookie == "good"


class _Recorder(BaseHTTPRequestHandler):
    seen = None

    def do_GET(self):
        _Recorder.seen = dict(self.headers)
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"ttyd-html")

    def log_message(self, *a):
        pass


class HttpProxyTest(unittest.TestCase):
    def setUp(self):
        _Recorder.seen = None
        self.srv = HTTPServer(("127.0.0.1", 0), _Recorder)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        app = FastAPI()
        agent_proxy.register_agent_terminal_proxy(
            app, FakeAuth(), f"http://127.0.0.1:{self.srv.server_address[1]}")
        self.client = TestClient(app)

    def tearDown(self):
        self.srv.shutdown()

    def test_forwards_with_header_when_authed(self):
        self.client.cookies.set(COOKIE, "good")
        r = self.client.get("/folio/agent/terminal/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.text, "ttyd-html")
        self.assertEqual(_Recorder.seen.get("X-Folio-Agent-Authenticated"), "yes")

    def test_rejects_http_without_cookie(self):
        r = self.client.get("/folio/agent/terminal/")
        self.assertEqual(r.status_code, 401)
        self.assertIsNone(_Recorder.seen)


class WsProxyTest(unittest.TestCase):
    def setUp(self):
        self.handshake = {}
        self._loop = asyncio.new_event_loop()
        self._ready = threading.Event()
        self._port = None

        def run():
            asyncio.set_event_loop(self._loop)

            async def handler(conn):
                self.handshake = dict(conn.request.headers)
                async for msg in conn:
                    await conn.send(msg)

            async def main():
                server = await websockets.serve(handler, "127.0.0.1", 0)
                self._port = server.sockets[0].getsockname()[1]
                self._ready.set()
                await asyncio.Future()

            self._loop.run_until_complete(main())

        threading.Thread(target=run, daemon=True).start()
        self._ready.wait(5)
        app = FastAPI()
        agent_proxy.register_agent_terminal_proxy(
            app, FakeAuth(), f"http://127.0.0.1:{self._port}")
        self.client = TestClient(app)

    def test_ws_echo_and_header(self):
        self.client.cookies.set(COOKIE, "good")
        with self.client.websocket_connect("/folio/agent/terminal/ws") as ws:
            ws.send_text("ping")
            self.assertEqual(ws.receive_text(), "ping")
        # websockets.datastructures.Headers.__setitem__ lowercases keys, so
        # dict(conn.request.headers) always yields lowercase names regardless
        # of the case used on the wire (verified: Headers()["X"]="v"; dict(h)
        # -> {"x": "v"}). Look up case-insensitively, per RFC 7230 semantics.
        self.assertEqual(
            {k.lower(): v for k, v in self.handshake.items()}.get(
                "x-folio-agent-authenticated"),
            "yes")

    def test_ws_rejects_without_cookie(self):
        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect("/folio/agent/terminal/ws") as ws:
                ws.receive_text()


if __name__ == "__main__":
    unittest.main()
