import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { GlobalNotesView } from './GlobalNotesView';
import { api } from '../api/client';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));

vi.mock('../api/client', () => ({
  api: { listBooks: vi.fn(), listAllPassages: vi.fn() },
  subscribeEvents: vi.fn(() => () => {}),
}));

const passage = (id: number, book_id: number, preview: string, tags: string[], notes: string[] = []) => ({
  id, book_id, start_block: id * 10, start_off: 0, end_block: id * 10, end_off: 5,
  preview, chapter_id: 1, link_count: 0, highlights: [],
  notes: notes.map((body, i) => ({ id: id * 100 + i, body, created_at: '', updated_at: '' })),
  tags: tags.map((name) => ({ id: name.length, name })),
});

beforeEach(() => {
  navigate.mockClear();
  try { localStorage.clear(); } catch { /* ignore */ }
  (api.listBooks as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: 1, title: 'Groundwork' }, { id: 2, title: 'Republic' },
  ]);
  (api.listAllPassages as ReturnType<typeof vi.fn>).mockResolvedValue([
    passage(1, 1, 'duty passage', ['virtue', 'duty'], ['kant note']),
    passage(2, 2, 'justice passage', ['virtue']),
    passage(3, 2, 'loose passage', []),
  ]);
});

function renderView() {
  return render(<MemoryRouter><GlobalNotesView /></MemoryRouter>);
}

test('groups by tag across books, shared tags first', async () => {
  renderView();
  const groups = await screen.findAllByRole('group');
  const titles = groups.map((g) => g.querySelector('summary')!.textContent);
  expect(titles).toEqual(['virtue (2 · 2 books)', 'duty (1 · 1 book)', 'Untagged (1 · 1 book)']);
  const virtue = groups[0];
  expect(within(virtue).getByText('duty passage')).toBeInTheDocument();
  expect(within(virtue).getByText('justice passage')).toBeInTheDocument();
  expect(within(virtue).getByText('Republic')).toBeInTheDocument();
  expect(screen.getByText(/virtue \(2 · 2 books\)/, { selector: 'label' })).toBeInTheDocument();
});

test('switches to grouping by book', async () => {
  renderView();
  await screen.findAllByText('kant note');
  await userEvent.click(screen.getByRole('tab', { name: 'By book' }));
  const titles = screen.getAllByRole('group').map((g) => g.querySelector('summary')!.textContent);
  expect(titles).toEqual(['Groundwork (1)', 'Republic (2)']);
});

test('tag filter and search narrow the list', async () => {
  renderView();
  await screen.findAllByText('kant note');
  await userEvent.click(screen.getByRole('checkbox', { name: /duty/ }));
  expect(screen.queryByText('justice passage')).not.toBeInTheDocument();
  expect(screen.getByText('duty passage')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('checkbox', { name: /duty/ }));
  await userEvent.type(screen.getByLabelText('Search notes'), 'justice');
  expect(screen.queryByText('duty passage')).not.toBeInTheDocument();
  expect(screen.getByText('justice passage')).toBeInTheDocument();
});

test('opens a passage in its own book', async () => {
  renderView();
  await screen.findByText('justice passage');
  const row = screen.getByText('justice passage').closest('li')!;
  await userEvent.click(within(row).getByRole('button', { name: 'Open in reader' }));
  expect(navigate).toHaveBeenCalledWith('/book/2?focus=20&ch=1');
});
