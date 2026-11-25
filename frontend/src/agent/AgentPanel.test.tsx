import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentPanel } from './AgentPanel';
import { agentApi, AgentError } from '../api/client';

vi.mock('../api/client', async (importActual) => {
  const actual = await importActual<typeof import('../api/client')>();
  return {
    ...actual, // keep AgentError et al. real
    agentApi: {
      authCheck: vi.fn(), login: vi.fn(), config: vi.fn(),
      listSessions: vi.fn(), spawn: vi.fn(), kill: vi.fn(), send: vi.fn(),
    },
  };
});

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  mock(agentApi.authCheck).mockResolvedValue(false);
  mock(agentApi.login).mockResolvedValue({ agents: ['claude', 'codex'], csrf: 'C' });
  mock(agentApi.config).mockResolvedValue({ agents: ['claude', 'codex'], csrf: 'C' });
  mock(agentApi.listSessions).mockResolvedValue([]);
  mock(agentApi.spawn).mockResolvedValue({ name: 'folio-agent--claude--0123abcd' });
});
afterEach(() => vi.clearAllMocks());

test('login then pick agent renders the terminal iframe', async () => {
  render(<AgentPanel active />);
  const pw = await screen.findByLabelText('Companion password');
  await userEvent.type(pw, 'pw');
  await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));
  const claude = await screen.findByRole('button', { name: 'claude' });
  await userEvent.click(claude);
  const frame = await screen.findByTitle<HTMLIFrameElement>('Agent terminal');
  expect(frame.getAttribute('src')).toContain('/folio/agent/terminal/?arg=folio-agent--claude--0123abcd');
  expect(screen.getByRole('navigation', { name: 'Terminal keys' })).toBeInTheDocument();
  const arrowUp = screen.getByRole('button', { name: 'ArrowUp' });
  expect(arrowUp).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Paste' })).toBeInTheDocument();

  const frameDocument = frame.contentDocument!;
  if (!frameDocument.documentElement) frameDocument.appendChild(frameDocument.createElement('html'));
  const helper = frameDocument.createElement('textarea');
  helper.className = 'xterm-helper-textarea';
  frameDocument.documentElement.appendChild(helper);
  const keydown = vi.fn();
  helper.addEventListener('keydown', keydown);
  await userEvent.click(arrowUp);
  expect(keydown).toHaveBeenCalledOnce();
  expect((keydown.mock.calls[0][0] as KeyboardEvent).key).toBe('ArrowUp');
  expect((keydown.mock.calls[0][0] as KeyboardEvent).keyCode).toBe(38);
});

test('reattaches an existing session without the picker', async () => {
  mock(agentApi.authCheck).mockResolvedValue(true);
  mock(agentApi.listSessions).mockResolvedValue([
    { name: 'folio-agent--codex--0123abcd', agent: 'codex', created: 1, attached: 0 },
  ]);
  render(<AgentPanel active />);
  const frame = await screen.findByTitle('Agent terminal');
  expect(frame.getAttribute('src')).toContain('arg=folio-agent--codex--0123abcd');
  await waitFor(() => expect(screen.queryByRole('button', { name: 'claude' })).toBeNull());
});

test('close session kills it and returns to the picker', async () => {
  mock(agentApi.authCheck).mockResolvedValue(true);
  mock(agentApi.config).mockResolvedValue({ agents: ['claude'], csrf: 'C' });
  mock(agentApi.listSessions).mockResolvedValue([
    { name: 'folio-agent--claude--0123abcd', agent: 'claude', created: 1, attached: 0 },
  ]);
  mock(agentApi.kill).mockResolvedValue(undefined);
  render(<AgentPanel active />);
  await screen.findByTitle('Agent terminal');
  await userEvent.click(screen.getByRole('button', { name: 'Close session' }));
  expect(agentApi.kill).toHaveBeenCalledWith('folio-agent--claude--0123abcd', 'C');
  expect(await screen.findByText('Start an agent session')).toBeInTheDocument();
});

test('an open session renders the composer between the terminal and the key bar', async () => {
  mock(agentApi.authCheck).mockResolvedValue(true);
  mock(agentApi.listSessions).mockResolvedValue([
    { name: 'folio-agent--claude--0123abcd', agent: 'claude', created: 1, attached: 0 },
  ]);
  mock(agentApi.send).mockResolvedValue(undefined);
  localStorage.setItem('folio-agent-draft:folio-agent--claude--0123abcd', 'draft');
  render(<AgentPanel active />);
  const field = await screen.findByLabelText<HTMLTextAreaElement>('Message to send');
  expect(field.value).toBe('draft');
  const frame = screen.getByTitle('Agent terminal');
  const keys = screen.getByRole('navigation', { name: 'Terminal keys' });
  const form = field.closest('form')!;
  expect(frame.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(form.compareDocumentPosition(keys) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await userEvent.type(field, ' more');
  await userEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(agentApi.send).toHaveBeenCalledWith('folio-agent--claude--0123abcd', 'draft more', 'C');
  await waitFor(() => expect(field.value).toBe(''));
});

test('closing the session removes the composer', async () => {
  mock(agentApi.authCheck).mockResolvedValue(true);
  mock(agentApi.listSessions).mockResolvedValue([
    { name: 'folio-agent--claude--0123abcd', agent: 'claude', created: 1, attached: 0 },
  ]);
  mock(agentApi.kill).mockResolvedValue(undefined);
  render(<AgentPanel active />);
  await screen.findByLabelText('Message to send');
  await userEvent.click(screen.getByRole('button', { name: 'Close session' }));
  await screen.findByText('Start an agent session');
  expect(screen.queryByLabelText('Message to send')).toBeNull();
});

test('a failed login shows an error', async () => {
  mock(agentApi.login).mockRejectedValue(new AgentError('unauthorized'));
  render(<AgentPanel active />);
  const pw = await screen.findByLabelText('Companion password');
  await userEvent.type(pw, 'wrong');
  await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));
  expect(await screen.findByText('Invalid password')).toBeInTheDocument();
});
