import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { App } from './App';
import { api } from './api/client';

vi.mock('./api/client', () => ({
  LOCKED_EVENT: 'folio:locked',
  api: { listBooks: vi.fn(), deleteBook: vi.fn(), getToc: vi.fn(), getBlocks: vi.fn(), getLastPosition: vi.fn(), getLease: vi.fn() },
}));

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
