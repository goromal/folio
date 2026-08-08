import { useCallback, useEffect, useState } from 'react';
import { api, LOCKED_EVENT, type LeaseState } from '../api/client';

export function LeaseBanner() {
  const [state, setState] = useState<LeaseState | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    api.getLease().then(setState).catch(() => setState(null));
  }, []);

  useEffect(() => {
    refresh();
    const onLocked = () => refresh();
    window.addEventListener(LOCKED_EVENT, onLocked);
    return () => window.removeEventListener(LOCKED_EVENT, onLocked);
  }, [refresh]);

  if (!state) return null;

  async function acquire() {
    setBusy(true);
    try {
      await api.acquireLease();
    } finally {
      setBusy(false);
      refresh();
    }
  }
  async function release() {
    setBusy(true);
    try {
      await api.releaseLease();
    } finally {
      setBusy(false);
      refresh();
    }
  }

  return (
    <div
      role="status"
      style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        fontSize: '0.85rem', color: 'var(--fg)',
      }}
    >
      {state.held ? (
        <>
          <span>✎ Editing — lease held</span>
          <button onClick={release} disabled={busy}>Release</button>
        </>
      ) : (
        <>
          <span>
            🔒 Read-only{state.holder ? ` — held by ${state.holder}` : ''}. Acquire the lease to edit.
          </span>
          <button onClick={acquire} disabled={busy}>Acquire</button>
        </>
      )}
      {state.hubError && (
        <span title={state.hubError} style={{ color: 'var(--danger, #c00)' }}>
          ⚠ hub unreachable
        </span>
      )}
    </div>
  );
}
