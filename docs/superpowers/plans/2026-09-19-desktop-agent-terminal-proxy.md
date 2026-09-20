# Desktop Agent-Terminal Proxy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the backend reverse-proxy `/folio/agent/terminal/**` to ttyd (HTTP + WebSocket) so the Electron desktop — which loads the SPA straight from the backend, bypassing nginx — can reach the agent terminal instead of showing a black panel.

**Architecture:** A new `agent_proxy` module registers an HTTP passthrough and a WebSocket bridge to ttyd, injecting the `X-Folio-Agent-Authenticated` header and enforcing the existing `folio_agent_session` cookie. It is registered **before** the `/folio` static mount so `StaticFiles` doesn't shadow it. nginx and `desktop/main.js` are unchanged (web keeps its nginx→ttyd path).

**Tech Stack:** Python 3, FastAPI/Starlette, `httpx` (already a dep), **`websockets` 15** (new dep), `unittest`. NixOS wiring in `anixpkgs`.

**Spec:** `docs/superpowers/specs/2026-09-19-desktop-agent-terminal-proxy-design.md`

---

## Background the implementer needs

- Work in `folio/backend/` (package `folio_backend`) for Tasks 1–2, `anixpkgs/` for Task 3, and deploy in Task 4. This spans two repos — see the `workspace-development` workflow.
- **Root cause (confirmed):** desktop loads `http://localhost:6868/folio`; the terminal iframe `/folio/agent/terminal/…` is only routed by nginx (→ ttyd:6870, header injected). On the backend that path 404s. Fix = backend proxies it.
- **Auth:** cookie name `folio_agent_session` (`agent_router.COOKIE`); validate with `AgentAuth.is_authenticated(cookie)`. `AgentAuth` is deterministic from the secrets file, built in `create_app`.
- **Ordering gotcha:** `create_app` mounts `StaticFiles` at `/folio` (app.py ~246–251) *before* the companion block. Starlette matches in registration order, so the proxy route MUST be registered before that mount.
- **ttyd facts:** base-path `/folio/agent/terminal`, WS data channel at `<base>/ws`, requires the `tty` **subprotocol** and the `X-Folio-Agent-Authenticated` header; bound to `127.0.0.1:<agentTerminal>` (6870).
- **`websockets` 15 API:** `await websockets.connect(uri, additional_headers=…, subprotocols=…)` returns a connection; `.subprotocol`, `.send(str|bytes)`, `async for msg in conn`, closes raise `websockets.ConnectionClosed`. Server: `websockets.serve(handler, host, 0)`; handler gets a connection with `.request.headers`.
- **Test shell** (adds `websockets`): `nix-shell -p 'python3.withPackages(ps: with ps; [ fastapi uvicorn pydantic httpx werkzeug python-multipart starlette ebooklib beautifulsoup4 websockets ])' --run '<cmd>'`.

## File structure

- `folio_backend/agent_proxy.py` — **create**: `register_agent_terminal_proxy(app, auth, origin)` (HTTP + WS routes). Self-contained; no app.py knowledge.
- `folio_backend/app.py` — **modify**: restructure the static/companion region to register the proxy before the `/folio` mount.
- `folio_backend/setup.py` — **modify**: add `websockets`.
- `tests/test_agent_proxy.py` — **create**: proxy unit tests (fake upstreams).
- `tests/test_app_terminal_proxy.py` — **create**: wiring/ordering test.
- `anixpkgs/pkgs/python-packages/folio-backend/default.nix` — **modify**: add `websockets`.
- `anixpkgs/pkgs/modules/folio/module.nix` — **modify**: add `FOLIO_AGENT_TERMINAL_ORIGIN` env.

---

### Task 1: `agent_proxy` module (HTTP + WebSocket)

**Goal:** A self-contained proxy that forwards `/folio/agent/terminal/**` to ttyd for both HTTP and WebSocket, injecting the auth header and enforcing the session cookie.

**Files:**
- Create: `folio_backend/agent_proxy.py`
- Create: `tests/test_agent_proxy.py`

**Acceptance Criteria:**
- [ ] Authed HTTP request is forwarded to `origin` with `X-Folio-Agent-Authenticated: yes`; status/body relayed back.
- [ ] Unauthed HTTP request → 401 with **no** upstream call.
- [ ] Authed WebSocket bridges messages both ways to the upstream; the upstream handshake carried the auth header.
- [ ] Unauthed WebSocket is closed (1008) with no upstream connection.

**Verify:** `nix-shell -p 'python3.withPackages(ps: with ps; [ fastapi uvicorn pydantic httpx werkzeug python-multipart starlette ebooklib beautifulsoup4 websockets ])' --run 'python -m unittest tests.test_agent_proxy -v'` → OK (4 tests)

**Steps:**

- [ ] **Step 1: Write the failing test** — `tests/test_agent_proxy.py`

```python
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
        self.assertIsNone(_Recorder.seen)  # no upstream hit


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
                    await conn.send(msg)  # echo

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
        self.assertEqual(self.handshake.get("X-Folio-Agent-Authenticated"), "yes")

    def test_ws_rejects_without_cookie(self):
        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect("/folio/agent/terminal/ws") as ws:
                ws.receive_text()


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run it, confirm it FAILS** (`ModuleNotFoundError: folio_backend.agent_proxy`).

- [ ] **Step 3: Implement** — `folio_backend/agent_proxy.py`

```python
"""Reverse-proxy /folio/agent/terminal/** to ttyd so the backend serves the agent
terminal directly. On the web nginx proxies this to ttyd; the Electron desktop loads
the SPA from the backend and never touches nginx, so without this the terminal iframe
404s (black panel). HTTP and the WebSocket data channel are forwarded to ttyd with the
X-Folio-Agent-Authenticated header ttyd requires, gated by the agent session cookie."""
import asyncio

import httpx
import websockets
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
    async def terminal_http(request, path: str):
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
```

- [ ] **Step 4: Run the verify command, confirm PASS (OK, 4 tests).**

- [ ] **Step 5: Commit**

```bash
git add folio_backend/agent_proxy.py tests/test_agent_proxy.py
git commit -m "feat(agent): add ttyd terminal reverse-proxy module

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Wire the proxy into `create_app` (before the static mount) + add dep

**Goal:** Register the terminal proxy in `create_app` ahead of the `/folio` static mount when the companion is enabled and `FOLIO_AGENT_TERMINAL_ORIGIN` is set; add `websockets` to deps.

**Files:**
- Modify: `folio_backend/app.py` (the static/companion region, ~246–273)
- Modify: `folio_backend/setup.py`
- Create: `tests/test_app_terminal_proxy.py`

**Acceptance Criteria:**
- [ ] With companion env + a static dir + `FOLIO_AGENT_TERMINAL_ORIGIN`, `GET /folio/agent/terminal/x` (no cookie) → **401** (proxy), not 404/static — proving the route precedes the mount.
- [ ] A normal static path under `/folio` is still served by `StaticFiles`.
- [ ] `websockets` is in `setup.py` `install_requires`.
- [ ] Full existing suite still passes.

**Verify:** `nix-shell -p 'python3.withPackages(ps: with ps; [ fastapi uvicorn pydantic httpx werkzeug python-multipart starlette ebooklib beautifulsoup4 websockets ])' --run 'python -m unittest tests.test_app_terminal_proxy -v && python -m unittest discover -s tests'` → OK

**Steps:**

- [ ] **Step 1: Write the failing test** — `tests/test_app_terminal_proxy.py`

```python
import json
import os
import tempfile
import unittest

from fastapi.testclient import TestClient
from werkzeug.security import generate_password_hash

from folio_backend.app import create_app
from tests.helpers import temp_db


class TerminalProxyWiringTest(unittest.TestCase):
    def setUp(self):
        self._env = dict(os.environ)
        _, self.db_path = temp_db()
        self.static = tempfile.mkdtemp()
        with open(os.path.join(self.static, "index.html"), "w") as fh:
            fh.write("<!doctype html>SPA")
        secrets = os.path.join(tempfile.mkdtemp(), "secrets.json")
        with open(secrets, "w") as fh:
            json.dump({"secret_key": "k" * 32,
                       "password_hash": generate_password_hash("pw")}, fh)
        os.environ["FOLIO_AGENTS"] = "claude"
        os.environ["FOLIO_AGENT_SECRETS"] = secrets
        os.environ["FOLIO_AGENT_TERMINAL_ORIGIN"] = "http://127.0.0.1:6870"
        os.environ["FOLIO_AGENT_SPOOL"] = tempfile.mkdtemp()

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._env)

    def test_proxy_precedes_static_mount(self):
        app = create_app(self.db_path, static_dir=self.static)
        client = TestClient(app)
        # No cookie -> proxy returns 401 (would be 404/static if shadowed by the mount).
        r = client.get("/folio/agent/terminal/somepath")
        self.assertEqual(r.status_code, 401)

    def test_static_still_served(self):
        app = create_app(self.db_path, static_dir=self.static)
        client = TestClient(app)
        r = client.get("/folio/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("SPA", r.text)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run it, confirm it FAILS** (proxy not wired → `/folio/agent/terminal/somepath` returns 404 from the static mount, not 401).

- [ ] **Step 3: Implement** — replace the static/companion region of `folio_backend/app.py` (currently lines ~246–273, from the `# ---- serve built SPA at /folio` comment through the `app.include_router(create_agent_router(...))` line) with:

```python
    # ---- agent companion config (shared by the terminal proxy and the API router) ----
    _agents = tuple(os.environ.get("FOLIO_AGENTS", "").replace(",", " ").split())
    _agent_secrets = os.environ.get("FOLIO_AGENT_SECRETS", "")
    _companion = bool(_agents and _agent_secrets)
    _agent_auth = None
    if _companion:
        from folio_backend.agent_auth import AgentAuth, load_secrets
        _key, _pwhash = load_secrets(_agent_secrets)
        _agent_auth = AgentAuth(_key, _pwhash)

    # ---- agent terminal proxy: MUST precede the /folio static mount so StaticFiles
    # does not shadow it. Lets the Electron desktop (which loads the SPA from the
    # backend, bypassing nginx) reach ttyd. ----
    _terminal_origin = os.environ.get("FOLIO_AGENT_TERMINAL_ORIGIN", "")
    if _companion and _terminal_origin:
        from folio_backend.agent_proxy import register_agent_terminal_proxy
        register_agent_terminal_proxy(app, _agent_auth, _terminal_origin)

    # ---- serve built SPA at /folio (env-gated) ----
    resolved_static = static_dir or os.environ.get("FOLIO_STATIC_DIR")
    if resolved_static and os.path.isdir(resolved_static):
        from fastapi.staticfiles import StaticFiles
        app.mount("/folio", StaticFiles(directory=resolved_static, html=True),
                  name="folio")

    # ---- agent companion API (env-gated) ----
    if _companion:
        from folio_backend.agent import AgentSessions
        from folio_backend.agent_router import create_agent_router
        _spool = os.path.abspath(os.environ.get("FOLIO_AGENT_SPOOL", "/tmp/folio-agent"))
        os.makedirs(_spool, mode=0o700, exist_ok=True)
        _sessions = AgentSessions(
            agents=_agents, spool_dir=_spool,
            tmux_bin=os.environ.get("FOLIO_AGENT_TMUX", "tmux"),
            config=os.environ.get("FOLIO_AGENT_TMUX_CONFIG") or None,
            session_command=os.environ.get(
                "FOLIO_AGENT_SESSION_CMD", "folio-agent-session"),
        )
        app.include_router(create_agent_router(_agent_auth, _sessions))
```

Then add `websockets` to `folio_backend/setup.py` `install_requires` (same line as `httpx`):

```python
        "ebooklib", "beautifulsoup4", "python-multipart", "httpx", "werkzeug",
        "websockets",
```

- [ ] **Step 4: Run the module test then the full suite, confirm PASS / no regressions.**

- [ ] **Step 5: Commit**

```bash
git add folio_backend/app.py folio_backend/setup.py tests/test_app_terminal_proxy.py
git commit -m "feat(agent): serve terminal proxy before the /folio static mount

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: anixpkgs wiring (dependency + service env)

**Goal:** Make the deployed backend depend on `websockets` and know ttyd's origin.

**Files:**
- Modify: `anixpkgs/pkgs/python-packages/folio-backend/default.nix`
- Modify: `anixpkgs/pkgs/modules/folio/module.nix`

**Acceptance Criteria:**
- [ ] `folio-backend` package builds with `websockets` (its checkPhase runs the new tests).
- [ ] The `folio-backend` service sets `FOLIO_AGENT_TERMINAL_ORIGIN=http://127.0.0.1:<agentTerminal>` when the companion is enabled.

**Verify:** `nix build .#folio-backend` (from the anixpkgs flake dir) succeeds and its checkPhase passes. (Full deploy is Task 4.)

**Steps:**

- [ ] **Step 1:** In `anixpkgs/pkgs/python-packages/folio-backend/default.nix`, add `websockets` to the function inputs (after `werkzeug,`) and to `propagatedBuildInputs` (after `werkzeug`):

```nix
  werkzeug,
  websockets,
  wormhole,
```
```nix
    werkzeug
    websockets
    wormhole
```

- [ ] **Step 2:** In `anixpkgs/pkgs/modules/folio/module.nix`, add the env var inside the `++ lib.optionals companion [ … ]` list for the `folio-backend` service (alongside the other `FOLIO_AGENT_*` entries, ~lines 214–219):

```nix
          "FOLIO_AGENT_TERMINAL_ORIGIN=http://127.0.0.1:${toString service-ports.folio.agentTerminal}"
```

- [ ] **Step 3: Build to verify** (from the anixpkgs flake root):

```bash
nix build .#folio-backend
```
Expected: builds; checkPhase runs `python -m unittest discover -s tests` including the two new modules.

- [ ] **Step 4: Commit** (in the anixpkgs repo):

```bash
git add pkgs/python-packages/folio-backend/default.nix pkgs/modules/folio/module.nix
git commit -m "folio: add websockets dep + FOLIO_AGENT_TERMINAL_ORIGIN for terminal proxy

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Deploy and verify end-to-end  `[user-gate]`

> **USER-ORDERED GATE — NON-SKIPPABLE.** This task was requested by the user in the current conversation. It MUST NOT be closed by walking around it, by declaring it "verified inline", or by substituting a cheaper check. Close only after every item in `acceptanceCriteria` has been re-validated independently, with output captured.

**Goal:** Deploy the change to the live machine and confirm the desktop agent terminal renders.

**Files:** none (deploy + verification).

**Acceptance Criteria:**
- [ ] After rebuild, `http://127.0.0.1:6868/folio/agent/terminal/` **without** a session cookie returns **401** (proxy present) instead of **404** (the pre-fix behavior).
- [ ] With a valid session cookie it returns ttyd's HTML (200).
- [ ] In the Electron desktop app: open folio → agent panel → pick an agent → the **terminal renders** (no black panel) and is interactive.

**Verify:** probe (below) shows 401 (no cookie) / 200 (with cookie); plus the manual desktop check.

**Steps:**

- [ ] **Step 1:** Ensure the folio backend changes are committed/pushed and the anixpkgs `folio-src`/`pkg-src` input points at them (see the `workspace-development` workflow for updating the non-flake input).

- [ ] **Step 2: Deploy** using the `anixpkgs-deploy` workflow (NixOS rebuild for this host). Restart `folio-backend.service` if the rebuild does not.

- [ ] **Step 3: Probe the deployed backend** (the pre-fix probe returned 404):

```bash
python3 - <<'PY'
import urllib.request, urllib.error
def code(url):
    try:
        return urllib.request.urlopen(url, timeout=5).status
    except urllib.error.HTTPError as e:
        return e.code
print("no-cookie:", code("http://127.0.0.1:6868/folio/agent/terminal/"))  # expect 401
PY
```
Expected: `no-cookie: 401` (was 404 before the fix).

- [ ] **Step 4: Manual desktop check.** Launch `folio-desktop`, open the agent panel, pick an agent, and confirm the terminal renders and accepts input. Capture the outcome.

---

## Self-review (author checklist — done)

- **Spec coverage:** backend HTTP+WS proxy with header injection + cookie auth (Task 1) ✓; registered before the static mount, env-driven origin, `websockets` dep (Task 2) ✓; nix dependency + service env (Task 3) ✓; deploy + end-to-end verification (Task 4) ✓; nginx and `desktop/main.js` untouched (no tasks touch them) ✓.
- **Placeholder scan:** none — full code/commands throughout.
- **Type/name consistency:** `register_agent_terminal_proxy(app, auth, origin)`, `TERMINAL_PREFIX`, `AUTH_HEADER`, cookie `COOKIE`, and env var `FOLIO_AGENT_TERMINAL_ORIGIN` are identical across module, app wiring, tests, and nix.
- **Gate:** Task 4 is a user-thrown verification gate (deploy + prove the terminal works); its acceptance criteria are operational (401 vs 404 probe; interactive terminal in the desktop).

## Notes / risks

- `websockets` 15 uses `additional_headers` (verified in nixpkgs). If a future bump reverts to `extra_headers`, update `agent_proxy.connect`.
- The WS unit test does not exercise the `tty` subprotocol (real ttyd requires it; the echo server doesn't). Subprotocol forwarding is implemented and exercised by the real deployment (Task 4, Step 4).
- Deploy (Task 4) requires the user's go-ahead for a NixOS rebuild.
