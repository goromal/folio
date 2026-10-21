import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { LibraryScreen } from './LibraryScreen';
import { api } from '../api/client';

vi.mock('../api/client', () => ({
  api: {
    listBooks: vi.fn(), deleteBook: vi.fn(), getLastPosition: vi.fn(),
    listShelves: vi.fn(), createShelf: vi.fn(), renameShelf: vi.fn(),
    deleteShelf: vi.fn(), setBookShelves: vi.fn(),
  },
}));

const mocked = (f: unknown) => f as ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  mocked(api.listBooks).mockResolvedValue([
    { id: 1, title: 'Critique', author: 'Immanuel Kant', created_at: '2026-01-01', last_read_at: '2026-03-01', shelf_ids: [10] },
    { id: 2, title: 'Ethics', author: 'Baruch Spinoza', created_at: '2026-02-01', last_read_at: null, shelf_ids: [] },
    { id: 3, title: 'The Apology', author: 'Plato', created_at: '2026-01-15', last_read_at: '2026-04-01', shelf_ids: [10, 11] },
  ]);
  mocked(api.listShelves).mockResolvedValue([
    { id: 10, name: 'Philosophy', book_count: 2 },
    { id: 11, name: 'Ancient', book_count: 1 },
  ]);
  mocked(api.createShelf).mockResolvedValue({ id: 12, name: 'New', book_count: 0 });
  mocked(api.setBookShelves).mockResolvedValue({});
  mocked(api.deleteShelf).mockResolvedValue(undefined);
  mocked(api.renameShelf).mockResolvedValue({});
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

const titles = () => screen.getAllByRole('link')
  .map((a) => a.textContent ?? '')
  .filter((t) => ['Critique', 'Ethics', 'The Apology'].includes(t));

test('defaults to recently-read order', async () => {
  renderLib();
  await screen.findByText('Critique');
  expect(titles()).toEqual(['The Apology', 'Critique', 'Ethics']);
});

test('title sort ignores leading articles; list view shows letter headers', async () => {
  renderLib();
  await screen.findByText('Critique');
  await userEvent.selectOptions(screen.getByRole('combobox'), 'title');
  expect(titles()).toEqual(['The Apology', 'Critique', 'Ethics']);
  expect(screen.queryByRole('heading', { name: 'A' })).not.toBeInTheDocument(); // grid: no sections
  await userEvent.click(screen.getByRole('button', { name: 'List' }));
  expect(screen.getByRole('heading', { name: 'A' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'C' })).toBeInTheDocument();
});

test('author sort files by surname', async () => {
  renderLib();
  await screen.findByText('Critique');
  await userEvent.selectOptions(screen.getByRole('combobox'), 'author');
  expect(titles()).toEqual(['Critique', 'The Apology', 'Ethics']);
});

test('selecting a shelf filters books, and Unshelved shows the rest', async () => {
  renderLib();
  await screen.findByText('Critique');
  const nav = screen.getByRole('navigation', { name: 'Shelves' });
  await userEvent.click(within(nav).getByRole('button', { name: /Ancient/ }));
  expect(titles()).toEqual(['The Apology']);
  await userEvent.click(within(nav).getByRole('button', { name: /Unshelved/ }));
  expect(titles()).toEqual(['Ethics']);
});

test('filter box matches title or author', async () => {
  renderLib();
  await screen.findByText('Critique');
  await userEvent.type(screen.getByRole('searchbox', { name: 'Filter books' }), 'spino');
  expect(titles()).toEqual(['Ethics']);
});

test('view and sort preferences persist across mounts', async () => {
  const { unmount } = renderLib();
  await screen.findByText('Critique');
  await userEvent.click(screen.getByRole('button', { name: 'List' }));
  await userEvent.selectOptions(screen.getByRole('combobox'), 'title');
  unmount();
  renderLib();
  await screen.findByText('Critique');
  expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('combobox')).toHaveValue('title');
});

test('creates a shelf and switches to it', async () => {
  renderLib();
  await screen.findByText('Critique');
  await userEvent.click(screen.getByRole('button', { name: '+ New shelf' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Shelf name' }), 'New{Enter}');
  expect(api.createShelf).toHaveBeenCalledWith('New');
});

test('toggling a shelf in the picker updates the book', async () => {
  renderLib();
  await screen.findByText('Critique');
  await userEvent.click(screen.getByRole('button', { name: 'Shelves for Ethics' }));
  const dlg = screen.getByRole('dialog', { name: 'Shelves for Ethics' });
  await userEvent.click(within(dlg).getByRole('checkbox', { name: 'Ancient' }));
  expect(api.setBookShelves).toHaveBeenCalledWith(2, [11]);
});

test('deleting a shelf needs confirmation', async () => {
  renderLib();
  await screen.findByText('Critique');
  await userEvent.click(within(screen.getByRole('navigation', { name: 'Shelves' }))
    .getByRole('button', { name: /Ancient/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Delete…' }));
  expect(api.deleteShelf).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Delete shelf' }));
  expect(api.deleteShelf).toHaveBeenCalledWith(11);
});

test('renames the selected shelf', async () => {
  renderLib();
  await screen.findByText('Critique');
  await userEvent.click(within(screen.getByRole('navigation', { name: 'Shelves' }))
    .getByRole('button', { name: /Ancient/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
  const input = screen.getByRole('textbox', { name: 'Rename shelf' });
  await userEvent.clear(input);
  await userEvent.type(input, 'Classics{Enter}');
  expect(api.renameShelf).toHaveBeenCalledWith(11, 'Classics');
});
