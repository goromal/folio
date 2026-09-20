import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { NotesView } from './NotesView';
import { api } from '../api/client';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));

vi.mock('../api/client', () => ({
  api: {
    getToc: vi.fn(), listPassages: vi.fn(), listBookSummaries: vi.fn(),
    createSummary: vi.fn(), updateSummary: vi.fn(),
  },
  subscribeEvents: vi.fn(() => () => {}),
}));

beforeEach(() => {
  navigate.mockClear();
  try { localStorage.clear(); } catch { /* ignore */ }
  (api.getToc as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: 1, title: 'Chapter One', order_idx: 0, parent_id: null, first_block_id: 10 },
  ]);
  (api.listPassages as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: 5, book_id: 7, start_block: 10, start_off: 0, end_block: 10, end_off: 9,
      preview: 'The quick brown fox', chapter_id: 1, link_count: 1,
      highlights: [{ id: 1, color: 'yellow' }], notes: [{ id: 2, body: 'a note', created_at: '', updated_at: '' }],
      tags: [{ id: 3, name: 'kant' }] },
    { id: 6, book_id: 7, start_block: 10, start_off: 10, end_block: 10, end_off: 15,
      preview: 'ethics preview', chapter_id: 1, link_count: 0,
      highlights: [], notes: [], tags: [{ id: 4, name: 'ethics' }] },
  ]);
  (api.listBookSummaries as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (api.createSummary as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1 });
  (api.updateSummary as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1 });
});

function renderNotes() {
  return render(
    <MemoryRouter initialEntries={['/book/7/notes']}>
      <Routes>
        <Route path="/book/:bookId/notes" element={<NotesView />} />
      </Routes>
    </MemoryRouter>,
  );
}

test('lists annotations grouped by chapter with preview and tags', async () => {
  renderNotes();
  expect(await screen.findByText('The quick brown fox')).toBeInTheDocument();
  expect(screen.getByText(/Chapter One \(2\)/)).toBeInTheDocument();
  expect(screen.getByText('kant', { selector: 'span' })).toBeInTheDocument();
  expect(screen.getByText('a note')).toBeInTheDocument();
});

test('does not fetch all blocks', async () => {
  renderNotes();
  await screen.findByText('The quick brown fox');
  expect((api as Record<string, unknown>).getBlocks).toBeUndefined();
});

test('fuzzy search narrows rows', async () => {
  renderNotes();
  await screen.findByText('The quick brown fox');
  await userEvent.type(screen.getByLabelText('Search notes'), 'ethics');
  expect(screen.queryByText('The quick brown fox')).not.toBeInTheDocument();
  expect(screen.getByText('ethics preview')).toBeInTheDocument();
});

test('tag picker narrows rows', async () => {
  renderNotes();
  await screen.findByText('The quick brown fox');
  await userEvent.click(screen.getByRole('checkbox', { name: /ethics/ }));
  expect(screen.queryByText('The quick brown fox')).not.toBeInTheDocument();
  expect(screen.getByText('ethics preview')).toBeInTheDocument();
});

test('open in reader navigates with focus + chapter', async () => {
  renderNotes();
  await screen.findByText('The quick brown fox');
  await userEvent.click(screen.getAllByRole('button', { name: 'Open in reader' })[0]);
  expect(navigate).toHaveBeenCalledWith('/book/7?focus=10&ch=1');
});

test('summaries tab shows only chapters with a summary + an add picker', async () => {
  (api.listBookSummaries as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: 1, scope: 'book', scope_id: 7, body: 'book gist', generated_by: 'user', created_at: '' },
  ]);
  renderNotes();
  await screen.findByText('The quick brown fox');
  await userEvent.click(screen.getByRole('tab', { name: /Summaries/ }));
  expect(screen.getByText('Book summary')).toBeInTheDocument();
  expect(screen.queryByText('Chapter: Chapter One')).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Add summary to chapter' })).toBeInTheDocument();
});

test('editing an agent summary relabels it to user', async () => {
  (api.listBookSummaries as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: 12, scope: 'book', scope_id: 7, body: 'agent gist', generated_by: 'agent', created_at: '' },
  ]);
  renderNotes();
  await screen.findByText('The quick brown fox');
  await userEvent.click(screen.getByRole('tab', { name: /Summaries/ }));
  await screen.findByText('agent gist');
  await userEvent.click(screen.getAllByRole('button', { name: 'Edit summary' })[0]);
  const box = screen.getByLabelText('Edit summary');
  await userEvent.clear(box); await userEvent.type(box, 'mine');
  await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);
  await waitFor(() => expect(api.updateSummary).toHaveBeenCalledWith(12, 'mine', 'user'));
});
