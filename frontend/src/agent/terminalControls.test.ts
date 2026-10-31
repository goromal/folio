import { installTerminalControls } from './terminalControls';

function setupTerminal() {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const helper = iframe.contentDocument!.createElement('textarea');
  helper.className = 'xterm-helper-textarea';
  iframe.contentDocument!.body.appendChild(helper);

  const term = {
    cols: 80,
    rows: 24,
    buffer: {
      active: {
        length: 1,
        viewportY: 0,
        getLine: (_row: number): { translateToString(): string } | undefined => undefined,
      },
    },
    clearSelection: vi.fn(),
    focus: vi.fn(),
    getSelection: vi.fn(() => 'selected output'),
    paste: vi.fn(),
    select: vi.fn(),
  };
  Object.defineProperty(iframe.contentWindow!, 'term', { value: term, configurable: true });
  const onModifiersChange = vi.fn();
  const installed = installTerminalControls(iframe, vi.fn(), onModifiersChange);
  return { iframe, helper, term, onModifiersChange, ...installed };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

test('sends an on-screen key to xterm with its legacy key code', () => {
  const { controls, cleanup, helper } = setupTerminal();
  const keydown = vi.fn();
  helper.addEventListener('keydown', keydown);

  controls.sendKey('ArrowLeft', 37);

  expect(keydown).toHaveBeenCalledOnce();
  const event = keydown.mock.calls[0][0] as KeyboardEvent;
  expect(event.key).toBe('ArrowLeft');
  expect(event.keyCode).toBe(37);
  cleanup();
});

function recordKeys(helper: HTMLElement) {
  const keys: Array<{ key: string; keyCode: number; ctrl: boolean; shift: boolean }> = [];
  helper.addEventListener('keydown', (e) => {
    keys.push({ key: e.key, keyCode: e.keyCode, ctrl: e.ctrlKey, shift: e.shiftKey });
  });
  return keys;
}

test('sticky Ctrl and Shift apply to the next on-screen key, then release', () => {
  const { controls, cleanup, helper, onModifiersChange } = setupTerminal();
  const keys = recordKeys(helper);

  controls.toggleCtrl();
  controls.toggleShift();
  expect(onModifiersChange).toHaveBeenLastCalledWith({ ctrl: true, shift: true });
  controls.pressKey('ArrowLeft', 37);
  controls.pressKey('Tab', 9);

  expect(keys).toEqual([
    { key: 'ArrowLeft', keyCode: 37, ctrl: true, shift: true },
    { key: 'Tab', keyCode: 9, ctrl: false, shift: false },
  ]);
  expect(onModifiersChange).toHaveBeenLastCalledWith({ ctrl: false, shift: false });
  cleanup();
});

test('sticky Ctrl turns the next phone-keyboard letter into a Ctrl key', () => {
  const { iframe, controls, cleanup, helper } = setupTerminal();
  const keys = recordKeys(helper);
  const input = vi.fn();
  helper.addEventListener('input', input);

  controls.toggleCtrl();
  const win = iframe.contentWindow as Window & typeof globalThis;
  helper.dispatchEvent(new win.InputEvent('input', {
    data: 'r', inputType: 'insertText', bubbles: true,
  }));

  expect(input).not.toHaveBeenCalled();
  expect(keys).toEqual([{ key: 'r', keyCode: 82, ctrl: true, shift: false }]);
  cleanup();
});

test('internal keystrokes are not captured by an armed Ctrl', () => {
  const { controls, cleanup, helper } = setupTerminal();
  const keys = recordKeys(helper);

  controls.toggleCtrl();
  controls.sendKey('[', 219);

  expect(keys).toEqual([{ key: '[', keyCode: 219, ctrl: false, shift: false }]);
  cleanup();
});

test('copies the selection and pastes clipboard text through xterm', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  const readText = vi.fn().mockResolvedValue('pasted input');
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText, readText }, configurable: true,
  });
  const { controls, cleanup, term } = setupTerminal();

  expect(await controls.copy()).toBe('Copied!');
  expect(writeText).toHaveBeenCalledWith('selected output');
  expect(await controls.paste()).toBe('Pasted!');
  expect(readText).toHaveBeenCalledOnce();
  expect(term.paste).toHaveBeenCalledWith('pasted input');
  cleanup();
});

test('opens the latest URL, joining tmux rows that split it at the edge', () => {
  const { controls, cleanup, term } = setupTerminal();
  const rows = [
    'see https://old.example/a for details',
    'auth: https://example.com/oauth?code=abcdefgh',
    'ijkl.',
  ];
  term.cols = rows[1].length;
  term.buffer.active = {
    length: rows.length,
    viewportY: 0,
    getLine: (row: number) => ({ translateToString: () => rows[row] }),
  };
  term.getSelection.mockReturnValue('');
  const open = vi.spyOn(window, 'open').mockReturnValue(null);

  expect(controls.openUrl()).toBeNull();
  expect(open).toHaveBeenCalledWith(
    'https://example.com/oauth?code=abcdefghijkl', '_blank', 'noopener,noreferrer',
  );

  term.buffer.active = { length: 0, viewportY: 0, getLine: () => undefined };
  expect(controls.openUrl()).toBe('No URL');
  cleanup();
});
