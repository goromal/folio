// Finger-drag scrollback for the companion terminal, ported from the Agent UI
// terminal wrapper. The panel embeds ttyd directly, same-origin, so we can reach
// into the iframe's document and drive tmux copy-mode with real keystrokes
// (the reliable input path — synthetic wheel events do not work). The agent
// writes to the normal buffer, so its output lives in tmux scrollback; Up/Down
// are bound to scroll-up/scroll-down in the folio-agent tmux config for smooth
// one-line scrolling. Drag down pages back into history, up returns, and
// reaching the bottom exits copy-mode to the live prompt.
//
// Returns a cleanup function that removes all listeners.
export function installTouchScroll(iframe: HTMLIFrameElement): () => void {
  const STEP = 12; // px of drag per scrolled line
  let scrollY: number | null = null;
  let scrollMode = false;
  let scrollOffset = 0;
  let doc: Document | null = null;

  function helperTextarea(): HTMLElement | null {
    try {
      const d = iframe.contentDocument;
      if (!d) return null;
      return (
        (d.querySelector('.xterm-helper-textarea') as HTMLElement | null) ||
        (d.querySelector('textarea') as HTMLElement | null)
      );
    } catch {
      return null;
    }
  }

  function sendKey(key: string, code: number, ctrl?: boolean): void {
    const ta = helperTextarea();
    // The iframe's own realm, so xterm recognizes the dispatched event; the DOM
    // lib types contentWindow as bare Window, which omits the global constructors.
    const win = iframe.contentWindow as (Window & typeof globalThis) | null;
    if (!ta || !win) return;
    ta.focus();
    const ev = new win.KeyboardEvent('keydown', {
      key,
      ctrlKey: !!ctrl,
      bubbles: true,
      cancelable: true,
    });
    // xterm reads keyCode/which, which the constructor ignores; pin them.
    Object.defineProperty(ev, 'keyCode', { get: () => code });
    Object.defineProperty(ev, 'which', { get: () => code });
    ta.dispatchEvent(ev);
  }

  function enterCopyMode(): void {
    sendKey('b', 66, true); // tmux prefix Ctrl-b
    sendKey('[', 219); // enter copy-mode
  }
  function exitCopyMode(): void {
    sendKey('q', 81); // cancel copy-mode -> live pane
  }
  function scrollLine(up: boolean): void {
    if (up) {
      if (!scrollMode) {
        enterCopyMode();
        scrollMode = true;
        scrollOffset = 0;
      }
      sendKey('ArrowUp', 38);
      scrollOffset += 1;
    } else if (scrollMode) {
      sendKey('ArrowDown', 40);
      scrollOffset -= 1;
      if (scrollOffset <= 0) {
        exitCopyMode();
        scrollMode = false;
        scrollOffset = 0;
      }
    }
  }

  function onStart(e: TouchEvent): void {
    scrollY = e.touches.length === 1 ? e.touches[0].clientY : null;
  }
  function onMove(e: TouchEvent): void {
    if (scrollY === null || e.touches.length !== 1) return;
    const y = e.touches[0].clientY;
    let delta = y - scrollY;
    let steps = 0;
    // Finger down (delta > 0) scrolls up into history; finger up scrolls down.
    while (delta >= STEP) {
      delta -= STEP;
      steps += 1;
    }
    while (delta <= -STEP) {
      delta += STEP;
      steps -= 1;
    }
    if (steps === 0) return;
    scrollY = y - delta; // retain sub-step remainder
    if (steps < 0 && !scrollMode) return; // already live; let the touch pass
    e.preventDefault();
    e.stopImmediatePropagation();
    for (let i = 0; i < Math.abs(steps); i++) scrollLine(steps > 0);
  }
  function onEnd(): void {
    scrollY = null;
  }

  function attach(): void {
    try {
      const d = iframe.contentDocument;
      if (!d || d === doc) return;
      doc = d;
      const opts = { capture: true, passive: false } as AddEventListenerOptions;
      d.addEventListener('touchstart', onStart as EventListener, opts);
      d.addEventListener('touchmove', onMove as EventListener, opts);
      d.addEventListener('touchend', onEnd as EventListener, opts);
      d.addEventListener('touchcancel', onEnd as EventListener, { capture: true });
    } catch {
      /* cross-origin or not ready yet */
    }
  }

  iframe.addEventListener('load', attach);
  attach();

  return () => {
    iframe.removeEventListener('load', attach);
    try {
      if (doc) {
        doc.removeEventListener('touchstart', onStart as EventListener, true);
        doc.removeEventListener('touchmove', onMove as EventListener, true);
        doc.removeEventListener('touchend', onEnd as EventListener, true);
        doc.removeEventListener('touchcancel', onEnd as EventListener, true);
      }
    } catch {
      /* ignore */
    }
  };
}
