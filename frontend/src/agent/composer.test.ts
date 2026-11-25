import { fireEvent } from '@testing-library/react';
import { mountComposer } from './composer';

const KEY = 'folio-agent-draft:folio-agent--claude--0123abcd';

function deferred() {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(send: (text: string) => Promise<unknown> = vi.fn().mockResolvedValue(undefined)) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const composer = mountComposer(host, { draftKey: KEY, send });
  return { host, send, ...composer };
}

function type(textarea: HTMLTextAreaElement, value: string) {
  textarea.value = value;
  fireEvent.input(textarea);
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

test('renders a phone-friendly textarea and a Send button, styled once', () => {
  const { form, textarea, button } = setup();
  setup();
  expect(form.className).toBe('agent-composer');
  expect(textarea.getAttribute('enterkeyhint')).toBe('enter');
  expect(textarea.getAttribute('autocapitalize')).toBe('sentences');
  expect(textarea.getAttribute('placeholder')).toBe('Message');
  expect(textarea.rows).toBe(1);
  expect(button.textContent).toBe('Send');
  expect(button.type).toBe('submit');
  const styles = document.querySelectorAll('style[data-agent-composer]');
  expect(styles).toHaveLength(1);
  expect(styles[0].textContent).toContain('max-height: 152px;');
  expect(styles[0].textContent).toContain('font: 16px/1.35 system-ui, sans-serif;');
});

test('sends the text and clears the field and draft once send resolves', async () => {
  const pending = deferred();
  const send = vi.fn(() => pending.promise);
  const { form, textarea, button } = setup(send);
  type(textarea, 'hello');
  expect(localStorage.getItem(KEY)).toBe('hello');
  fireEvent.submit(form);
  expect(send).toHaveBeenCalledWith('hello');
  expect(button.disabled).toBe(true);
  expect(textarea.value).toBe('hello');
  pending.resolve();
  await vi.waitFor(() => expect(button.disabled).toBe(false));
  expect(textarea.value).toBe('');
  expect(localStorage.getItem(KEY)).toBeNull();
});

test('keeps text typed while the send was in flight', async () => {
  const pending = deferred();
  const { form, textarea, button } = setup(vi.fn(() => pending.promise));
  type(textarea, 'first');
  fireEvent.submit(form);
  type(textarea, 'first, then more');
  pending.resolve();
  await vi.waitFor(() => expect(button.disabled).toBe(false));
  expect(textarea.value).toBe('first, then more');
  expect(localStorage.getItem(KEY)).toBe('first, then more');
});

test('a rejected send keeps the text and flashes Failed for 1.2s', async () => {
  vi.useFakeTimers();
  const { form, textarea, button } = setup(vi.fn().mockRejectedValue(new Error('500')));
  type(textarea, 'hello');
  fireEvent.submit(form);
  await vi.advanceTimersByTimeAsync(0);
  expect(button.textContent).toBe('Failed');
  expect(button.disabled).toBe(true);
  expect(textarea.value).toBe('hello');
  expect(localStorage.getItem(KEY)).toBe('hello');
  await vi.advanceTimersByTimeAsync(1199);
  expect(button.textContent).toBe('Failed');
  await vi.advanceTimersByTimeAsync(1);
  expect(button.textContent).toBe('Send');
  expect(button.disabled).toBe(false);
});

test('restores the draft from localStorage on mount', () => {
  localStorage.setItem(KEY, 'unsent draft');
  const { textarea } = setup();
  expect(textarea.value).toBe('unsent draft');
});

test('Ctrl+Enter and Cmd+Enter submit; plain Enter does not', () => {
  const send = vi.fn().mockResolvedValue(undefined);
  const { textarea } = setup(send);
  type(textarea, 'line');
  const plain = fireEvent.keyDown(textarea, { key: 'Enter' });
  expect(plain).toBe(true); // not prevented: the newline goes in
  expect(send).not.toHaveBeenCalled();
  const ctrl = fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
  expect(ctrl).toBe(false);
  expect(send).toHaveBeenCalledWith('line');
});

test('Cmd+Enter submits', () => {
  const send = vi.fn().mockResolvedValue(undefined);
  const { textarea } = setup(send);
  type(textarea, 'mac');
  fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
  expect(send).toHaveBeenCalledWith('mac');
});

test('ignores submits while a send is in flight', () => {
  const send = vi.fn(() => new Promise<void>(() => {}));
  const { form, textarea } = setup(send);
  type(textarea, 'once');
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(send).toHaveBeenCalledOnce();
});

test('pointerdown on Send is prevented so focus stays in the field', () => {
  const { button } = setup();
  expect(fireEvent.pointerDown(button)).toBe(false);
});

test('auto-grows the field to its content', () => {
  const { textarea } = setup();
  Object.defineProperty(textarea, 'scrollHeight', { configurable: true, get: () => 80 });
  type(textarea, 'a\nb\nc');
  expect(textarea.style.height).toBe('82px');
});

test('fits again once a detached host is attached (budget/Assistant mount pattern)', async () => {
  const rafCallbacks: Array<() => void> = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
    rafCallbacks.push(() => cb(0));
    return rafCallbacks.length;
  });
  const host = document.createElement('div');
  // Not appended to document.body: mirrors budget/Assistant mounting into a
  // host that is only inserted into the page afterward.
  const { form, textarea } = mountComposer(host, { draftKey: KEY, send: vi.fn() });
  expect(form.isConnected).toBe(false);
  const fitSpy = vi.spyOn(textarea.style, 'height', 'set');
  document.body.appendChild(host);
  Object.defineProperty(textarea, 'scrollHeight', { configurable: true, get: () => 40 });
  expect(rafCallbacks).toHaveLength(1);
  rafCallbacks[0]();
  expect(fitSpy).toHaveBeenCalledWith('42px');
});

test('a localStorage that throws does not break it', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
  const send = vi.fn().mockResolvedValue(undefined);
  const { form, textarea, button } = setup(send);
  expect(textarea.value).toBe('');
  type(textarea, 'still works');
  fireEvent.submit(form);
  expect(send).toHaveBeenCalledWith('still works');
  await vi.waitFor(() => expect(button.disabled).toBe(false));
  expect(textarea.value).toBe('');
});
