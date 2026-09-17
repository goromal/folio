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
        try:
            result = subprocess.run(
                self._base() + [
                    "list-sessions", "-F",
                    "#{session_name}\t#{session_created}\t#{session_attached}",
                ],
                check=False, capture_output=True, text=True, timeout=10,
            )
        except (OSError, subprocess.SubprocessError):
            return []
        if result.returncode != 0:
            return []
        rows = []
        for line in result.stdout.splitlines():
            try:
                name, created, attached = line.split("\t")
                created_i = int(created)
                attached_i = int(attached)
            except ValueError:
                continue
            match = SESSION_RE.fullmatch(name)
            if not match or match.group("agent") not in self.agents:
                continue
            rows.append({
                "name": name, "agent": match.group("agent"),
                "created": created_i, "attached": attached_i,
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
        try:
            subprocess.run(command, check=True, timeout=10)
        except Exception:
            shutil.rmtree(workdir, ignore_errors=True)
            raise
        return name

    def kill(self, name):
        match = SESSION_RE.fullmatch(name)
        if not match or match.group("agent") not in self.agents:
            raise ValueError("invalid session name")
        subprocess.run(
            self._base() + ["kill-session", "-t", name], check=False, timeout=10
        )
        workdir = self._workdir(match.group("id"))
        if (
            os.path.commonpath([self.spool_dir, os.path.abspath(workdir)])
            == self.spool_dir
            and os.path.isdir(workdir)
        ):
            shutil.rmtree(workdir, ignore_errors=True)
