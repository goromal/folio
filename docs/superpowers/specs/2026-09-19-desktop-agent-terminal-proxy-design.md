# Desktop agent-terminal proxy (fix black terminal in Electron)

Date: 2026-09-19
Repos: `folio` (backend), `anixpkgs` (folio-backend package + nixos module)

## Problem

In the Electron desktop app, picking an agent shows a **black panel**. The web UI works.

### Root cause (confirmed with live probes)

The desktop shell loads the SPA **directly from the backend** — `folio-desktop` is wrapped
with `FOLIO_PORT = service-ports.folio.internal`, so `desktop/main.js` loads
`http://localhost:6868/folio`, **bypassing nginx**. The agent terminal is an
`<iframe src="/folio/agent/terminal/…">` (`AgentPanel.tsx`). That path is wired up **only by
nginx** (`anixpkgs/pkgs/modules/folio/module.nix`, `locations."/folio/agent/terminal/"`),
which proxies to ttyd (`service-ports.folio.agentTerminal`, 6870) **and injects** the
`X-Folio-Agent-Authenticated: yes` header ttyd requires.

Probes against the live host:

| Request | Result |
| --- | --- |
| `localhost:6868/folio/agent/terminal/` (what the desktop iframe hits) | **404** `{"detail":"Not Found"}` |
| ttyd `:6870` terminal, no auth header | **407** (ttyd refuses) |
| ttyd `:6870` terminal **with** `X-Folio-Agent-Authenticated: yes` | **200** |
| `localhost:6868/folio/` (SPA root) | 200 (desktop loads fine) |

So on desktop the terminal path 404s at the backend, which has no route for it (the backend
router is `/agent/*`, no `/terminal`), and even reaching ttyd directly would 407 because only
nginx injects the header.

## Approach (chosen)

**The backend proxies `/folio/agent/terminal/**` to ttyd** (HTTP + WebSocket), injecting the
auth header and enforcing the existing agent session cookie. This closes the architecture gap
("one backend serves everything; desktop == web") for good: the same URL now resolves whether
hit directly (desktop) or via nginx (web).

**Additive, low blast radius:** the nginx location and `desktop/main.js` are **unchanged**.
Web keeps its proven nginx→ttyd path; the new backend proxy is exercised by the desktop (and
by anything else that hits the backend origin directly).

## Components

### `folio_backend/agent_proxy.py` (new)

`register_agent_terminal_proxy(app, auth, origin)` registers two routes on the FastAPI app,
where `origin` is ttyd's base URL (e.g. `http://127.0.0.1:6870`) and `auth` is the existing
`AgentAuth`:

- **WebSocket** `@app.websocket("/folio/agent/terminal/{path:path}")` — authenticates the
  session cookie (`folio_agent_session`, via `auth.is_authenticated`), opens an upstream
  `websockets.connect()` to ttyd with `{X-Folio-Agent-Authenticated: yes}`, negotiates the
  subprotocol, then bridges frames both directions until either side closes. ttyd's terminal
  data channel is `<base>/ws`.
- **HTTP** `@app.api_route("/folio/agent/terminal/{path:path}", methods=["GET","POST"])` —
  authenticates the cookie, forwards to ttyd via `httpx` (already a dep) with the header
  injected, and relays status/body/headers. Serves ttyd's HTML page, `/token`, and assets.

Auth failure → WS `close(1008)` / HTTP `401`, with **no** upstream call.

### `folio_backend/app.py` (modify)

The `/folio` `StaticFiles` mount (line ~250) currently precedes the companion block. Because
Starlette matches routes/mounts in registration order, the terminal proxy **must be registered
before** that mount, or the static mount shadows it. Restructure the env-gated block so that,
when the companion is enabled (`FOLIO_AGENTS` + `FOLIO_AGENT_SECRETS` set), the terminal proxy
is registered **before** `app.mount("/folio", …)`. The ttyd origin comes from a new env var
`FOLIO_AGENT_TERMINAL_ORIGIN`. The `/agent/*` API router is unaffected by ordering (it does not
live under `/folio`).

### `folio_backend/setup.py` (modify)

Add **`websockets`** to `install_requires` (upstream WS client). `httpx` is already present.

### `anixpkgs` (modify)

- `pkgs/python-packages/folio-backend/default.nix` — add `websockets` to the function inputs
  and `propagatedBuildInputs`.
- `pkgs/modules/folio/module.nix` — add
  `FOLIO_AGENT_TERMINAL_ORIGIN=http://127.0.0.1:${toString service-ports.folio.agentTerminal}`
  to the `folio-backend` service `Environment` (in the `companion` block, alongside the other
  `FOLIO_AGENT_*` vars).

## Data flow (desktop, after fix)

```
Electron (localhost:6868/folio)
  iframe GET /folio/agent/terminal/?arg=<session>
    → backend agent_proxy HTTP route (cookie authed) → httpx → ttyd:6870 (+header) → HTML
  ttyd JS opens WS /folio/agent/terminal/ws?arg=<session>
    → backend agent_proxy WS route (cookie authed) → websockets.connect ttyd:6870 (+header)
    → bidirectional byte/text bridge → live terminal
```

Web path is unchanged (browser → nginx → ttyd).

## Security

Same posture as the web. The backend proxy enforces the `folio_agent_session` cookie directly
(the web relies on nginx `auth_request /folio/agent/auth-check`, which validates the same
cookie). The cookie is `Secure`+`SameSite=strict`; it already works over `http://localhost`
on desktop (Chromium treats localhost as a secure context — login/spawn already succeed),
and the WS handshake is same-origin so it carries the cookie. The header is injected only on
the upstream (loopback) hop to ttyd; ttyd remains bound to `127.0.0.1`.

## Testing (`backend/tests/test_agent_proxy.py`)

- **HTTP proxy**: a threaded fake upstream asserts the request arrives with
  `X-Folio-Agent-Authenticated: yes` and the response body/status relay back.
- **HTTP auth gate**: request without a valid cookie → 401 and **no** upstream hit.
- **WebSocket echo**: a threaded upstream `websockets` echo server; through the proxy, a
  message round-trips, and the upstream handshake carried the auth header.
- **WebSocket auth gate**: connect without a valid cookie → closed (1008), no upstream connect.

Tests run in the folio backend nix-shell (unittest); `websockets` must be in the shell.

## Out of scope

- Any change to `desktop/main.js` or the nginx config (both unchanged).
- Unifying the web path to route through the backend (nginx→ttyd stays as-is).
- The other two UX workstreams (editable summaries; Notes page overhaul).

## Deviations / notes

- `websockets.connect` header kwarg differs by version (`additional_headers` in ≥11,
  `extra_headers` earlier). Pin to the nixpkgs `websockets` version and use the matching kwarg;
  confirm during implementation.
- Deploying the fix to the live machine requires an anixpkgs rebuild (see the
  `anixpkgs-deploy` workflow) because the env var and the new dep are provisioned by NixOS.
