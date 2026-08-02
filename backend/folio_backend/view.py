import asyncio
import json


class ViewState:
    """In-process view-focus channel: the latest focus + async subscriber queues.
    uvicorn runs a single process, so an in-memory fan-out is sufficient."""

    def __init__(self):
        self._focus = None
        self._version = 0
        self._subscribers = set()

    @property
    def focus(self):
        return self._focus

    def _fanout(self, event):
        for q in list(self._subscribers):
            q.put_nowait(event)

    async def publish(self, book_id, chapter_id, block_id):
        self._version += 1
        self._focus = {
            "type": "focus",
            "version": self._version,
            "book_id": book_id,
            "chapter_id": chapter_id,
            "block_id": block_id,
        }
        self._fanout(self._focus)
        return self._focus

    async def publish_change(self):
        self._fanout({"type": "changed"})

    def subscribe(self):
        q = asyncio.Queue()
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q):
        self._subscribers.discard(q)


async def focus_event_stream(view):
    """SSE body: emit the current focus immediately (so a fresh reader syncs),
    then each new focus; a keep-alive comment every 15s of silence.

    Kept as a module-level generator (not an inline closure) so its first-frame
    behavior can be unit-tested deterministically without an HTTP stream read
    (iterating the infinite body over TestClient deadlocks)."""
    q = view.subscribe()
    try:
        if view.focus is not None:
            yield f"data: {json.dumps(view.focus)}\n\n"
        while True:
            try:
                focus = await asyncio.wait_for(q.get(), timeout=15)
                yield f"data: {json.dumps(focus)}\n\n"
            except asyncio.TimeoutError:
                yield ": keep-alive\n\n"
    finally:
        view.unsubscribe(q)


class ChangeBroadcastMiddleware:
    """Raw ASGI middleware: broadcast a 'changed' event after any successful data
    mutation so open readers auto-refresh. Raw ASGI (not Starlette's
    BaseHTTPMiddleware) because the latter buffers the response body and would
    break the SSE stream."""

    def __init__(self, app, view):
        self.app = app
        self.view = view

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        status = {"code": 0}

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                status["code"] = message["status"]
            await send(message)

        await self.app(scope, receive, send_wrapper)
        if (scope["method"] in ("POST", "PUT", "DELETE")
                and 200 <= status["code"] < 300
                and not scope["path"].startswith("/view/")
                and not scope["path"].endswith("/position")):
            await self.view.publish_change()
