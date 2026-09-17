import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { agentApi, type AgentSession } from '../api/client';
import styles from './AgentPanel.module.css';

const STORAGE_KEY = 'folio.agentSession';

// localStorage can throw (private mode, locked-down webview); never let that
// break the auth flow — treat storage as a best-effort convenience.
function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
function writeStored(value: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* non-fatal */
  }
}
function clearStored(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* non-fatal */
  }
}

type Phase = 'loading' | 'login' | 'picker' | 'session';

export function AgentPanel({ active, hidden }: { active: boolean; hidden?: boolean }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [agents, setAgents] = useState<string[]>([]);
  const [csrf, setCsrf] = useState('');
  const [session, setSession] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const initialized = useRef(false);

  const enterAuthed = useCallback(async (nextCsrf: string, nextAgents: string[]) => {
    setCsrf(nextCsrf);
    setAgents(nextAgents);
    const stored = readStored();
    let live: AgentSession[] = [];
    try {
      live = await agentApi.listSessions();
    } catch {
      live = [];
    }
    const match = live.find((s) => s.name === stored) ?? live[0];
    if (match) {
      setSession(match.name);
      writeStored(match.name);
      setPhase('session');
    } else {
      clearStored();
      setPhase('picker');
    }
  }, []);

  // Initialize once the panel first becomes active.
  useEffect(() => {
    if (!active || initialized.current) return;
    initialized.current = true;
    let cancelled = false;
    (async () => {
      try {
        const authed = await agentApi.authCheck();
        if (cancelled) return;
        if (!authed) {
          setPhase('login');
          return;
        }
        const cfg = await agentApi.config();
        if (cancelled) return;
        await enterAuthed(cfg.csrf, cfg.agents);
      } catch {
        if (!cancelled) setPhase('login');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, enterAuthed]);

  const onLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const cfg = await agentApi.login(password);
      setPassword('');
      await enterAuthed(cfg.csrf, cfg.agents);
    } catch {
      setError('Invalid password');
    } finally {
      setBusy(false);
    }
  };

  const onPick = async (agent: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const { name } = await agentApi.spawn(agent, csrf);
      writeStored(name);
      setSession(name);
      setPhase('session');
    } catch {
      setError('Could not start session');
    } finally {
      setBusy(false);
    }
  };

  const onClose = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (session) {
        try {
          await agentApi.kill(session, csrf);
        } catch {
          /* fall through to picker regardless */
        }
      }
      clearStored();
      setSession(null);
      setPhase('picker');
    } finally {
      setBusy(false);
    }
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
          <button type="submit" disabled={busy}>Unlock</button>
          {error && <p className={styles.error}>{error}</p>}
        </form>
      )}

      {phase === 'picker' && (
        <div className={styles.center}>
          <p className={styles.msg}>Start an agent session</p>
          <div className={styles.agents}>
            {agents.map((agent) => (
              <button key={agent} type="button" disabled={busy} onClick={() => onPick(agent)}>
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
            <button type="button" disabled={busy} onClick={onClose}>Close session</button>
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
