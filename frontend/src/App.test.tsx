import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { App } from './App';
import { api } from './api/client';

vi.mock('./api/client', async (importActual) => {
  const actual = await importActual<typeof import('./api/client')>();
  return {
    ...actual, // keep AgentError et al. real
    api: { listBooks: vi.fn(), deleteBook: vi.fn(), getToc: vi.fn(), getBlocks: vi.fn(), getLastPosition: vi.fn(), getLease: vi.fn() },
    agentApi: {
      authCheck: vi.fn().mockResolvedValue(false), login: vi.fn(), config: vi.fn(),
      listSessions: vi.fn().mockResolvedValue([]), spawn: vi.fn(), kill: vi.fn(),
    },
  };
});

beforeEach(() => {
  (api.listBooks as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: 1, title: 'Critique', author: 'Kant' },
  ]);
  (api.getLastPosition as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (api.getLease as ReturnType<typeof vi.fn>).mockResolvedValue({ role: 'spoke', held: false, holder: null });
});
afterEach(() => vi.clearAllMocks());

test('renders the brand and the library at the root route', async () => {
  render(<App />);
  expect(screen.getByRole('link', { name: 'folio' })).toBeInTheDocument();
  expect(screen.getByLabelText('Toggle dark mode')).toBeInTheDocument();
  expect(await screen.findByText('Critique')).toBeInTheDocument();
});

test('agent button opens the companion', async () => {
  const { default: userEvent } = await import('@testing-library/user-event');
  render(<App />);
  await screen.findByText('Critique');
  await userEvent.click(screen.getByRole('button', { name: /agent/i }));
  expect(await screen.findByLabelText('Agent companion')).toBeInTheDocument();
});
