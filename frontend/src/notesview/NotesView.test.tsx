import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { NotesView } from './NotesView';
import { api, subscribeEvents } from '../api/client';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));

vi.mock('../api/client', () => ({
  api: {
    getToc: vi.fn(), listPassages: vi.fn(), listBookSummaries: vi.fn(),
    getBlocks: vi.fn(), getLinks: vi.fn(), createSummary: vi.fn(), deleteSummary: vi.fn(),
  },
  subscribeEvents: vi.fn(() => () => {}),
}));

beforeEach(() => {
  navigate.mockClear();
  (api.getToc as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: 1, title: 'Chapter One', order_idx: 0, parent_id: null },
  ]);
  (api.getBlocks as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: 10, chapter_id: 1, order_idx: 0, type: 'para', text: 'The quick brown fox jumps.' },
  ]);
  (api.listPassages as ReturnType<typeof vi.fn>).mockResolvedValue([
    {
      id: 5, book_id: 7, start_block: 10, start_off: 0, end_block: 10, end_off: 9,
      highlights: [{ id: 1, color: 'yellow' }], notes: [{ id: 2, body: 'a note', created_at: '', updated_at: '' }],
      tags: [{ id: 3, name: 'kant' }],
    },
    {
      id: 6, book_id: 7, start_block: 10, start_off: 10, end_block: 10, end_off: 15,
      highlights: [], notes: [], tags: [{ id: 4, name: 'ethics' }],
    },
  ]);
  (api.listBookSummaries as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (api.getLinks as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (api.createSummary as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1 });
  (api.deleteSummary as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});
afterEach(() => vi.clearAllMocks());

function renderNotes() {
  return render(
    <MemoryRouter initialEntries={['/book/7/notes']}>
      <Routes>
        <Route path="/book/:bookId/notes" element={<NotesView />} />
      </Routes>
    </MemoryRouter>,
  );
}

test('lists passages with preview text and tags', async () => {
  renderNotes();
  expect(await screen.findByText('The quick')).toBeInTheDocument();
  expect(screen.getByText('kant', { selector: 'span' })).toBeInTheDocument();
  expect(screen.getByText('a note')).toBeInTheDocument();
});

test('filtering by a tag narrows the rows', async () => {
  renderNotes();
  await screen.findByText('The quick');
  await userEvent.click(screen.getByRole('button', { name: 'ethics' }));
  expect(screen.queryByText('The quick')).not.toBeInTheDocument();
});

test('saving the book summary replaces + recreates', async () => {
  renderNotes();
  await screen.findByText('The quick');
  await userEvent.type(screen.getByLabelText('Book summary'), 'the gist');
  await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);
  await waitFor(() => expect(api.createSummary).toHaveBeenCalledWith('book', 7, 'the gist'));
});

test('open in reader navigates with a focus param', async () => {
  renderNotes();
  await screen.findByText('The quick');
  await userEvent.click(screen.getAllByRole('button', { name: 'Open in reader' })[0]);
  expect(navigate).toHaveBeenCalledWith('/book/7?focus=10&ch=1');
});

test('shows a Saved confirmation after saving a summary', async () => {
  renderNotes();
  await screen.findByText('The quick');
  await userEvent.type(screen.getByLabelText('Book summary'), 'the gist');
  await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);
  expect(await screen.findByText('Saved ✓')).toBeInTheDocument();
});

test('an existing user summary prefills the editor after load', async () => {
  (api.listBookSummaries as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: 1, scope: 'book', scope_id: 7, body: 'saved gist', generated_by: 'user', created_at: '' },
  ]);
  renderNotes();
  await waitFor(() =>
    expect((screen.getByLabelText('Book summary') as HTMLTextAreaElement).value).toBe('saved gist'),
  );
});

test('reloads on a changed event (live sync)', async () => {
  renderNotes();
  await screen.findByText('The quick');
  const cb = (subscribeEvents as ReturnType<typeof vi.fn>).mock.calls[0][0] as (e: unknown) => void;
  const before = (api.listPassages as ReturnType<typeof vi.fn>).mock.calls.length;
  act(() => cb({ type: 'changed' }));
  await waitFor(() =>
    expect((api.listPassages as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(before),
  );
});
