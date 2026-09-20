"""Reverse-proxy /folio/agent/terminal/** to ttyd so the backend serves the agent
terminal directly. On the web nginx proxies this to ttyd; the Electron desktop loads
the SPA from the backend and never touches nginx, so without this the terminal iframe
404s (black panel). HTTP and the WebSocket data channel are forwarded to ttyd with the
X-Folio-Agent-Authenticated header ttyd requires, gated by the agent session cookie."""
import asyncio

import httpx
import websockets
from starlette.requests import Request
from starlette.responses import Response
from starlette.websockets import WebSocket, WebSocketDisconnect

from folio_backend.agent_router import COOKIE

TERMINAL_PREFIX = "/folio/agent/terminal"
AUTH_HEADER = "X-Folio-Agent-Authenticated"
_HOP = {"connection", "keep-alive", "transfer-encoding", "content-encoding",
        "content-length", "upgrade", "host"}


def register_agent_terminal_proxy(app, auth, origin):
    """Register the terminal proxy on `app`. `origin` is ttyd's base URL
    (e.g. http://127.0.0.1:6870). MUST be called before the /folio static mount."""
    origin = origin.rstrip("/")
    ws_origin = "ws" + origin[len("http"):]  # http->ws, https->wss

    def authed(cookies):
        return auth.is_authenticated(cookies.get(COOKIE))

    @app.websocket(TERMINAL_PREFIX + "/{path:path}")
    async def terminal_ws(client: WebSocket, path: str):
        if not authed(client.cookies):
            await client.close(code=1008)
            return
        query = client.url.query
        url = f"{ws_origin}{TERMINAL_PREFIX}/{path}" + (f"?{query}" if query else "")
        subprotocols = client.scope.get("subprotocols") or None
        try:
            upstream = await websockets.connect(
                url, additional_headers={AUTH_HEADER: "yes"},
                subprotocols=subprotocols, open_timeout=10, max_size=None)
        except Exception:
            await client.close(code=1011)
            return
        await client.accept(subprotocol=upstream.subprotocol)
        try:
            await _bridge(client, upstream)
        finally:
            await upstream.close()

    @app.api_route(TERMINAL_PREFIX + "/{path:path}", methods=["GET", "POST"])
    async def terminal_http(request: Request, path: str):
        if not authed(request.cookies):
            return Response(status_code=401)
        url = f"{origin}{TERMINAL_PREFIX}/{path}"
        headers = {k: v for k, v in request.headers.items() if k.lower() not in _HOP}
        headers[AUTH_HEADER] = "yes"
        body = await request.body()
        async with httpx.AsyncClient() as http:
            up = await http.request(request.method, url, params=request.query_params,
                                    headers=headers, content=body, timeout=30)
        out = {k: v for k, v in up.headers.items() if k.lower() not in _HOP}
        return Response(content=up.content, status_code=up.status_code, headers=out)


async def _bridge(client: WebSocket, upstream):
    async def c2u():
        try:
            while True:
                msg = await client.receive()
                if msg["type"] == "websocket.disconnect":
                    break
                if msg.get("text") is not None:
                    await upstream.send(msg["text"])
                elif msg.get("bytes") is not None:
                    await upstream.send(msg["bytes"])
        except WebSocketDisconnect:
            pass
        finally:
            await upstream.close()

    async def u2c():
        try:
            async for msg in upstream:
                if isinstance(msg, (bytes, bytearray)):
                    await client.send_bytes(bytes(msg))
                else:
                    await client.send_text(msg)
        except websockets.ConnectionClosed:
            pass
        finally:
            try:
                await client.close()
            except RuntimeError:
                pass

    await asyncio.gather(c2u(), u2c())
