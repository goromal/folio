import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { LibraryScreen } from './LibraryScreen';
import { api } from '../api/client';

vi.mock('../api/client', () => ({
  api: { listBooks: vi.fn(), deleteBook: vi.fn() },
}));

beforeEach(() => {
  (api.listBooks as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: 1, title: 'Critique', author: 'Kant' },
    { id: 2, title: 'Ethics', author: 'Spinoza' },
  ]);
  (api.deleteBook as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});
afterEach(() => vi.clearAllMocks());

function renderLib() {
  return render(<MemoryRouter><LibraryScreen /></MemoryRouter>);
}

test('lists books from the API', async () => {
  renderLib();
  expect(await screen.findByText('Critique')).toBeInTheDocument();
  expect(screen.getByText('Ethics')).toBeInTheDocument();
});

test('links each book to its reader route', async () => {
  renderLib();
  const link = await screen.findByRole('link', { name: /Critique/ });
  expect(link).toHaveAttribute('href', '/book/1');
});

test('delete calls api and refreshes', async () => {
  renderLib();
  await screen.findByText('Critique');
  await userEvent.click(screen.getByRole('button', { name: 'Delete Critique' }));
  expect(api.deleteBook).toHaveBeenCalledWith(1);
  await waitFor(() => expect(api.listBooks).toHaveBeenCalledTimes(2));
});
