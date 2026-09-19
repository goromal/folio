# Folio Agent Companion + Agent UI Scrollback + NixOS-Driven Agents — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a password-gated agent companion to Folio (temp-dir sessions, side-by-side/toggle with the reader), give Agent UI mouse-wheel scrollback, and remove the last hardcoded `claude|codex` literals so agents flow entirely from the `machines.features.agents.frameworks` NixOS option.

**Architecture:** Three repos. `flasks/agent_ui` (Python/Flask) and `folio/backend` (FastAPI) gain the runtime behavior; `folio/frontend` (React/Vite) gets the companion UI; `anixpkgs` wires services, ports, nginx, tmux config, and agent lists. The Folio companion mirrors Agent UI's proven ttyd+tmux+auth pattern but serves ephemeral `mktemp`-style sessions same-origin under Folio's nginx vhost.

**Tech Stack:** Python (Flask, werkzeug), FastAPI (Starlette), React 18 + React Router + Vitest, Nix (NixOS modules, `writeShellApplication`, ttyd, tmux).

**Build sequence:** Phase A (R3 de-hardcode) → Phase B (R1 scrollback) → Phase C/D (R2 backend + frontend) → Phase E (R2 Nix wiring) → Phase F (integration/deploy). Each phase's flasks/folio code lands before its anixpkgs consumer.

**Repo roots** (absolute):
- `flasks` = `/data/andrew/dev/ui/sources/flasks`
- `folio` = `/data/andrew/dev/ui/sources/folio`
- `anixpkgs` = `/data/andrew/dev/ui/sources/anixpkgs`

**Cross-repo note:** This spans three git repos, all currently on their default branch. Use the `workspace-development` skill to create matching feature branches and coordinate commits/pushes. Do not push or open PRs unless the user asks. When a task's `git commit` step runs, commit in that task's repo.

**Running tests locally (fast loop):** ambient Python lacks these deps, so run Python tests inside an ad-hoc nix shell:
- agent_ui: `nix-shell -p 'python3.withPackages(ps: with ps; [flask flask-login werkzeug pytest])' --run 'cd /data/andrew/dev/ui/sources/flasks/agent_ui && python -m pytest tests -v'`
- folio-backend: `nix-shell -p 'python3.withPackages(ps: with ps; [fastapi uvicorn pydantic ebooklib beautifulsoup4 python-multipart httpx werkzeug])' --run 'cd /data/andrew/dev/ui/sources/folio/backend && python -m unittest discover -s tests -v'`
- frontend: `cd /data/andrew/dev/ui/sources/folio/frontend && npm test -- --run`

The authoritative check is the Nix build (`nix build`) in Phase F, which runs `pytestCheckHook` / `unittest` inside the derivation.

---

## Phase A — R3: De-hardcode Agent UI agents

### Task 1: Agent UI Python trusts the configured agent list

**Goal:** Remove the `{"claude","codex"}` filter and the hardcoded agent alternation in `SESSION_NAME` so any shape-valid agent passed via `--agent` works.

**Files:**
- Modify: `/data/andrew/dev/ui/sources/flasks/agent_ui/agent_ui.py:26-29` (SESSION_NAME) and `:226` (allowed_agents filter)
- Test: `/data/andrew/dev/ui/sources/flasks/agent_ui/tests/test_agent_ui.py`

**Acceptance Criteria:**
- [ ] `SESSION_NAME` matches any agent of shape `[A-Za-z0-9_][A-Za-z0-9_-]*` (not just `claude|codex|shell`).
- [ ] `create_app(agents=("gemini",))` accepts starting agent `gemini` and rejects `codex` (not configured).
- [ ] All existing tests still pass.

**Verify:** `python -m pytest tests -v` (in the agent_ui nix shell above) → all pass, including two new tests.

**Steps:**

- [ ] **Step 1: Write failing tests.** Append to `tests/test_agent_ui.py`:

```python
def test_session_name_accepts_any_configured_agent_shape():
    # The regex must not pin the agent to claude|codex|shell.
    from agent_ui import SESSION_NAME
    assert SESSION_NAME.fullmatch("agent-ui-ui--gemini--0123abcd")
    assert SESSION_NAME.fullmatch("agent-ui-ui--claude--0123abcd")
    # Shape guards still hold: no spaces, no slashes.
    assert not SESSION_NAME.fullmatch("agent-ui-ui--bad agent--0123abcd")
    assert not SESSION_NAME.fullmatch("agent-ui-ui--codex--nothex01")


def test_agents_are_not_hardcoded_to_claude_codex(tmp_path):
    devrc = tmp_path / "devrc"
    devrc.write_text("dev_dir = ~/dev\nui = anixpkgs\n", encoding="utf-8")
    secrets_file = tmp_path / "secrets.json"
    secrets_file.write_text(
        json.dumps({
            "secret_key": "k",
            "password_hash": generate_password_hash(TEST_PASSWORD),
        }),
        encoding="utf-8",
    )
    manager = FakeSessions()
    app = create_app(
        subdomain="/agents", devrc=str(devrc), agents=("gemini",),
        secrets_file=str(secrets_file), secure_cookie=False,
        session_manager=manager, workspace_manager=FakeWorkspaces(),
    )
    app.config.update(TESTING=True)
    client = app.test_client()
    login(client)
    ok = client.post("/agents/sessions",
                     data={"_csrf": csrf(client), "workspace": "ui", "agent": "gemini"})
    assert ok.status_code == 302
    assert manager.started == [("ui", "gemini")]
    # An agent NOT in the configured list is rejected.
    bad = client.post("/agents/sessions",
                      data={"_csrf": csrf(client), "workspace": "ui", "agent": "codex"})
    assert bad.status_code == 400
```

- [ ] **Step 2: Run to confirm failure.** `python -m pytest tests/test_agent_ui.py -k "configured_agent_shape or not_hardcoded" -v` → FAIL (SESSION_NAME rejects `gemini`; `gemini` filtered out of allowed_agents).

- [ ] **Step 3: Broaden the regex.** Replace `agent_ui.py:26-29`:

```python
SESSION_NAME = re.compile(
    r"^agent-ui-(?P<workspace>[A-Za-z0-9_][A-Za-z0-9_-]*)"
    r"--(?P<agent>[A-Za-z0-9_][A-Za-z0-9_-]*)--(?P<id>[0-9a-f]{8})$"
)
```

- [ ] **Step 4: Trust the passed list.** Replace `agent_ui.py:226`:

```python
    allowed_agents = tuple(
        dict.fromkeys(agent for agent in agents if SAFE_NAME.fullmatch(agent))
    )
```

(Whitelisting is still enforced downstream: `/sessions` checks `agent in allowed_agents`, and `sessions.list(...)` filters names whose agent is not in `session_types`. NixOS remains the trust root via `--agent`.)

- [ ] **Step 5: Run full suite.** `python -m pytest tests -v` → all pass.

- [ ] **Step 6: Commit** (in the `flasks` repo):

```bash
cd /data/andrew/dev/ui/sources/flasks
git add agent_ui/agent_ui.py agent_ui/tests/test_agent_ui.py
git commit -m "agent_ui: derive agents from configured list, not hardcoded claude/codex"
```

---

### Task 2: Agent UI Nix module stops hardcoding agents in shell guards

**Goal:** Remove the redundant `["claude" "codex"]` filter and interpolate the configured agent list into the `agent-ui-enter` case guard and the `agent-ui-attach` regex.

**Files:**
- Modify: `/data/andrew/dev/ui/sources/anixpkgs/pkgs/python-packages/flasks/agent_ui/module.nix:11-18` (agents/filter), `:20-34` (agentEnter), `:61-71` (agentAttach)

**Acceptance Criteria:**
- [ ] `agents` is `config.machines.features.agents.frameworks` directly (no re-filter).
- [ ] `agent-ui-enter`'s `case` and `agent-ui-attach`'s regex accept exactly the configured agents plus `shell`, generated from the list.
- [ ] `nix-instantiate --eval` of the module attrs succeeds (checked via a full eval in Phase F).

**Verify:** `cd /data/andrew/dev/ui/sources/anixpkgs && nix-instantiate --parse pkgs/python-packages/flasks/agent_ui/module.nix >/dev/null` → no parse error. (Full build in Phase F.)

**Steps:**

- [ ] **Step 1: Replace the agents binding** at `module.nix:11-18`:

```nix
  agents = config.machines.features.agents.frameworks;
  agentAlternation = lib.concatStringsSep "|" (agents ++ [ "shell" ]);
  agentArgs = lib.concatMapStringsSep " " (agent: "--agent ${lib.escapeShellArg agent}") agents;
```

- [ ] **Step 2: Generate the enter guard** — replace the `case` block in `agentEnter` (`module.nix:22-33`):

```nix
    text = ''
      case "''${AGENT_UI_AGENT:-}" in
        ${agentAlternation}) ;;
        *) echo "agent-ui-enter: unsupported agent" >&2; exit 2 ;;
      esac

      cd "$DEVSHELL_ROOT/sources"
      if [ "$AGENT_UI_AGENT" = shell ]; then
        exec ${pkgs.bashInteractive}/bin/bash -i
      fi
      exec "$AGENT_UI_AGENT"
    '';
```

- [ ] **Step 3: Generate the attach regex** — replace the guard in `agentAttach` (`module.nix:65`):

```nix
      if [ "$#" -ne 1 ] || [[ ! "$1" =~ ^agent-ui-[A-Za-z0-9_-]+--(${agentAlternation})--[0-9a-f]{8}$ ]]; then
```

- [ ] **Step 4: Also fix the session guard** in `agentSession` (`module.nix:50-53`) the same way:

```nix
      case "$2" in
        ${agentAlternation}) ;;
        *) echo "agent-ui-session: unsupported agent" >&2; exit 2 ;;
      esac
```

- [ ] **Step 5: Parse-check and commit** (in the `anixpkgs` repo):

```bash
cd /data/andrew/dev/ui/sources/anixpkgs
nix-instantiate --parse pkgs/python-packages/flasks/agent_ui/module.nix >/dev/null
git add pkgs/python-packages/flasks/agent_ui/module.nix
git commit -m "agent_ui module: generate agent guards from features.agents.frameworks"
```

---

## Phase B — R1: Agent UI tmux scrollback via mouse mode

### Task 3: Thread a dedicated tmux socket + config through agent_ui.py

**Goal:** Let Agent UI run tmux on an isolated socket with a config file, so mouse mode can be enabled without touching the user's interactive tmux server.

**Files:**
- Modify: `/data/andrew/dev/ui/sources/flasks/agent_ui/agent_ui.py:77-137` (TmuxSessions), `:213-234` (create_app signature/wiring), `:470-499` (main/args)
- Test: `/data/andrew/dev/ui/sources/flasks/agent_ui/tests/test_agent_ui.py`

**Acceptance Criteria:**
- [ ] `TmuxSessions(socket="agent-ui")` prefixes every tmux invocation with `-L agent-ui`.
- [ ] `start()` additionally passes `-f <config>` (server-start config) when a config path is set; `list/interrupt/terminate` do not.
- [ ] `--tmux-socket` and `--tmux-config` CLI args exist and reach TmuxSessions.

**Verify:** `python -m pytest tests -v` → all pass, including the new socket tests.

**Steps:**

- [ ] **Step 1: Write failing tests.** Append to `tests/test_agent_ui.py`:

```python
def test_tmux_socket_and_config_prefix_commands(monkeypatch):
    import subprocess as sp
    from agent_ui import TmuxSessions

    calls = []

    class Result:
        returncode = 0
        stdout = ""

    def fake_run(cmd, **kwargs):
        calls.append(list(cmd))
        return Result()

    monkeypatch.setattr(sp, "run", fake_run)
    sessions = TmuxSessions(
        tmux_bin="tmux", socket="agent-ui", config="/nix/store/x-tmux.conf"
    )
    sessions.list([], ("claude",))
    assert calls[-1][:3] == ["tmux", "-L", "agent-ui"]
    assert "-f" not in calls[-1]

    sessions.start("ui", "claude")
    start_cmd = calls[-1]
    assert start_cmd[:3] == ["tmux", "-L", "agent-ui"]
    assert start_cmd[3:5] == ["-f", "/nix/store/x-tmux.conf"]
    assert "new-session" in start_cmd
```

- [ ] **Step 2: Run to confirm failure.** `python -m pytest tests/test_agent_ui.py -k tmux_socket -v` → FAIL (TmuxSessions has no `socket`/`config`).

- [ ] **Step 3: Rewrite TmuxSessions** (`agent_ui.py:77-137`) to build a base command and honor socket/config:

```python
class TmuxSessions:
    def __init__(
        self, tmux_bin="tmux", session_command="agent-ui-session",
        socket=None, config=None,
    ):
        self.tmux_bin = tmux_bin
        self.session_command = session_command
        self.socket = socket
        self.config = config

    def _base(self):
        base = [self.tmux_bin]
        if self.socket:
            base += ["-L", self.socket]
        return base

    def list(self, configured_workspaces, allowed_agents):
        result = subprocess.run(
            self._base() + [
                "list-sessions", "-F",
                "#{session_name}\t#{session_created}\t#{session_attached}",
            ],
            check=False, capture_output=True, text=True,
        )
        if result.returncode != 0:
            return []
        workspaces = {workspace["name"] for workspace in configured_workspaces}
        sessions = []
        for line in result.stdout.splitlines():
            try:
                name, created, attached = line.split("\t")
            except ValueError:
                continue
            match = SESSION_NAME.fullmatch(name)
            if not match:
                continue
            workspace = match.group("workspace")
            agent = match.group("agent")
            if workspace not in workspaces or agent not in allowed_agents:
                continue
            sessions.append({
                "name": name, "workspace": workspace, "agent": agent,
                "created": int(created), "attached": int(attached),
            })
        return sorted(sessions, key=lambda s: s["created"], reverse=True)

    def start(self, workspace, agent):
        name = f"agent-ui-{workspace}--{agent}--{secrets.token_hex(4)}"
        command = self._base()
        if self.config:
            command += ["-f", self.config]
        command += [
            "new-session", "-d", "-s", name,
            self.session_command, workspace, agent,
        ]
        subprocess.run(command, check=True)
        return name

    def interrupt(self, name):
        self._require_session_name(name)
        subprocess.run(self._base() + ["send-keys", "-t", name, "C-c"], check=True)

    def terminate(self, name):
        self._require_session_name(name)
        subprocess.run(self._base() + ["kill-session", "-t", name], check=True)

    @staticmethod
    def _require_session_name(name):
        if not SESSION_NAME.fullmatch(name):
            raise ValueError("invalid session name")
```

- [ ] **Step 4: Pass through create_app.** In `create_app` add params `tmux_socket=None, tmux_config=None` (in the signature after `tmux_bin="tmux"`) and update the TmuxSessions construction (`agent_ui.py:232`):

```python
    sessions = session_manager or TmuxSessions(
        tmux_bin, session_command, socket=tmux_socket, config=tmux_config
    )
```

- [ ] **Step 5: Add CLI args.** In `main()` after the `--tmux-bin` arg add:

```python
    parser.add_argument("--tmux-socket", default=None)
    parser.add_argument("--tmux-config", default=None)
```

and pass them into `create_app(...)`:

```python
        tmux_bin=args.tmux_bin,
        tmux_socket=args.tmux_socket,
        tmux_config=args.tmux_config,
        session_command=args.session_command,
```

- [ ] **Step 6: Run full suite.** `python -m pytest tests -v` → all pass.

- [ ] **Step 7: Commit** (in `flasks`):

```bash
cd /data/andrew/dev/ui/sources/flasks
git add agent_ui/agent_ui.py agent_ui/tests/test_agent_ui.py
git commit -m "agent_ui: support dedicated tmux socket + config for isolated sessions"
```

---

### Task 4: Enable tmux mouse mode in the Agent UI Nix module

**Goal:** Give Agent UI a dedicated tmux socket (`agent-ui`) and a config file with `set -g mouse on`, wired through both `agent-ui` and `agent-ui-attach`.

**Files:**
- Modify: `/data/andrew/dev/ui/sources/anixpkgs/pkgs/python-packages/flasks/agent_ui/module.nix` (add tmux config, socket flags on attach, pass `--tmux-socket`/`--tmux-config`)

**Acceptance Criteria:**
- [ ] A tmux config file with `set -g mouse on` and a large `history-limit` is built in the module.
- [ ] The `agent-ui` service ExecStart passes `--tmux-socket agent-ui --tmux-config <conf>`.
- [ ] `agent-ui-attach` attaches on `-L agent-ui`.

**Verify:** parse-check + Phase F full rebuild. Manual smoke in Phase F: mouse-wheel scrolls scrollback in a session.

**Steps:**

- [ ] **Step 1: Define the tmux config** in the `let` block of `module.nix` (after `agentArgs`):

```nix
  agentTmuxConf = pkgs.writeText "agent-ui-tmux.conf" ''
    set -g mouse on
    set -g history-limit 50000
  '';
```

- [ ] **Step 2: Pin the socket on attach** — in `agentAttach.text`, change the exec line to:

```nix
      exec tmux -L agent-ui attach-session -t "$1"
```

- [ ] **Step 3: Pass socket + config to the service** — in `systemd.services.agent-ui.serviceConfig.ExecStart` (`module.nix:135`), insert `--tmux-socket agent-ui --tmux-config ${agentTmuxConf}` before `${agentArgs}`:

```nix
        ExecStart = "${cfg.package}/bin/agent-ui --port ${toString cfg.port} --subdomain ${cfg.subdomain} --devrc ${cfg.devrc} --history ${globalCfg.homeDir}/.devhist --secrets-file ${cfg.secretsFile} --tmux-bin ${pkgs.tmux}/bin/tmux --tmux-socket agent-ui --tmux-config ${agentTmuxConf} --session-command ${agentSession}/bin/agent-ui-session --workspace-command ${anixpkgs.devshell}/bin/devshellctl ${agentArgs}";
```

- [ ] **Step 4: Parse-check and commit** (in `anixpkgs`):

```bash
cd /data/andrew/dev/ui/sources/anixpkgs
nix-instantiate --parse pkgs/python-packages/flasks/agent_ui/module.nix >/dev/null
git add pkgs/python-packages/flasks/agent_ui/module.nix
git commit -m "agent_ui module: dedicated tmux socket with mouse mode for scrollback"
```

---

## Phase C — R2: Folio companion backend (FastAPI)

### Task 5: Companion auth module (password → cookie, CSRF, auth-check)

**Goal:** A small auth helper mirroring Agent UI: load an agent-ui-style secrets file, verify the password, mint a signed cookie value and a CSRF token.

**Files:**
- Create: `/data/andrew/dev/ui/sources/folio/backend/folio_backend/agent_auth.py`
- Create: `/data/andrew/dev/ui/sources/folio/backend/tests/test_agent_auth.py`
- Modify: `/data/andrew/dev/ui/sources/folio/backend/setup.py` (add `werkzeug` dep)

**Acceptance Criteria:**
- [ ] `load_secrets` returns `(secret_key: bytes, password_hash: str)` and raises on missing keys.
- [ ] `AgentAuth.check_password` validates against a werkzeug hash; wrong/empty password fails.
- [ ] `is_authenticated` accepts the minted cookie value and rejects others (constant-time).

**Verify:** `python -m unittest tests.test_agent_auth -v` (folio-backend nix shell) → OK.

**Steps:**

- [ ] **Step 1: Write failing test** `tests/test_agent_auth.py`:

```python
import json
import tempfile
import unittest

from werkzeug.security import generate_password_hash

from folio_backend.agent_auth import AgentAuth, load_secrets


def _secrets_file(password="pw"):
    tmp = tempfile.NamedTemporaryFile(suffix=".json", mode="w", delete=False)
    json.dump({"secret_key": "k", "password_hash": generate_password_hash(password)}, tmp)
    tmp.close()
    return tmp.name


class AgentAuthTest(unittest.TestCase):
    def test_load_and_password(self):
        key, pwhash = load_secrets(_secrets_file("hunter2"))
        auth = AgentAuth(key, pwhash)
        self.assertTrue(auth.check_password("hunter2"))
        self.assertFalse(auth.check_password("wrong"))
        self.assertFalse(auth.check_password(""))

    def test_cookie_roundtrip(self):
        key, pwhash = load_secrets(_secrets_file())
        auth = AgentAuth(key, pwhash)
        self.assertTrue(auth.is_authenticated(auth.cookie_value))
        self.assertFalse(auth.is_authenticated("nope"))
        self.assertFalse(auth.is_authenticated(""))

    def test_missing_keys_raise(self):
        tmp = tempfile.NamedTemporaryFile(suffix=".json", mode="w", delete=False)
        json.dump({"secret_key": "k"}, tmp)
        tmp.close()
        with self.assertRaises(ValueError):
            load_secrets(tmp.name)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run to confirm failure.** `python -m unittest tests.test_agent_auth -v` → ImportError (module missing).

- [ ] **Step 3: Implement** `folio_backend/agent_auth.py`:

```python
"""Password auth for the Folio agent companion.

Mirrors agent_ui: a single shared password (werkzeug hash) plus an HMAC-derived
cookie/CSRF token from the same secret_key. The secrets file is provisioned as a
copy of agent_ui's, so the companion password matches Agent UI's.
"""
import hashlib
import hmac
import json
import os

from werkzeug.security import check_password_hash


def load_secrets(path):
    with open(os.path.expanduser(path), encoding="utf-8") as handle:
        data = json.load(handle)
    if not data.get("secret_key") or not data.get("password_hash"):
        raise ValueError(f"agent secrets file {path} missing secret_key/password_hash")
    return data["secret_key"].encode(), data["password_hash"]


class AgentAuth:
    def __init__(self, secret_key, password_hash):
        self.password_hash = password_hash
        self.csrf_token = hmac.new(secret_key, b"csrf", hashlib.sha256).hexdigest()
        self.cookie_value = hmac.new(
            secret_key, b"authenticated", hashlib.sha256
        ).hexdigest()

    def check_password(self, password):
        return bool(password) and check_password_hash(self.password_hash, password)

    def is_authenticated(self, cookie):
        return bool(cookie) and hmac.compare_digest(cookie, self.cookie_value)
```

- [ ] **Step 4: Add the dep.** In `setup.py`, add `"werkzeug"` to `install_requires`:

```python
    install_requires=[
        "fastapi", "uvicorn", "pydantic",
        "ebooklib", "beautifulsoup4", "python-multipart", "httpx", "werkzeug",
    ],
```

- [ ] **Step 5: Run test.** `python -m unittest tests.test_agent_auth -v` → OK.

- [ ] **Step 6: Commit** (in `folio`):

```bash
cd /data/andrew/dev/ui/sources/folio
git add backend/folio_backend/agent_auth.py backend/tests/test_agent_auth.py backend/setup.py
git commit -m "folio-backend: agent companion auth (password + cookie + csrf)"
```

---

### Task 6: Ephemeral temp-dir session manager

**Goal:** `AgentSessions` spawns/lists/kills `folio-agent--<agent>--<id>` tmux sessions on a dedicated socket, each in a temp dir keyed by the session id so kill can clean it up.

**Files:**
- Create: `/data/andrew/dev/ui/sources/folio/backend/folio_backend/agent.py`
- Create: `/data/andrew/dev/ui/sources/folio/backend/tests/test_agent_sessions.py`

**Acceptance Criteria:**
- [ ] `spawn(agent)` rejects agents not in the configured list, creates `<spool>/folio-agent-<id>`, and issues `tmux -L <socket> [-f conf] new-session -d -s <name> <session_command> <workdir> <agent>`.
- [ ] `list()` parses `list-sessions` output and returns only well-formed `folio-agent--*` sessions whose agent is configured.
- [ ] `kill(name)` validates the name, kills the session, and removes the matching temp dir (and never a path outside the spool).

**Verify:** `python -m unittest tests.test_agent_sessions -v` → OK.

**Steps:**

- [ ] **Step 1: Write failing test** `tests/test_agent_sessions.py`:

```python
import os
import subprocess
import tempfile
import unittest

from folio_backend import agent as agent_mod
from folio_backend.agent import AgentSessions, SESSION_RE


class _Result:
    def __init__(self, stdout="", returncode=0):
        self.stdout = stdout
        self.returncode = returncode


class AgentSessionsTest(unittest.TestCase):
    def setUp(self):
        self.spool = tempfile.mkdtemp()
        self.calls = []
        self._orig = subprocess.run

    def tearDown(self):
        subprocess.run = self._orig

    def _fake_run(self, result=None):
        def run(cmd, **kwargs):
            self.calls.append(list(cmd))
            return result or _Result()
        return run

    def _mgr(self):
        return AgentSessions(
            agents=("claude", "codex"), spool_dir=self.spool,
            tmux_bin="tmux", socket="folio-agent",
            config="/nix/store/x.conf", session_command="folio-agent-session",
        )

    def test_spawn_creates_dir_and_new_session(self):
        subprocess.run = self._fake_run()
        mgr = self._mgr()
        name = mgr.spawn("claude")
        self.assertTrue(SESSION_RE.fullmatch(name))
        sid = SESSION_RE.fullmatch(name).group("id")
        self.assertTrue(os.path.isdir(os.path.join(self.spool, f"folio-agent-{sid}")))
        cmd = self.calls[-1]
        self.assertEqual(cmd[:3], ["tmux", "-L", "folio-agent"])
        self.assertEqual(cmd[3:5], ["-f", "/nix/store/x.conf"])
        self.assertIn("new-session", cmd)
        self.assertEqual(cmd[-2:], [os.path.join(self.spool, f"folio-agent-{sid}"), "claude"])

    def test_spawn_rejects_unconfigured_agent(self):
        subprocess.run = self._fake_run()
        with self.assertRaises(ValueError):
            self._mgr().spawn("gemini")

    def test_list_filters_and_parses(self):
        out = (
            "folio-agent--claude--0123abcd\t111\t1\n"
            "folio-agent--gemini--0123abcd\t222\t0\n"   # not configured -> dropped
            "some-other-session\t333\t0\n"               # not ours -> dropped
        )
        subprocess.run = self._fake_run(_Result(stdout=out))
        rows = self._mgr().list()
        self.assertEqual([r["name"] for r in rows], ["folio-agent--claude--0123abcd"])
        self.assertEqual(rows[0]["agent"], "claude")

    def test_kill_removes_only_matching_dir(self):
        subprocess.run = self._fake_run()
        mgr = self._mgr()
        name = mgr.spawn("codex")
        sid = SESSION_RE.fullmatch(name).group("id")
        workdir = os.path.join(self.spool, f"folio-agent-{sid}")
        self.assertTrue(os.path.isdir(workdir))
        mgr.kill(name)
        self.assertFalse(os.path.exists(workdir))
        self.assertIn(["tmux", "-L", "folio-agent", "kill-session", "-t", name],
                      self.calls)

    def test_kill_rejects_bad_name(self):
        subprocess.run = self._fake_run()
        with self.assertRaises(ValueError):
            self._mgr().kill("../../etc/passwd")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run to confirm failure.** `python -m unittest tests.test_agent_sessions -v` → ImportError.

- [ ] **Step 3: Implement** `folio_backend/agent.py`:

```python
"""Ephemeral temp-dir agent sessions for the Folio companion.

Each session is a tmux session on a dedicated socket, running the chosen agent
CLI in a throwaway directory keyed by the session id. Mirrors agent_ui's tmux
management but with no devshell/workspace binding.
"""
import os
import re
import secrets
import shutil
import subprocess

SAFE_AGENT = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_-]*$")
SESSION_RE = re.compile(
    r"^folio-agent--(?P<agent>[A-Za-z0-9_][A-Za-z0-9_-]*)--(?P<id>[0-9a-f]{8})$"
)


class AgentSessions:
    def __init__(
        self, agents, spool_dir, tmux_bin="tmux", socket="folio-agent",
        config=None, session_command="folio-agent-session",
    ):
        self.agents = tuple(a for a in agents if SAFE_AGENT.fullmatch(a))
        self.spool_dir = os.path.abspath(spool_dir)
        self.tmux_bin = tmux_bin
        self.socket = socket
        self.config = config
        self.session_command = session_command

    def _base(self):
        return [self.tmux_bin, "-L", self.socket]

    def _workdir(self, session_id):
        return os.path.join(self.spool_dir, f"folio-agent-{session_id}")

    def list(self):
        result = subprocess.run(
            self._base() + [
                "list-sessions", "-F",
                "#{session_name}\t#{session_created}\t#{session_attached}",
            ],
            check=False, capture_output=True, text=True,
        )
        if result.returncode != 0:
            return []
        rows = []
        for line in result.stdout.splitlines():
            try:
                name, created, attached = line.split("\t")
            except ValueError:
                continue
            match = SESSION_RE.fullmatch(name)
            if not match or match.group("agent") not in self.agents:
                continue
            rows.append({
                "name": name, "agent": match.group("agent"),
                "created": int(created), "attached": int(attached),
            })
        return sorted(rows, key=lambda r: r["created"], reverse=True)

    def spawn(self, agent):
        if agent not in self.agents:
            raise ValueError("unconfigured agent")
        session_id = secrets.token_hex(4)
        name = f"folio-agent--{agent}--{session_id}"
        workdir = self._workdir(session_id)
        os.makedirs(workdir, mode=0o700, exist_ok=True)
        command = self._base()
        if self.config:
            command += ["-f", self.config]
        command += [
            "new-session", "-d", "-s", name,
            self.session_command, workdir, agent,
        ]
        subprocess.run(command, check=True)
        return name

    def kill(self, name):
        match = SESSION_RE.fullmatch(name)
        if not match:
            raise ValueError("invalid session name")
        subprocess.run(self._base() + ["kill-session", "-t", name], check=False)
        workdir = self._workdir(match.group("id"))
        if (
            os.path.commonpath([self.spool_dir, os.path.abspath(workdir)])
            == self.spool_dir
            and os.path.isdir(workdir)
        ):
            shutil.rmtree(workdir, ignore_errors=True)
```

- [ ] **Step 4: Run test.** `python -m unittest tests.test_agent_sessions -v` → OK.

- [ ] **Step 5: Commit** (in `folio`):

```bash
cd /data/andrew/dev/ui/sources/folio
git add backend/folio_backend/agent.py backend/tests/test_agent_sessions.py
git commit -m "folio-backend: ephemeral temp-dir agent session manager"
```

---

### Task 7: Agent companion router + env-gated wiring in app.py

**Goal:** Expose `/agent/{login,auth-check,config,sessions}` and register them in `create_app` only when `FOLIO_AGENTS` and `FOLIO_AGENT_SECRETS` are set.

**Files:**
- Create: `/data/andrew/dev/ui/sources/folio/backend/folio_backend/agent_router.py`
- Modify: `/data/andrew/dev/ui/sources/folio/backend/folio_backend/app.py:246-251` (after the SPA mount, add gated router wiring)
- Create: `/data/andrew/dev/ui/sources/folio/backend/tests/test_api_agent.py`

**Acceptance Criteria:**
- [ ] Unauthenticated `GET /agent/auth-check` → 401; after `POST /agent/login` (correct password) → 204.
- [ ] `GET /agent/config` returns `{"agents": [...], "csrf": "..."}` when authed.
- [ ] `POST /agent/sessions` requires the CSRF header and a configured agent; `DELETE /agent/sessions/{name}` requires CSRF.
- [ ] With `FOLIO_AGENTS` unset, `/agent/*` routes are absent (404).

**Verify:** `python -m unittest tests.test_api_agent -v` → OK.

**Steps:**

- [ ] **Step 1: Write failing test** `tests/test_api_agent.py`:

```python
import json
import tempfile
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from werkzeug.security import generate_password_hash

from folio_backend.agent_auth import AgentAuth, load_secrets
from folio_backend.agent_router import create_agent_router


class FakeSessions:
    def __init__(self):
        self.agents = ("claude", "codex")
        self.active = []
        self.killed = []

    def list(self):
        return list(self.active)

    def spawn(self, agent):
        if agent not in self.agents:
            raise ValueError("bad agent")
        name = f"folio-agent--{agent}--0123abcd"
        self.active.append({"name": name, "agent": agent, "created": 1, "attached": 0})
        return name

    def kill(self, name):
        self.killed.append(name)


def _client():
    tmp = tempfile.NamedTemporaryFile(suffix=".json", mode="w", delete=False)
    json.dump({"secret_key": "k", "password_hash": generate_password_hash("pw")}, tmp)
    tmp.close()
    key, pwhash = load_secrets(tmp.name)
    sessions = FakeSessions()
    app = FastAPI()
    app.include_router(create_agent_router(AgentAuth(key, pwhash), sessions,
                                           secure_cookie=False))
    return TestClient(app), sessions


class AgentApiTest(unittest.TestCase):
    def test_auth_gate(self):
        client, _ = _client()
        self.assertEqual(client.get("/agent/auth-check").status_code, 401)
        self.assertEqual(client.post("/agent/login", json={"password": "wrong"}).status_code, 401)
        ok = client.post("/agent/login", json={"password": "pw"})
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(client.get("/agent/auth-check").status_code, 204)

    def test_config_and_spawn_kill(self):
        client, sessions = _client()
        csrf = client.post("/agent/login", json={"password": "pw"}).json()["csrf"]
        cfg = client.get("/agent/config").json()
        self.assertEqual(cfg["agents"], ["claude", "codex"])
        # CSRF required.
        self.assertEqual(client.post("/agent/sessions", json={"agent": "claude"}).status_code, 403)
        spawned = client.post("/agent/sessions", json={"agent": "claude"},
                              headers={"x-csrf-token": csrf})
        self.assertEqual(spawned.status_code, 200)
        name = spawned.json()["name"]
        self.assertEqual([r["name"] for r in client.get("/agent/sessions").json()], [name])
        killed = client.request("DELETE", f"/agent/sessions/{name}",
                                headers={"x-csrf-token": csrf})
        self.assertEqual(killed.status_code, 204)
        self.assertEqual(sessions.killed, [name])

    def test_unknown_agent_rejected(self):
        client, _ = _client()
        csrf = client.post("/agent/login", json={"password": "pw"}).json()["csrf"]
        bad = client.post("/agent/sessions", json={"agent": "gemini"},
                          headers={"x-csrf-token": csrf})
        self.assertEqual(bad.status_code, 400)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run to confirm failure.** `python -m unittest tests.test_api_agent -v` → ImportError.

- [ ] **Step 3: Implement** `folio_backend/agent_router.py`:

```python
"""FastAPI router for the Folio agent companion. Password-gated; CSRF on writes."""
import hmac

from fastapi import APIRouter, HTTPException, Request, Response

COOKIE = "folio_agent_session"


def create_agent_router(auth, sessions, secure_cookie=True):
    router = APIRouter(prefix="/agent")

    def require_auth(request):
        if not auth.is_authenticated(request.cookies.get(COOKIE)):
            raise HTTPException(status_code=401, detail="authentication required")

    def require_csrf(request):
        if not hmac.compare_digest(
            request.headers.get("x-csrf-token", ""), auth.csrf_token
        ):
            raise HTTPException(status_code=403, detail="invalid csrf token")

    @router.post("/login")
    async def login(request: Request, response: Response):
        body = await request.json()
        if not auth.check_password(body.get("password", "")):
            raise HTTPException(status_code=401, detail="invalid password")
        response.set_cookie(
            COOKIE, auth.cookie_value, httponly=True, secure=secure_cookie,
            samesite="strict", path="/",
        )
        return {"csrf": auth.csrf_token, "agents": list(sessions.agents)}

    @router.get("/auth-check")
    def auth_check(request: Request):
        require_auth(request)
        return Response(status_code=204)

    @router.get("/config")
    def config(request: Request):
        require_auth(request)
        return {"agents": list(sessions.agents), "csrf": auth.csrf_token}

    @router.get("/sessions")
    def list_sessions(request: Request):
        require_auth(request)
        return sessions.list()

    @router.post("/sessions")
    async def spawn_session(request: Request):
        require_auth(request)
        require_csrf(request)
        body = await request.json()
        try:
            name = sessions.spawn(body.get("agent", ""))
        except ValueError:
            raise HTTPException(status_code=400, detail="unknown agent")
        return {"name": name}

    @router.delete("/sessions/{name}")
    def kill_session(name: str, request: Request):
        require_auth(request)
        require_csrf(request)
        try:
            sessions.kill(name)
        except ValueError:
            raise HTTPException(status_code=400, detail="invalid session")
        return Response(status_code=204)

    return router
```

- [ ] **Step 4: Wire into app.py** — insert after the SPA mount block (`app.py:251`, before `# ---- agent view-follow ----`):

```python
    # ---- agent companion (env-gated: needs configured agents + a secrets file) ----
    _agents = tuple(os.environ.get("FOLIO_AGENTS", "").split())
    _agent_secrets = os.environ.get("FOLIO_AGENT_SECRETS", "")
    if _agents and _agent_secrets:
        from folio_backend.agent import AgentSessions
        from folio_backend.agent_auth import AgentAuth, load_secrets
        from folio_backend.agent_router import create_agent_router

        _spool = os.path.abspath(os.environ.get("FOLIO_AGENT_SPOOL", "/tmp/folio-agent"))
        os.makedirs(_spool, exist_ok=True)
        _key, _pwhash = load_secrets(_agent_secrets)
        _sessions = AgentSessions(
            agents=_agents, spool_dir=_spool,
            tmux_bin=os.environ.get("FOLIO_AGENT_TMUX", "tmux"),
            config=os.environ.get("FOLIO_AGENT_TMUX_CONFIG") or None,
            session_command=os.environ.get(
                "FOLIO_AGENT_SESSION_CMD", "folio-agent-session"),
        )
        app.include_router(create_agent_router(AgentAuth(_key, _pwhash), _sessions))
```

- [ ] **Step 5: Run test + full backend suite.** `python -m unittest discover -s tests -v` → OK.

- [ ] **Step 6: Commit** (in `folio`):

```bash
cd /data/andrew/dev/ui/sources/folio
git add backend/folio_backend/agent_router.py backend/folio_backend/app.py backend/tests/test_api_agent.py
git commit -m "folio-backend: env-gated agent companion router"
```

---

## Phase D — R2: Folio companion frontend (React)

### Task 8: Agent companion API client methods

**Goal:** Add `agentApi` (auth-check, login, config, list/spawn/kill) to the SPA's client.

**Files:**
- Modify: `/data/andrew/dev/ui/sources/folio/frontend/src/api/client.ts` (append)
- Test: `/data/andrew/dev/ui/sources/folio/frontend/src/api/client.test.ts` (append)

**Acceptance Criteria:**
- [ ] `agentApi.authCheck()` resolves `true` on 204 and `false` on 401 (never throws).
- [ ] `agentApi.spawn(agent, csrf)` POSTs JSON with an `x-csrf-token` header.
- [ ] `agentApi.kill(name, csrf)` DELETEs with the CSRF header and URL-encodes the name.

**Verify:** `npm test -- --run src/api/client.test.ts` → pass.

**Steps:**

- [ ] **Step 1: Write failing tests.** Append to `src/api/client.test.ts`:

```typescript
import { agentApi } from './client';

test('authCheck maps 204/401 to boolean', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ status: 204 })
    .mockResolvedValueOnce({ status: 401 });
  vi.stubGlobal('fetch', fetchMock);
  expect(await agentApi.authCheck()).toBe(true);
  expect(await agentApi.authCheck()).toBe(false);
  vi.unstubAllGlobals();
});

test('spawn sends csrf header and agent body', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => ({ name: 'folio-agent--claude--0123abcd' }),
  });
  vi.stubGlobal('fetch', fetchMock);
  const res = await agentApi.spawn('claude', 'CSRF');
  expect(res.name).toContain('folio-agent--claude');
  const [, init] = fetchMock.mock.calls[0];
  expect(init.method).toBe('POST');
  expect(init.headers['x-csrf-token']).toBe('CSRF');
  expect(JSON.parse(init.body)).toEqual({ agent: 'claude' });
  vi.unstubAllGlobals();
});
```

(If `client.test.ts` has no imports from `vitest` globals, they're provided by `globals: true` in vite.config — `vi`, `test`, `expect` are already global.)

- [ ] **Step 2: Run to confirm failure.** `npm test -- --run src/api/client.test.ts` → FAIL (`agentApi` undefined).

- [ ] **Step 3: Implement.** Append to `src/api/client.ts`:

```typescript
export interface AgentSession {
  name: string;
  agent: string;
  created: number;
  attached: number;
}

export interface AgentConfig {
  agents: string[];
  csrf: string;
}

function csrfInit(method: string, csrf: string, data?: unknown): RequestInit {
  const headers: Record<string, string> = { 'x-csrf-token': csrf };
  if (data !== undefined) headers['content-type'] = 'application/json';
  return { method, headers, body: data !== undefined ? JSON.stringify(data) : undefined };
}

export const agentApi = {
  authCheck: async (): Promise<boolean> => {
    const res = await fetch(`${BASE}/agent/auth-check`);
    return res.status === 204;
  },
  login: (password: string) =>
    req<AgentConfig>('/agent/login', jsonInit('POST', { password })),
  config: () => req<AgentConfig>('/agent/config'),
  listSessions: () => req<AgentSession[]>('/agent/sessions'),
  spawn: (agent: string, csrf: string) =>
    req<{ name: string }>('/agent/sessions', csrfInit('POST', csrf, { agent })),
  kill: (name: string, csrf: string) =>
    req<void>(`/agent/sessions/${encodeURIComponent(name)}`, csrfInit('DELETE', csrf)),
};
```

- [ ] **Step 4: Run tests.** `npm test -- --run src/api/client.test.ts` → pass.

- [ ] **Step 5: Commit** (in `folio`):

```bash
cd /data/andrew/dev/ui/sources/folio
git add frontend/src/api/client.ts frontend/src/api/client.test.ts
git commit -m "folio-frontend: agent companion API client"
```

---

### Task 9: `useMediaQuery` hook + `AgentPanel` component

**Goal:** A self-contained panel that handles login → agent picker → terminal iframe, plus a small media-query hook for the wide/narrow decision.

**Files:**
- Create: `/data/andrew/dev/ui/sources/folio/frontend/src/agent/useMediaQuery.ts`
- Create: `/data/andrew/dev/ui/sources/folio/frontend/src/agent/AgentPanel.tsx`
- Create: `/data/andrew/dev/ui/sources/folio/frontend/src/agent/AgentPanel.module.css`
- Create: `/data/andrew/dev/ui/sources/folio/frontend/src/agent/AgentPanel.test.tsx`

**Acceptance Criteria:**
- [ ] When unauthenticated, the panel shows a password form; a correct login reveals the picker.
- [ ] Picking an agent calls `spawn` and renders an iframe whose `src` includes `/folio/agent/terminal/?arg=<name>`.
- [ ] An existing session from `listSessions` is reattached without showing the picker.
- [ ] "Close session" calls `kill` and returns to the picker.

**Verify:** `npm test -- --run src/agent/AgentPanel.test.tsx` → pass.

**Steps:**

- [ ] **Step 1: Write failing test** `src/agent/AgentPanel.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentPanel } from './AgentPanel';
import { agentApi } from '../api/client';

vi.mock('../api/client', () => ({
  agentApi: {
    authCheck: vi.fn(), login: vi.fn(), config: vi.fn(),
    listSessions: vi.fn(), spawn: vi.fn(), kill: vi.fn(),
  },
}));

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  mock(agentApi.authCheck).mockResolvedValue(false);
  mock(agentApi.login).mockResolvedValue({ agents: ['claude', 'codex'], csrf: 'C' });
  mock(agentApi.config).mockResolvedValue({ agents: ['claude', 'codex'], csrf: 'C' });
  mock(agentApi.listSessions).mockResolvedValue([]);
  mock(agentApi.spawn).mockResolvedValue({ name: 'folio-agent--claude--0123abcd' });
});
afterEach(() => vi.clearAllMocks());

test('login then pick agent renders the terminal iframe', async () => {
  render(<AgentPanel active />);
  const pw = await screen.findByLabelText('Companion password');
  await userEvent.type(pw, 'pw');
  await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));
  const claude = await screen.findByRole('button', { name: 'claude' });
  await userEvent.click(claude);
  const frame = await screen.findByTitle('Agent terminal');
  expect(frame.getAttribute('src')).toContain('/folio/agent/terminal/?arg=folio-agent--claude--0123abcd');
});

test('reattaches an existing session without the picker', async () => {
  mock(agentApi.authCheck).mockResolvedValue(true);
  mock(agentApi.listSessions).mockResolvedValue([
    { name: 'folio-agent--codex--0123abcd', agent: 'codex', created: 1, attached: 0 },
  ]);
  render(<AgentPanel active />);
  const frame = await screen.findByTitle('Agent terminal');
  expect(frame.getAttribute('src')).toContain('arg=folio-agent--codex--0123abcd');
  await waitFor(() => expect(screen.queryByRole('button', { name: 'claude' })).toBeNull());
});
```

- [ ] **Step 2: Run to confirm failure.** `npm test -- --run src/agent/AgentPanel.test.tsx` → FAIL (module missing).

- [ ] **Step 3: Implement the hook** `src/agent/useMediaQuery.ts`:

```typescript
import { useEffect, useState } from 'react';

/** True when the media query matches. Falls back to false where matchMedia is absent. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
```

- [ ] **Step 4: Implement the panel** `src/agent/AgentPanel.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { agentApi, type AgentSession } from '../api/client';
import styles from './AgentPanel.module.css';

const STORAGE_KEY = 'folio.agentSession';

type Phase = 'loading' | 'login' | 'picker' | 'session';

export function AgentPanel({ active, hidden }: { active: boolean; hidden?: boolean }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [agents, setAgents] = useState<string[]>([]);
  const [csrf, setCsrf] = useState('');
  const [session, setSession] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const initialized = useRef(false);

  const enterAuthed = useCallback(async (nextCsrf: string, nextAgents: string[]) => {
    setCsrf(nextCsrf);
    setAgents(nextAgents);
    const stored = localStorage.getItem(STORAGE_KEY);
    let live: AgentSession[] = [];
    try {
      live = await agentApi.listSessions();
    } catch {
      live = [];
    }
    const match = live.find((s) => s.name === stored) ?? live[0];
    if (match) {
      setSession(match.name);
      localStorage.setItem(STORAGE_KEY, match.name);
      setPhase('session');
    } else {
      localStorage.removeItem(STORAGE_KEY);
      setPhase('picker');
    }
  }, []);

  // Initialize once the panel first becomes active.
  useEffect(() => {
    if (!active || initialized.current) return;
    initialized.current = true;
    (async () => {
      const authed = await agentApi.authCheck();
      if (!authed) {
        setPhase('login');
        return;
      }
      try {
        const cfg = await agentApi.config();
        await enterAuthed(cfg.csrf, cfg.agents);
      } catch {
        setPhase('login');
      }
    })();
  }, [active, enterAuthed]);

  const onLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const cfg = await agentApi.login(password);
      setPassword('');
      await enterAuthed(cfg.csrf, cfg.agents);
    } catch {
      setError('Invalid password');
    }
  };

  const onPick = async (agent: string) => {
    setError('');
    try {
      const { name } = await agentApi.spawn(agent, csrf);
      localStorage.setItem(STORAGE_KEY, name);
      setSession(name);
      setPhase('session');
    } catch {
      setError('Could not start session');
    }
  };

  const onClose = async () => {
    if (session) {
      try {
        await agentApi.kill(session, csrf);
      } catch {
        /* fall through to picker regardless */
      }
    }
    localStorage.removeItem(STORAGE_KEY);
    setSession(null);
    setPhase('picker');
  };

  return (
    <section className={styles.panel} hidden={hidden} aria-label="Agent companion">
      {phase === 'loading' && <p className={styles.msg}>Loading…</p>}

      {phase === 'login' && (
        <form className={styles.center} onSubmit={onLogin}>
          <label className={styles.field}>
            Companion password
            <input
              type="password" value={password} autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button type="submit">Unlock</button>
          {error && <p className={styles.error}>{error}</p>}
        </form>
      )}

      {phase === 'picker' && (
        <div className={styles.center}>
          <p className={styles.msg}>Start an agent session</p>
          <div className={styles.agents}>
            {agents.map((agent) => (
              <button key={agent} type="button" onClick={() => onPick(agent)}>
                {agent}
              </button>
            ))}
          </div>
          {error && <p className={styles.error}>{error}</p>}
        </div>
      )}

      {phase === 'session' && session && (
        <div className={styles.session}>
          <div className={styles.bar}>
            <span className={styles.name}>{session}</span>
            <button type="button" onClick={onClose}>Close session</button>
          </div>
          <iframe
            className={styles.frame}
            title="Agent terminal"
            src={`/folio/agent/terminal/?arg=${encodeURIComponent(session)}`}
          />
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Implement styles** `src/agent/AgentPanel.module.css`:

```css
.panel { display: flex; flex-direction: column; height: 100%; min-height: 0; background: #000; }
.session { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.bar {
  display: flex; align-items: center; justify-content: space-between;
  gap: 0.5rem; padding: 0.35rem 0.6rem; background: var(--bg, #10151d);
  border-bottom: 1px solid var(--border, #2d3b4c);
}
.name { font: 600 12px/1.2 ui-monospace, monospace; color: var(--fg, #eef4f8); overflow: hidden; text-overflow: ellipsis; }
.frame { flex: 1 1 auto; width: 100%; border: 0; background: #000; }
.center { display: flex; flex-direction: column; gap: 0.75rem; align-items: center; justify-content: center; height: 100%; padding: 1rem; }
.field { display: flex; flex-direction: column; gap: 0.35rem; color: var(--fg); }
.agents { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: center; }
.msg { color: var(--fg); }
.error { color: #f2777a; }
```

- [ ] **Step 6: Run tests.** `npm test -- --run src/agent/AgentPanel.test.tsx` → pass.

- [ ] **Step 7: Commit** (in `folio`):

```bash
cd /data/andrew/dev/ui/sources/folio
git add frontend/src/agent/
git commit -m "folio-frontend: agent companion panel (login, picker, terminal)"
```

---

### Task 10: Wire the companion into App.tsx with responsive layout

**Goal:** Add a header menu button that opens the companion, showing reader+agent side-by-side when wide and toggling between them when narrow, with the panel kept mounted so the terminal websocket survives toggles.

**Files:**
- Modify: `/data/andrew/dev/ui/sources/folio/frontend/src/App.tsx`
- Create: `/data/andrew/dev/ui/sources/folio/frontend/src/App.module.css`
- Modify: `/data/andrew/dev/ui/sources/folio/frontend/src/App.test.tsx` (add layout tests)

**Acceptance Criteria:**
- [ ] A header button labeled "Agent" toggles the companion; existing library/reader render unchanged when it's closed.
- [ ] At ≥1000px both reader and agent render; below 1000px only one shows and the button toggles between them.
- [ ] The reader pane stays mounted (via `hidden`) so its state persists when toggled.

**Verify:** `npm test -- --run src/App.test.tsx` → pass; `npm run build` → succeeds.

**Steps:**

- [ ] **Step 1: Extend the App test.** Add to `src/App.test.tsx` (keep the existing mock; extend it with the agent client). Replace the top `vi.mock('./api/client', ...)` with one that also mocks `agentApi`, and append a layout test:

```tsx
vi.mock('./api/client', () => ({
  LOCKED_EVENT: 'folio:locked',
  api: { listBooks: vi.fn(), deleteBook: vi.fn(), getToc: vi.fn(), getBlocks: vi.fn(), getLastPosition: vi.fn(), getLease: vi.fn() },
  agentApi: {
    authCheck: vi.fn().mockResolvedValue(false), login: vi.fn(), config: vi.fn(),
    listSessions: vi.fn().mockResolvedValue([]), spawn: vi.fn(), kill: vi.fn(),
  },
}));
```

```tsx
test('agent button opens the companion', async () => {
  const { default: userEvent } = await import('@testing-library/user-event');
  render(<App />);
  await screen.findByText('Critique');
  await userEvent.click(screen.getByRole('button', { name: /agent/i }));
  expect(await screen.findByLabelText('Agent companion')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to confirm failure.** `npm test -- --run src/App.test.tsx` → FAIL (no Agent button).

- [ ] **Step 3: Rewrite App.tsx:**

```tsx
import { useState } from 'react';
import { HashRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { ThemeProvider } from './theme/ThemeProvider';
import { ThemeControls } from './theme/ThemeControls';
import { LibraryScreen } from './library/LibraryScreen';
import { ReaderShell } from './reader/ReaderShell';
import { NotesView } from './notesview/NotesView';
import { LeaseBanner } from './lease/LeaseBanner';
import { AgentPanel } from './agent/AgentPanel';
import { useMediaQuery } from './agent/useMediaQuery';
import styles from './App.module.css';
import './theme/tokens.css';

export function App() {
  const wide = useMediaQuery('(min-width: 1000px)');
  const [agentOpen, setAgentOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const [mobileAgent, setMobileAgent] = useState(false);

  const showReader = !agentOpen || wide || !mobileAgent;
  const showAgent = agentOpen && (wide || mobileAgent);

  const onMenu = () => {
    if (!agentOpen) {
      setAgentOpen(true);
      setEverOpened(true);
      setMobileAgent(true);
    } else if (wide) {
      setAgentOpen(false);
    } else {
      setMobileAgent((v) => !v);
    }
  };

  const buttonLabel = !agentOpen ? 'Agent' : wide ? 'Close agent' : mobileAgent ? 'Reader' : 'Agent';

  return (
    <ThemeProvider>
      <HashRouter>
        <header className={styles.header}>
          <Link to="/" className={styles.brand}>folio</Link>
          <div className={styles.right}>
            <LeaseBanner />
            <button type="button" className={styles.agentBtn} onClick={onMenu}>
              {buttonLabel}
            </button>
            <ThemeControls />
          </div>
        </header>
        <div className={styles.split}>
          <div className={styles.pane} hidden={!showReader}>
            <Routes>
              <Route path="/" element={<LibraryScreen />} />
              <Route path="/book/:bookId" element={<ReaderShell />} />
              <Route path="/book/:bookId/notes" element={<NotesView />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
          {everOpened && (
            <div className={styles.pane} hidden={!showAgent}>
              <AgentPanel active={showAgent} hidden={!showAgent} />
            </div>
          )}
        </div>
      </HashRouter>
    </ThemeProvider>
  );
}
```

- [ ] **Step 4: Add layout styles** `src/App.module.css`:

```css
.header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 0.5rem 1rem; border-bottom: 1px solid var(--border);
}
.brand { font-weight: 700; color: var(--fg); text-decoration: none; }
.right { display: flex; align-items: center; gap: 1rem; }
.agentBtn {
  padding: 0.3rem 0.7rem; border: 1px solid var(--border); border-radius: 6px;
  background: transparent; color: var(--fg); cursor: pointer; font: 600 13px/1 system-ui, sans-serif;
}
.split { display: flex; align-items: stretch; height: calc(100vh - 49px); min-height: 0; }
.pane { flex: 1 1 0; min-width: 0; min-height: 0; overflow: auto; }
.pane[hidden] { display: none; }
/* When both panes show (wide + agent open), give the terminal its own column. */
.split > .pane + .pane { border-left: 1px solid var(--border); }
```

- [ ] **Step 5: Run tests + build.** `npm test -- --run` → all pass; `npm run build` → succeeds (tsc + vite).

- [ ] **Step 6: Commit** (in `folio`):

```bash
cd /data/andrew/dev/ui/sources/folio
git add frontend/src/App.tsx frontend/src/App.module.css frontend/src/App.test.tsx
git commit -m "folio-frontend: responsive agent companion layout + menu button"
```

---

## Phase E — R2: NixOS wiring

### Task 11: Folio module — ttyd service, ports, nginx, agent env, secrets copy

**Goal:** Serve the companion under Folio's origin: derive agents from the NixOS option, run a `folio-agent-terminal` ttyd service on a dedicated port, add nginx locations with `auth_request`, provide the session/attach scripts, and provision the secrets copy.

**Files:**
- Modify: `/data/andrew/dev/ui/sources/anixpkgs/pkgs/nixos/service-ports.nix:27-30` (add `agentTerminal`)
- Modify: `/data/andrew/dev/ui/sources/anixpkgs/pkgs/modules/folio/module.nix` (options, env, scripts, ttyd service, nginx)
- Modify: `/data/andrew/dev/ui/sources/anixpkgs/pkgs/nixos/features/services.nix:143-148` (pass agents/companion enable)

**Acceptance Criteria:**
- [ ] `service-ports.folio.agentTerminal` exists and is distinct from other ports.
- [ ] folio-backend gets `FOLIO_AGENTS`, `FOLIO_AGENT_SECRETS`, `FOLIO_AGENT_TMUX*`, `FOLIO_AGENT_SESSION_CMD` env when the companion is enabled and agents are non-empty.
- [ ] A `folio-agent-terminal` ttyd unit serves base-path `/folio/agent/terminal` on the new port, gated by `X-Folio-Agent-Authenticated`.
- [ ] nginx adds `= /folio/agent/auth-check` (internal → backend) and `/folio/agent/terminal/` (→ ttyd, websockets, `auth_request`).
- [ ] `folio_agent.json` is provisioned as a copy of `agent_ui.json` via an ExecStartPre.

**Verify:** Phase F full eval/build. Parse-check each edited file with `nix-instantiate --parse`.

**Steps:**

- [ ] **Step 1: Add the port.** In `service-ports.nix`, change the `folio` block:

```nix
  folio = {
    internal = 6868;
    public = 6869;
    agentTerminal = 6870;
  };
```

- [ ] **Step 2: Add module options + let-bindings.** In `modules/folio/module.nix`, extend the `let` block (after `cfg = config.services.folio-backend;`):

```nix
  agents = config.machines.features.agents.frameworks;
  agentAlternation = lib.concatStringsSep "|" agents;
  companion = cfg.agentCompanion && agents != [ ];

  folioTmuxConf = pkgs.writeText "folio-agent-tmux.conf" ''
    set -g mouse on
    set -g history-limit 50000
  '';

  folioAgentSession = pkgs.writeShellApplication {
    name = "folio-agent-session";
    runtimeInputs = [ pkgs.coreutils ];
    text = ''
      if [ "$#" -ne 2 ]; then
        echo "usage: folio-agent-session WORKDIR AGENT" >&2
        exit 2
      fi
      case "$2" in
        ${agentAlternation}) ;;
        *) echo "folio-agent-session: unsupported agent" >&2; exit 2 ;;
      esac
      cd "$1"
      exec "$2"
    '';
  };

  folioAgentAttach = pkgs.writeShellApplication {
    name = "folio-agent-attach";
    runtimeInputs = [ pkgs.tmux ];
    text = ''
      if [ "$#" -ne 1 ] || [[ ! "$1" =~ ^folio-agent--(${agentAlternation})--[0-9a-f]{8}$ ]]; then
        echo "folio-agent-attach: invalid session" >&2
        exit 2
      fi
      exec tmux -L folio-agent attach-session -t "$1"
    '';
  };
```

- [ ] **Step 3: Declare the options.** In the `options.services.folio-backend` block add:

```nix
    agentCompanion = mkEnableOption "folio agent companion (temp-dir agent terminals)";

    agentSecretsFile = mkOption {
      type = types.str;
      default = "${globalCfg.homeDir}/secrets/flask/folio_agent.json";
      description = "Secrets file for the companion; provisioned as a copy of agent_ui.json.";
    };

    agentSpoolDir = mkOption {
      type = types.str;
      default = "/tmp/folio-agent";
      description = "Base directory holding ephemeral agent session working dirs.";
    };
```

- [ ] **Step 4: Add companion env + secrets copy to the backend service.** In `systemd.services.folio-backend`:
  - add `pkgs.tmux` to `path` (create `path = [ pkgs.tmux ];`);
  - append companion env conditionally to the `Environment` list by changing it to:

```nix
        Environment = [
          "HOME=${globalCfg.homeDir}"
          "FOLIO_DB=${cfg.dataDir}/folio.db"
          "FOLIO_HOST=127.0.0.1"
          "FOLIO_PORT=${toString service-ports.folio.internal}"
          "FOLIO_STATIC_DIR=${anixpkgs.folio-frontend}"
          "FOLIO_MACHINE=${config.networking.hostName}"
          "FOLIO_IS_HUB=${if cfg.isHub then "true" else "false"}"
          "FOLIO_HUB_HOST=${cfg.hubHost}"
          "FOLIO_HUB_PORT=${toString service-ports.folio.public}"
        ]
        ++ lib.optionals companion [
          "FOLIO_AGENTS=${lib.concatStringsSep " " agents}"
          "FOLIO_AGENT_SECRETS=${cfg.agentSecretsFile}"
          "FOLIO_AGENT_SPOOL=${cfg.agentSpoolDir}"
          "FOLIO_AGENT_TMUX=${pkgs.tmux}/bin/tmux"
          "FOLIO_AGENT_TMUX_CONFIG=${folioTmuxConf}"
          "FOLIO_AGENT_SESSION_CMD=${folioAgentSession}/bin/folio-agent-session"
        ];
```

  - add a secrets-copy ExecStartPre (runs as root via `+`) by replacing the single `ExecStartPre` string with a list:

```nix
        ExecStartPre = [
          "+${pkgs.coreutils}/bin/chown -R andrew:dev ${cfg.dataDir}"
        ] ++ lib.optional companion (
          "+${pkgs.bash}/bin/bash -c '"
          + "install -o andrew -g dev -m0600 "
          + "${config.services.agent_ui.secretsFile} ${cfg.agentSecretsFile}'"
        );
```

  (The companion reuses `services.agent_ui.secretsFile` as the copy source, so both stay in lockstep. This assumes Agent UI is enabled on companion machines — asserted in Step 7.)

- [ ] **Step 5: Add the ttyd terminal service.** Inside `config = mkIf cfg.enable { ... }`, add (guarded by `companion`):

```nix
    systemd.services.folio-agent-terminal = lib.mkIf companion {
      description = "folio agent companion ttyd";
      after = [ "folio-backend.service" ];
      wants = [ "folio-backend.service" ];
      wantedBy = [ "multi-user.target" ];
      path = [ pkgs.tmux ];
      environment.HOME = globalCfg.homeDir;
      serviceConfig = {
        Type = "simple";
        ExecStart = "${pkgs.ttyd}/bin/ttyd --port ${toString service-ports.folio.agentTerminal} --interface 127.0.0.1 --writable --url-arg --check-origin --auth-header X-Folio-Agent-Authenticated --base-path /folio/agent/terminal ${folioAgentAttach}/bin/folio-agent-attach";
        Restart = "always";
        RestartSec = 3;
        User = "andrew";
        Group = "dev";
        UMask = "0077";
      };
    };
```

- [ ] **Step 6: Add nginx locations.** The folio vhost already assigns locations individually (`locations."= /" = {...};`, `locations."/" = {...};`, `locations."/view/stream" = {...};`). Leave those untouched and add two more, each conditional via `lib.mkIf companion` on the location value (the nginx `locations` option is `attrsOf submodule`, so an `mkIf`-wrapped value is simply omitted when the condition is false):

```nix
        locations."= /folio/agent/auth-check" = lib.mkIf companion {
          proxyPass = "http://127.0.0.1:${toString service-ports.folio.internal}/agent/auth-check";
          extraConfig = ''
            internal;
            proxy_pass_request_body off;
            proxy_set_header Content-Length "";
          '';
        };
        locations."/folio/agent/terminal/" = lib.mkIf companion {
          proxyPass = "http://127.0.0.1:${toString service-ports.folio.agentTerminal}";
          proxyWebsockets = true;
          extraConfig = ''
            auth_request /folio/agent/auth-check;
            proxy_set_header X-Folio-Agent-Authenticated yes;
            proxy_set_header Host $host;
            proxy_read_timeout 86400;
            proxy_send_timeout 86400;
          '';
        };
```

- [ ] **Step 7: Assert the secrets source exists.** Add to `config`:

```nix
    assertions = [
      {
        assertion = !companion || config.services.agent_ui.enable;
        message = "folio agentCompanion needs services.agent_ui.enable (shared secrets source).";
      }
    ];
```

- [ ] **Step 8: Wire the feature flag.** In `features/services.nix`, extend the folio-backend block:

```nix
    services.folio-backend = {
      enable = features.folio.enable;
      isHub = features.folio.role == "hub";
      desktop = features.folio.desktop;
      hubHost = if features.folio.role == "hub" then "" else features.folio.hubHost;
      agentCompanion = features.folio.enable && features.agents.frameworks != [ ];
    };
```

- [ ] **Step 9: Parse-check and commit** (in `anixpkgs`):

```bash
cd /data/andrew/dev/ui/sources/anixpkgs
for f in pkgs/nixos/service-ports.nix pkgs/modules/folio/module.nix pkgs/nixos/features/services.nix; do
  nix-instantiate --parse "$f" >/dev/null && echo "ok $f"
done
git add pkgs/nixos/service-ports.nix pkgs/modules/folio/module.nix pkgs/nixos/features/services.nix
git commit -m "folio module: agent companion (ttyd, nginx auth_request, agent env, secrets copy)"
```

---

## Phase F — Integration, build, and deploy

### Task 12: Full build, deploy, and manual smoke of all three features

**Goal:** Prove the whole change builds under Nix and works on the machine: Agent UI scrollback via mouse, non-hardcoded agents, and the Folio companion (login, side-by-side, toggle, spawn/scroll/close).

**Files:** none (verification only; fixes land back in the relevant task's files if something fails).

**Acceptance Criteria:**
- [ ] `folio-backend`, `agent_ui`, and `folio-frontend` Nix builds pass (their in-derivation test suites included).
- [ ] A NixOS eval of the target profile succeeds with the new options/services.
- [ ] Manual: mouse wheel scrolls Agent UI scrollback (no `Ctrl-b [`).
- [ ] Manual: Folio shows the reader and an agent session side-by-side at desktop width; narrowing toggles between them via the menu button; the companion password (same as Agent UI) unlocks it; a spawned session scrolls with the mouse; "Close session" removes it.

**Verify:** commands below; then the manual checklist.

**Steps:**

- [ ] **Step 1: Use the deploy skill.** Invoke the `anixpkgs-deploy` skill (and `workspace-development` for branch/commit coordination) — it has the correct build/switch commands for this machine. The commands below are the fallback.

- [ ] **Step 2: Build the packages.**

```bash
cd /data/andrew/dev/ui/sources/anixpkgs
nix build .#agent_ui .#folio-backend .#folio-frontend -L
```

Expected: all three build; `agent_ui` runs pytest, `folio-backend` runs unittest, both green.

- [ ] **Step 3: Evaluate the NixOS config** for a profile that enables folio + agents (e.g. `ats` or `personal`) to catch option/type/assertion errors. Use the repo's standard eval entrypoint (see `anixpkgs-deploy`), e.g.:

```bash
cd /data/andrew/dev/ui/sources/anixpkgs
nix eval .#nixosConfigurations.<host>.config.systemd.services.folio-agent-terminal.serviceConfig.ExecStart 2>&1 | head
```

Expected: prints the ttyd ExecStart string (proves the service + ports + agents resolve).

- [ ] **Step 4: Deploy** via the `anixpkgs-deploy` workflow (rebuild switch on the target host).

- [ ] **Step 5: Manual smoke — Agent UI scrollback.** Open an Agent UI session, produce output beyond one screen, scroll the mouse wheel up → history scrolls (copy-mode) without `Ctrl-b [`.

- [ ] **Step 6: Manual smoke — non-hardcoded agents.** Confirm the Agent UI session picker lists exactly `machines.features.agents.frameworks` for the host (e.g. only `claude` on workstation).

- [ ] **Step 7: Manual smoke — Folio companion.** In a wide browser window: click **Agent** → enter the companion password (same as Agent UI) → pick an agent → reader and terminal appear side-by-side; scroll the terminal with the mouse. Narrow the window → the menu button toggles reader/agent. Click **Close session** → session ends and its temp dir is gone (`ls /tmp/folio-agent` no longer lists it).

- [ ] **Step 8: Final commit** if any fixes were needed (in the repo that changed), then stop — do not push or open PRs unless the user asks.

---

## Notes for the implementer

- **DRY:** the tmux mouse-mode config appears in two modules (`agent_ui` and `folio`); they are intentionally separate files because the modules are independent — do not try to share one file across repos.
- **YAGNI:** no `shell` pseudo-agent in the Folio companion, no multi-session UI, no mobile key bar in the Folio terminal (Agent UI's `terminal.html` remains the reference if added later).
- **Security:** the companion is code execution; keep the password gate on both the control endpoints and the ttyd location. Never widen the session-name regexes.
- **Ports:** `folio.agentTerminal = 6870`. If that collides on your host, pick another free port in `service-ports.nix` and it flows everywhere.
