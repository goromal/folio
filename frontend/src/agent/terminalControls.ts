type TerminalLine = { translateToString(trimRight: boolean): string };

type Terminal = {
  cols: number;
  rows: number;
  element?: HTMLElement;
  buffer: {
    active: {
      length: number;
      viewportY: number;
      getLine(row: number): TerminalLine | undefined;
    };
  };
  clearSelection(): void;
  focus(): void;
  getSelection(): string;
  paste(text: string): void;
  select(column: number, row: number, length: number): void;
};

export type TerminalControls = {
  copy(): Promise<'Copied!' | 'Empty' | 'Not ready'>;
  paste(): Promise<'Pasted!' | 'Cancelled' | 'Not ready'>;
  sendKey(key: string, code: number, ctrl?: boolean): void;
  toggleSelection(): void;
};

// Controls and touch gestures for the same-origin ttyd iframe. This mirrors the
// Agent UI terminal wrapper: touch-drag normally scrolls tmux history, while
// Select changes the next drag into an xterm selection.
export function installTerminalControls(
  iframe: HTMLIFrameElement,
  onSelectingChange: (selecting: boolean) => void,
): { controls: TerminalControls; cleanup: () => void } {
  const STEP = 12;
  let selecting = false;
  let selectionStart: { column: number; row: number } | null = null;
  let scrollY: number | null = null;
  let scrollMode = false;
  let scrollOffset = 0;
  let doc: Document | null = null;

  function terminal(): Terminal | null {
    try {
      return ((iframe.contentWindow as unknown as { term?: Terminal } | null)?.term) ?? null;
    } catch {
      return null;
    }
  }

  function helperTextarea(): HTMLElement | null {
    try {
      return (
        (iframe.contentDocument?.querySelector('.xterm-helper-textarea') as HTMLElement | null) ||
        (iframe.contentDocument?.querySelector('textarea') as HTMLElement | null)
      );
    } catch {
      return null;
    }
  }

  function sendKey(key: string, code: number, ctrl?: boolean): void {
    const ta = helperTextarea();
    const win = iframe.contentWindow as (Window & typeof globalThis) | null;
    if (!ta || !win) return;
    ta.focus();
    const event = new win.KeyboardEvent('keydown', {
      key,
      ctrlKey: !!ctrl,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'keyCode', { get: () => code });
    Object.defineProperty(event, 'which', { get: () => code });
    ta.dispatchEvent(event);
  }

  function setSelecting(enabled: boolean): void {
    selecting = enabled;
    selectionStart = null;
    onSelectingChange(enabled);
  }

  function touchCell(term: Terminal, touch: Touch): { column: number; row: number } | null {
    const screen = term.element?.querySelector('.xterm-screen');
    if (!screen) return null;
    const rect = screen.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const column = Math.max(0, Math.min(
      term.cols - 1,
      Math.floor((touch.clientX - rect.left) * term.cols / rect.width),
    ));
    const viewportRow = Math.max(0, Math.min(
      term.rows - 1,
      Math.floor((touch.clientY - rect.top) * term.rows / rect.height),
    ));
    return { column, row: term.buffer.active.viewportY + viewportRow };
  }

  function updateTouchSelection(term: Terminal, end: { column: number; row: number }): void {
    if (!selectionStart) return;
    const startIndex = selectionStart.row * term.cols + selectionStart.column;
    const endIndex = end.row * term.cols + end.column;
    const first = Math.min(startIndex, endIndex);
    const last = Math.max(startIndex, endIndex);
    term.select(first % term.cols, Math.floor(first / term.cols), last - first + 1);
  }

  function handleSelectionTouch(event: TouchEvent, ending: boolean): void {
    const term = terminal();
    const touches = ending ? event.changedTouches : event.touches;
    const cell = term && touches.length ? touchCell(term, touches[0]) : null;
    if (!term || !cell) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!selectionStart) selectionStart = cell;
    updateTouchSelection(term, cell);
    if (ending) setSelecting(false);
  }

  function enterCopyMode(): void {
    sendKey('b', 66, true);
    sendKey('[', 219);
  }
  function exitCopyMode(): void {
    sendKey('q', 81);
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

  function startScrollTouch(event: TouchEvent): void {
    scrollY = event.touches.length === 1 ? event.touches[0].clientY : null;
  }
  function handleScrollTouch(event: TouchEvent): void {
    if (scrollY === null || event.touches.length !== 1) return;
    const y = event.touches[0].clientY;
    let delta = y - scrollY;
    let steps = 0;
    while (delta >= STEP) { delta -= STEP; steps += 1; }
    while (delta <= -STEP) { delta += STEP; steps -= 1; }
    if (steps === 0) return;
    scrollY = y - delta;
    if (steps < 0 && !scrollMode) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    for (let i = 0; i < Math.abs(steps); i += 1) scrollLine(steps > 0);
  }

  function onStart(event: TouchEvent): void {
    if (selecting) handleSelectionTouch(event, false);
    else startScrollTouch(event);
  }
  function onMove(event: TouchEvent): void {
    if (selecting) handleSelectionTouch(event, false);
    else handleScrollTouch(event);
  }
  function onEnd(event: TouchEvent): void {
    if (selecting) handleSelectionTouch(event, true);
    else scrollY = null;
  }
  function onCancel(): void {
    if (selecting) setSelecting(false);
    else scrollY = null;
  }

  function detach(): void {
    if (!doc) return;
    doc.removeEventListener('touchstart', onStart as EventListener, true);
    doc.removeEventListener('touchmove', onMove as EventListener, true);
    doc.removeEventListener('touchend', onEnd as EventListener, true);
    doc.removeEventListener('touchcancel', onCancel as EventListener, true);
    doc = null;
  }
  function attach(): void {
    try {
      const nextDoc = iframe.contentDocument;
      if (!nextDoc || nextDoc === doc) return;
      detach();
      doc = nextDoc;
      const options = { capture: true, passive: false } as AddEventListenerOptions;
      doc.addEventListener('touchstart', onStart as EventListener, options);
      doc.addEventListener('touchmove', onMove as EventListener, options);
      doc.addEventListener('touchend', onEnd as EventListener, options);
      doc.addEventListener('touchcancel', onCancel as EventListener, { capture: true });
    } catch {
      /* iframe not ready or not same-origin */
    }
  }

  function terminalText(term: Terminal): string {
    const selected = term.getSelection();
    if (selected) return selected;
    const buffer = term.buffer.active;
    const lines: string[] = [];
    const end = Math.min(buffer.length, buffer.viewportY + term.rows);
    for (let row = buffer.viewportY; row < end; row += 1) {
      lines.push(buffer.getLine(row)?.translateToString(true) ?? '');
    }
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    return lines.join('\n');
  }

  function legacyCopy(text: string): boolean {
    const field = document.createElement('textarea');
    field.value = text;
    field.style.position = 'fixed';
    field.style.top = '0';
    field.style.left = '0';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.contentEditable = 'true';
    field.readOnly = false;

    const range = document.createRange();
    range.selectNodeContents(field);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    field.setSelectionRange(0, text.length);
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    selection?.removeAllRanges();
    field.remove();
    return copied;
  }

  async function copy(): Promise<'Copied!' | 'Empty' | 'Not ready'> {
    const term = terminal();
    if (!term) return 'Not ready';
    const text = terminalText(term);
    if (!text) {
      term.focus();
      return 'Empty';
    }
    try {
      if (window.isSecureContext && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else if (!legacyCopy(text)) {
        window.prompt('Copy the terminal text:', text);
      }
    } catch {
      if (!legacyCopy(text)) window.prompt('Copy the terminal text:', text);
    }
    term.focus();
    return 'Copied!';
  }

  async function paste(): Promise<'Pasted!' | 'Cancelled' | 'Not ready'> {
    const term = terminal();
    if (!term) return 'Not ready';
    let text: string | null;
    try {
      text = window.isSecureContext && navigator.clipboard?.readText
        ? await navigator.clipboard.readText()
        : window.prompt('Paste clipboard text into the terminal:');
    } catch {
      text = window.prompt('Paste clipboard text into the terminal:');
    }
    if (text === null) {
      term.focus();
      return 'Cancelled';
    }
    term.paste(text);
    term.focus();
    return 'Pasted!';
  }

  const controls: TerminalControls = {
    copy,
    paste,
    sendKey,
    toggleSelection() {
      const term = terminal();
      if (!term) return;
      term.clearSelection();
      setSelecting(!selecting);
    },
  };

  iframe.addEventListener('load', attach);
  attach();
  return {
    controls,
    cleanup: () => {
      iframe.removeEventListener('load', attach);
      detach();
      if (selecting) setSelecting(false);
    },
  };
}
