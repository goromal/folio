# Folio agent companion, Agent UI scrollback, and NixOS-driven agent lists

Date: 2026-09-16
Repos: `anixpkgs`, `flasks` (agent_ui), `folio`

## Overview

Three related UI changes, unified by a single rule: the set of agent CLIs a
machine offers comes **only** from the `machines.features.agents.frameworks`
NixOS option. Nothing downstream hardcodes `claude`/`codex`.

1. **R1 — Agent UI scrollback.** Scroll into tmux history with the mouse /
   touch, without pressing `Ctrl-b [`.
2. **R2 — Folio agent companion.** A menu button in Folio spawns an agent
   session in an ephemeral temp directory, shown side-by-side with the reader
   when the window is wide enough and toggled with it when it is not. The agent
   is chosen from the machine's configured frameworks.
3. **R3 — De-hardcode Agent UI agents.** Remove the remaining
   `claude|codex|shell` literals from Agent UI so the framework list flows
   entirely from NixOS.

R3 is implemented first because R2 reuses the same "agents come from NixOS"
mechanism.

## Single source of truth

`config.machines.features.agents.frameworks` (enum `["claude" "codex"]`, set per
profile in `pkgs/nixos/profiles/*.nix`) is the only place agents are named.
Adding a framework is a one-line enum + profile edit that propagates to Agent UI
and the Folio companion. NixOS remains the trust root / whitelist; downstream
code validates but does not re-enumerate.

---

## R3 — De-hardcode Agent UI agents

Today `pkgs/python-packages/flasks/agent_ui/module.nix` already derives the
`--agent` flags from the option, but three layers still pin the literal set:

- **`module.nix`**
  - Drop the redundant `lib.filter (... ["claude" "codex"])` — the enum already
    constrains the values.
  - Interpolate the configured agent list (plus the `shell` pseudo-agent) into
    the `case` guard of `agent-ui-enter` and the session-name regex of
    `agent-ui-attach`, instead of the hardcoded `claude|codex|shell`.
- **`agent_ui/agent_ui.py`**
  - `create_app` stops filtering `agents` against `{"claude","codex"}`; it trusts
    the passed list, validating each value with `SAFE_NAME`.
  - Build `SESSION_NAME` dynamically from `session_types` (the allowed agents +
    `shell`) rather than the hardcoded alternation.
- **Tests** (`tests/test_agent_ui.py`): add cases driven by a non-default agent
  list (e.g. `["codex"]` only, and a hypothetical third framework) proving no
  behavior is pinned to claude/codex.

Security is unchanged: values still originate from the NixOS enum via `--agent`.

---

## R1 — Agent UI scrollback via tmux mouse mode

- Run Agent UI's tmux on a **dedicated socket** (`tmux -L agent-ui`) with a small
  config file: `set -g mouse on` and a generous `history-limit`. The dedicated
  socket keeps mouse mode isolated from the user's interactive tmux server.
- Thread `--tmux-socket` / `--tmux-config` through `agent_ui.py`'s tmux calls
  (`list`, `start`, `interrupt`, `terminate`) and the `agent-ui-attach` script
  (both supplied by Nix, with sensible defaults).
- Effect: mouse wheel (desktop) and touch-drag (mobile) enter copy-mode and
  scroll scrollback — no `Ctrl-b [`.
- Reconcile with `templates/terminal.html`: its custom touch-selection only
  intercepts touches while the "Select" button is toggled on, so passthrough
  scroll should coexist. Verify wheel + touch scroll during implementation and
  adjust the key bar only if a conflict appears.

---

## R2 — Folio agent companion

### Control plane — `folio-backend` (FastAPI), same origin

Chosen over a standalone Flask service because the SPA needs JSON and a
React-native responsive layout. New, contained modules, both **gated by env**
(present only when `FOLIO_AGENTS` is non-empty *and* a secrets file is set — plain
Folio deployments are unchanged):

- `folio_backend/agent.py` — ephemeral session manager with `spawn`, `list`,
  `kill`, `config`:
  - Sessions run on a dedicated `tmux -L folio-agent` socket sharing R1's
    mouse-mode config. Names: `folio-agent--<agent>--<id>` (id = `token_hex(4)`),
    regex-validated.
  - `spawn(agent)` creates a temp dir keyed by the session id
    (`<spool>/folio-agent-<id>`) so `kill` can `rm -rf` it deterministically;
    the session command `cd`s there and `exec`s the chosen agent.
  - The temp dir persists until the session is explicitly closed — it survives
    panel toggles and Folio reloads (tmux reattach). `kill` removes both the
    tmux session and the temp dir.
  - Agent validation uses the `FOLIO_AGENTS` list; no hardcoded set.
- `folio_backend/agent_auth.py` — compact password auth mirroring Agent UI:
  loads an agent-ui-style secrets file (`secret_key` + `password_hash`); issues a
  signed, HttpOnly, Secure, SameSite=Strict cookie; a CSRF token for POSTs; and a
  `/agent/auth-check` endpoint for nginx `auth_request`.
- Router endpoints (registered only when gated on):
  - `POST /agent/login` — password → cookie.
  - `GET  /agent/auth-check` — 204 / 401 for nginx.
  - `GET  /agent/config` — `{ "agents": [...] }` from `FOLIO_AGENTS`.
  - `GET  /agent/sessions` — list running `folio-agent-*` sessions.
  - `POST /agent/sessions` — spawn (CSRF-guarded) → `{ "name": ... }`.
  - `DELETE /agent/sessions/{name}` — kill + temp-dir cleanup (CSRF-guarded).

### Terminal service

New `folio-agent-terminal` systemd unit runs `ttyd` (base-path
`/folio/agent/terminal`, `--auth-header X-Folio-Agent-Authenticated`,
`--check-origin`, `--url-arg`) attaching the `folio-agent` socket through a
restricted `folio-agent-attach` script — the Agent UI pattern.

### nginx (Folio's `:6869` vhost)

- `= /folio/agent/auth-check` → internal, proxied to folio-backend.
- `/folio/agent/terminal/` → ttyd, `proxyWebsockets`, `auth_request` against
  auth-check, sets `X-Folio-Agent-Authenticated`.
- Control JSON at `/agent/*` already reaches folio-backend via the existing
  `location /`. The password gate covers both control and terminal, so the
  companion is available anywhere Folio is reachable.

### Frontend (React SPA)

- A menu button in the `App.tsx` header opens the companion (app-level chrome so
  it persists across reader routes).
- Auth: if `GET /agent/auth-check` is 401, show an inline password prompt →
  `POST /agent/login`.
- Picker: agents from `GET /agent/config` (NixOS-derived — no hardcoding here
  either). Reattach an existing session from `GET /agent/sessions`; the active
  session name is persisted in `localStorage`.
- Terminal: an iframe to `/folio/agent/terminal/?arg=<name>`, kept mounted
  (hidden, not unmounted) so toggling never drops the ttyd websocket.
- Layout: at width ≳1000px, reader and agent render side-by-side (flex row,
  reader stays live); below that the same menu button toggles between
  reader-only and agent-only.
- A "Close session" control kills the session + removes its temp dir.
- Synergy: the folio MCP server is machine-wide, so a Claude/Codex session in
  the companion already has the folio annotation tools and can highlight/note the
  book currently being read.

### NixOS wiring — `modules/folio/module.nix`, `service-ports.nix`

- Derive agents from `machines.features.agents.frameworks`; pass as
  `FOLIO_AGENTS` to folio-backend and into the session/attach scripts.
- `FOLIO_AGENT_SECRETS` env → secrets file, default
  `${homeDir}/secrets/flask/folio_agent.json`.
- Add the ttyd port (`service-ports.folio.agentTerminal`), the
  `folio-agent-terminal` service, and the nginx locations.
- New `services.folio-backend.agentCompanion` enable option, defaulting from the
  same feature flag that already governs Folio.

### Secrets provisioning

The Folio companion uses its **own** file (`folio_agent.json`) whose contents are
a **copy** of Agent UI's `agent_ui.json` (`secret_key` + `password_hash`), so the
companion password matches Agent UI's. The copy is provisioned as part of
deployment (documented in the module; separate file, identical contents).

---

## Testing

- **folio-backend:** unit tests for the session manager (injected fake tmux
  runner, mirroring Agent UI's `test_agent_ui.py` DI approach), auth
  (login / auth-check / CSRF), and `/agent/config`.
- **agent_ui:** tests proving agents aren't pinned to claude/codex, plus the
  socket/config threading.
- **frontend:** companion tests (picker, layout toggle at wide/narrow widths,
  reattach) with mocked fetch, alongside the existing `App.test.tsx`.
- **Nix:** eval + build + deploy via the anixpkgs workflow.

## Rollout

Cross-repo change (`anixpkgs`, `flasks`, `folio`); coordinate branches and
commits per the workspace-development flow. Suggested sequence:

1. R3 (flasks + anixpkgs) — de-hardcode, land first.
2. R1 (flasks + anixpkgs) — scrollback.
3. R2 (folio + anixpkgs) — companion, building on the R3 pattern.

## Out of scope

- A `shell` pseudo-agent in the Folio companion (agents only, per request).
- A mobile on-screen key bar in the Folio terminal (can be added later; Agent
  UI's `terminal.html` remains the reference).
- Multiple concurrent Folio companion sessions in the UI at once (one active
  panel; multiple may exist server-side and be listed).
