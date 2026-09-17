import os
import subprocess
import tempfile
import unittest

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

    def test_kill_rejects_wrong_agent_even_if_wellformed(self):
        subprocess.run = self._fake_run()
        mgr = self._mgr()
        name = mgr.spawn("claude")
        sid = SESSION_RE.fullmatch(name).group("id")
        workdir = os.path.join(self.spool, f"folio-agent-{sid}")
        with self.assertRaises(ValueError):
            mgr.kill(f"folio-agent--gemini--{sid}")
        self.assertTrue(os.path.isdir(workdir))  # real session's dir untouched

    def test_spawn_without_config_omits_f_flag(self):
        subprocess.run = self._fake_run()
        mgr = AgentSessions(
            agents=("claude",), spool_dir=self.spool, tmux_bin="tmux",
            socket="folio-agent", config=None, session_command="folio-agent-session",
        )
        mgr.spawn("claude")
        self.assertNotIn("-f", self.calls[-1])

    def test_list_returns_empty_on_nonzero_returncode(self):
        subprocess.run = self._fake_run(_Result(stdout="", returncode=1))
        self.assertEqual(self._mgr().list(), [])


if __name__ == "__main__":
    unittest.main()
