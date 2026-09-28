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
      active: { length: 1, viewportY: 0, getLine: () => undefined },
    },
    clearSelection: vi.fn(),
    focus: vi.fn(),
    getSelection: vi.fn(() => 'selected output'),
    paste: vi.fn(),
    select: vi.fn(),
  };
  Object.defineProperty(iframe.contentWindow!, 'term', { value: term, configurable: true });
  const installed = installTerminalControls(iframe, vi.fn());
  return { iframe, helper, term, ...installed };
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
