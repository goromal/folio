type TerminalLine = { isWrapped?: boolean; translateToString(trimRight: boolean): string };

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
  // Opens the selected URL, else the latest one; null once a tab is opened.
  openUrl(): 'No URL' | 'Not ready' | null;
  paste(): Promise<'Pasted!' | 'Cancelled' | 'Not ready'>;
  sendKey(key: string, code: number, ctrl?: boolean, shift?: boolean): void;
  // Sends an on-screen key with any armed sticky modifiers, then releases them.
  pressKey(key: string, code: number, ctrl?: boolean): void;
  toggleCtrl(): void;
  toggleShift(): void;
  toggleSelection(): void;
};

export type Modifiers = { ctrl: boolean; shift: boolean };

// Controls and touch gestures for the same-origin ttyd iframe. This mirrors the
// Agent UI terminal wrapper: touch-drag normally scrolls tmux history, while
// Select changes the next drag into an xterm selection.
export function installTerminalControls(
  iframe: HTMLIFrameElement,
  onSelectingChange: (selecting: boolean) => void,
  onModifiersChange: (modifiers: Modifiers) => void = () => {},
): { controls: TerminalControls; cleanup: () => void } {
  const STEP = 12;
  let selecting = false;
  let selectionStart: { column: number; row: number } | null = null;
  let scrollY: number | null = null;
  let scrollMode = false;
  let scrollOffset = 0;
  let doc: Document | null = null;
  let ctrlArmed = false;
  let shiftArmed = false;
  let swallowComposition = false;

  function terminal(): Terminal | null {
    try {
      return ((iframe.contentWindow as unknown as { term?: Terminal } | null)?.term) ?? null;
    } catch {
      return null;
    }
  }

  function helperTextarea(): HTMLTextAreaElement | null {
    try {
      return (
        (iframe.contentDocument?.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null) ||
        (iframe.contentDocument?.querySelector('textarea') as HTMLTextAreaElement | null)
      );
    } catch {
      return null;
    }
  }

  function sendKey(key: string, code: number, ctrl?: boolean, shift?: boolean): void {
    const ta = helperTextarea();
    const win = iframe.contentWindow as (Window & typeof globalThis) | null;
    if (!ta || !win) return;
    ta.focus();
    const event = new win.KeyboardEvent('keydown', {
      key,
      ctrlKey: !!ctrl,
      shiftKey: !!shift,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'keyCode', { get: () => code });
    Object.defineProperty(event, 'which', { get: () => code });
    ta.dispatchEvent(event);
  }

  // Sticky Ctrl/Shift: the next key is sent with the armed modifiers held.
  // Ctrl also applies to letters typed on the phone keyboard, which arrive as
  // input/composition events rather than keydowns, so those are intercepted
  // ahead of xterm. Shift applies to bar keys (Shift+Tab, Shift+arrows); typed
  // text clears it, since the phone keyboard has its own shift.
  const CTRL_CODES: Record<string, number> = { ' ': 32, '[': 219, '\\': 220, ']': 221 };

  function setModifiers(ctrl: boolean, shift: boolean): void {
    ctrlArmed = ctrl;
    shiftArmed = shift;
    onModifiersChange({ ctrl, shift });
  }

  function ctrlCode(ch: string): number | undefined {
    return /^[a-z]$/i.test(ch) ? ch.toUpperCase().charCodeAt(0) : CTRL_CODES[ch];
  }

  function pressKey(key: string, code: number, ctrl?: boolean): void {
    const withCtrl = !!ctrl || ctrlArmed;
    const withShift = shiftArmed;
    setModifiers(false, false);
    sendKey(key, code, withCtrl, withShift);
  }

  function sendCtrlChar(data: string): void {
    const ch = data.slice(-1);
    const code = ctrlCode(ch);
    const withShift = shiftArmed;
    setModifiers(false, false);
    if (code) sendKey(ch.toLowerCase(), code, true, withShift);
  }

  function clearHelper(): void {
    const ta = helperTextarea();
    if (ta) ta.value = '';
  }

  function onCtrlKeydown(event: KeyboardEvent): void {
    if (shiftArmed && !ctrlArmed && event.isTrusted && event.key.length === 1) setModifiers(false, false);
    // Our own synthetic keydowns pass; 'Unidentified'/'Process' fall to onCtrlInput.
    if (!ctrlArmed || !event.isTrusted || event.ctrlKey || event.key.length !== 1 || !ctrlCode(event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    sendCtrlChar(event.key);
  }

  function onCtrlComposition(event: CompositionEvent): void {
    if (event.type === 'compositionstart' && ctrlArmed) swallowComposition = true;
    if (!swallowComposition) return;
    event.stopImmediatePropagation();
    if (event.type === 'compositionend') {
      swallowComposition = false;
      clearHelper();
    }
    if (ctrlArmed && event.data) {
      sendCtrlChar(event.data);
      // Blur/refocus makes the IME commit, so its compositionend is swallowed.
      const ta = helperTextarea();
      if (ta && swallowComposition) { ta.blur(); ta.focus(); }
    }
  }

  function onCtrlInput(event: InputEvent): void {
    if (shiftArmed && !ctrlArmed && event.data) setModifiers(false, false);
    if (!ctrlArmed && !swallowComposition) return;
    event.stopImmediatePropagation();
    if (ctrlArmed && event.data && !event.isComposing) {
      sendCtrlChar(event.data);
      clearHelper();
    }
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

  const COMPOSITION_EVENTS = ['compositionstart', 'compositionupdate', 'compositionend'];
  function detach(): void {
    if (!doc) return;
    doc.removeEventListener('touchstart', onStart as EventListener, true);
    doc.removeEventListener('touchmove', onMove as EventListener, true);
    doc.removeEventListener('touchend', onEnd as EventListener, true);
    doc.removeEventListener('touchcancel', onCancel as EventListener, true);
    doc.removeEventListener('keydown', onCtrlKeydown as EventListener, true);
    doc.removeEventListener('input', onCtrlInput as EventListener, true);
    for (const type of COMPOSITION_EVENTS) doc.removeEventListener(type, onCtrlComposition as EventListener, true);
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
      doc.addEventListener('keydown', onCtrlKeydown as EventListener, true);
      doc.addEventListener('input', onCtrlInput as EventListener, true);
      for (const type of COMPOSITION_EVENTS) doc.addEventListener(type, onCtrlComposition as EventListener, true);
    } catch {
      /* iframe not ready or not same-origin */
    }
  }

  const URL_START = /^\s*https?:\/\//i;

  function terminalText(term: Terminal): string {
    const selected = term.getSelection();
    if (selected) {
      // A URL selected across terminal rows can contain line breaks.
      return URL_START.test(selected) ? selected.replace(/\s+/g, '') : selected;
    }
    const buffer = term.buffer.active;
    const lines: string[] = [];
    const end = Math.min(buffer.length, buffer.viewportY + term.rows);
    for (let row = buffer.viewportY; row < end; row += 1) {
      lines.push(buffer.getLine(row)?.translateToString(true) ?? '');
    }
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    return lines.join('\n');
  }

  // The selected URL, else the last URL anywhere in the buffer (Agent UI's
  // latestUrl). tmux redraws a long URL as separate full-width rows whose
  // isWrapped flag is false, so a URL reaching the row edge is joined too.
  function latestUrl(term: Terminal): string | null {
    const selected = term.getSelection();
    if (selected && URL_START.test(selected)) return selected.replace(/\s+/g, '');
    const buffer = term.buffer.active;
    let latest: string | null = null;
    for (let row = 0; row < buffer.length; row += 1) {
      const line = buffer.getLine(row);
      if (!line) continue;
      const text = line.translateToString(true);
      const urls = /https?:\/\/[^\s<>"']+/gi;
      let match: RegExpExecArray | null;
      while ((match = urls.exec(text))) {
        let url = match[0];
        let part = text;
        let nextRow = row + 1;
        const atEnd = match.index + url.length === text.length;
        while (atEnd && nextRow < buffer.length) {
          const nextLine = buffer.getLine(nextRow);
          if (!nextLine) break;
          const nextText = nextLine.translateToString(true);
          if (!(nextLine.isWrapped || part.length >= term.cols) ||
              !/^[^\s<>"']+$/.test(nextText) || URL_START.test(nextText)) break;
          url += nextText;
          part = nextText;
          nextRow += 1;
        }
        latest = url.replace(/[.,;:!?)]*$/, '');
      }
    }
    return latest;
  }

  // Synchronous so window.open stays inside the click's user activation.
  function openUrl(): 'No URL' | 'Not ready' | null {
    const term = terminal();
    if (!term) return 'Not ready';
    const url = latestUrl(term);
    if (!url) return 'No URL';
    window.open(url, '_blank', 'noopener,noreferrer');
    return null;
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
    openUrl,
    paste,
    sendKey,
    pressKey,
    toggleCtrl() { setModifiers(!ctrlArmed, shiftArmed); },
    toggleShift() { setModifiers(ctrlArmed, !shiftArmed); },
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
      if (ctrlArmed || shiftArmed) setModifiers(false, false);
    },
  };
}
