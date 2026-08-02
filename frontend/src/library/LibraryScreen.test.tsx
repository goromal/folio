import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { LibraryScreen } from './LibraryScreen';
import { api } from '../api/client';

vi.mock('../api/client', () => ({
  api: { listBooks: vi.fn(), deleteBook: vi.fn(), getLastPosition: vi.fn() },
}));

beforeEach(() => {
  (api.listBooks as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: 1, title: 'Critique', author: 'Kant' },
    { id: 2, title: 'Ethics', author: 'Spinoza' },
  ]);
  (api.deleteBook as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (api.getLastPosition as ReturnType<typeof vi.fn>).mockResolvedValue(null);
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

test('surfaces an alert when delete fails', async () => {
  (api.deleteBook as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('del boom'));
  renderLib();
  await screen.findByText('Critique');
  await userEvent.click(screen.getByRole('button', { name: 'Delete Critique' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/del boom/);
});

test('shows Continue reading when a last position exists', async () => {
  (api.getLastPosition as ReturnType<typeof vi.fn>).mockResolvedValue({
    book_id: 1, chapter_id: 2, block_id: 3, updated_at: 't',
  });
  renderLib();
  const link = await screen.findByRole('link', { name: /Continue reading/ });
  expect(link).toHaveAttribute('href', '/book/1');
});

test('omits Continue reading when there is no last position', async () => {
  renderLib();
  await screen.findByText('Critique');
  expect(screen.queryByRole('link', { name: /Continue reading/ })).not.toBeInTheDocument();
});
