import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ReaderShell } from './ReaderShell';
import { api, subscribeEvents } from '../api/client';
import type { ReactNode } from 'react';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));

vi.mock('../api/client', () => ({
  api: {
    getToc: vi.fn(), getBlocks: vi.fn(), listPassages: vi.fn(),
    createPassage: vi.fn(), addHighlight: vi.fn(), getPassage: vi.fn(),
    getLinks: vi.fn(() => Promise.resolve([])), createLink: vi.fn(), deleteLink: vi.fn(),
    addNote: vi.fn(), updateNote: vi.fn(), tagPassage: vi.fn(), untagPassage: vi.fn(),
    deletePassage: vi.fn(),
    getPosition: vi.fn(() => Promise.resolve(null)),
    getLastPosition: vi.fn(() => Promise.resolve(null)),
    savePosition: vi.fn(() => Promise.resolve()),
  },
  subscribeEvents: vi.fn(() => () => {}),
}));

vi.mock('./Paginator', () => ({
  Paginator: ({ children, onPageBlock }: {
    children?: ReactNode; onPageBlock?: (b: number | null) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onPageBlock?.(42)}>test-page-turn</button>
      {children}
    </div>
  ),
}));

beforeEach(() => {
  navigate.mockClear();
  (api.getToc as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: 1, title: 'Chapter One', order_idx: 0, parent_id: null },
    { id: 2, title: 'Chapter Two', order_idx: 1, parent_id: null },
  ]);
  (api.getBlocks as ReturnType<typeof vi.fn>).mockImplementation((_b: number, ch?: number) =>
    Promise.resolve(
      ch === 2
        ? [{ id: 20, chapter_id: 2, order_idx: 0, type: 'para', text: 'Second chapter.' }]
        : [{ id: 10, chapter_id: 1, order_idx: 0, type: 'para', text: 'First chapter.' }],
    ),
  );
  (api.listPassages as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (api.getPosition as ReturnType<typeof vi.fn>).mockResolvedValue(null);
});
afterEach(() => vi.clearAllMocks());

function renderReader() {
  return render(
    <MemoryRouter initialEntries={['/book/7']}>
      <Routes>
        <Route path="/book/:bookId" element={<ReaderShell />} />
      </Routes>
    </MemoryRouter>,
  );
}

test('loads TOC, blocks, and passages', async () => {
  renderReader();
  expect(await screen.findByText('Chapter One')).toBeInTheDocument();
  expect(await screen.findByText('First chapter.')).toBeInTheDocument();
  await waitFor(() => expect(api.listPassages).toHaveBeenCalledWith(7));
});

test('switching chapters loads new blocks', async () => {
  const { container } = renderReader();
  await screen.findByText('First chapter.');
  await userEvent.click(screen.getByRole('button', { name: 'Chapter Two' }));
  await waitFor(() =>
    expect(container.querySelector('[data-block-id="20"]')).toBeInTheDocument(),
  );
});

test('a focus for the current book switches to its chapter', async () => {
  const { container } = renderReader();
  await screen.findByText('First chapter.');
  const cb = (subscribeEvents as ReturnType<typeof vi.fn>).mock.calls[0][0] as (f: unknown) => void;
  act(() => cb({ type: 'focus', version: 1, book_id: 7, chapter_id: 2, block_id: 20 }));
  await waitFor(() =>
    expect(container.querySelector('[data-block-id="20"]')).toBeInTheDocument(),
  );
});

test('a focus for a different book navigates there', async () => {
  renderReader();
  await screen.findByText('First chapter.');
  const cb = (subscribeEvents as ReturnType<typeof vi.fn>).mock.calls[0][0] as (f: unknown) => void;
  act(() => cb({ type: 'focus', version: 2, book_id: 99, chapter_id: 1, block_id: 5 }));
  expect(navigate).toHaveBeenCalledWith('/book/99');
});

test('the table of contents can be collapsed and reopened', async () => {
  renderReader();
  expect(await screen.findByRole('button', { name: 'Chapter One' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Hide contents' }));
  expect(screen.queryByRole('button', { name: 'Chapter One' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Show contents' }));
  expect(await screen.findByRole('button', { name: 'Chapter One' })).toBeInTheDocument();
});

test('a ?focus deep link loads the target chapter', async () => {
  const { container } = render(
    <MemoryRouter initialEntries={['/book/7?focus=20&ch=2']}>
      <Routes>
        <Route path="/book/:bookId" element={<ReaderShell />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(api.getBlocks).toHaveBeenCalledWith(7, 2));
  await waitFor(() =>
    expect(container.querySelector('[data-block-id="20"]')).toBeInTheDocument(),
  );
});

test('a changed event refetches passages (live sync)', async () => {
  renderReader();
  await screen.findByText('First chapter.');
  const cb = (subscribeEvents as ReturnType<typeof vi.fn>).mock.calls[0][0] as (e: unknown) => void;
  const before = (api.listPassages as ReturnType<typeof vi.fn>).mock.calls.length;
  act(() => cb({ type: 'changed' }));
  await waitFor(() =>
    expect((api.listPassages as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(before),
  );
});

test('restores the saved chapter + block on open (no ?focus)', async () => {
  (api.getPosition as ReturnType<typeof vi.fn>).mockResolvedValue({
    book_id: 7, chapter_id: 2, block_id: 20, updated_at: 't',
  });
  const { container } = renderReader();
  await waitFor(() => expect(api.getBlocks).toHaveBeenCalledWith(7, 2));
  await waitFor(() =>
    expect(container.querySelector('[data-block-id="20"]')).toBeInTheDocument());
});

test('?focus wins over a saved position', async () => {
  (api.getPosition as ReturnType<typeof vi.fn>).mockResolvedValue({
    book_id: 7, chapter_id: 1, block_id: 10, updated_at: 't',
  });
  render(
    <MemoryRouter initialEntries={['/book/7?focus=20&ch=2']}>
      <Routes>
        <Route path="/book/:bookId" element={<ReaderShell />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(api.getBlocks).toHaveBeenCalledWith(7, 2));
});

test('saves position (debounced) on page turn after restore', async () => {
  (api.getPosition as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  renderReader();
  await screen.findByText('First chapter.');
  await userEvent.click(screen.getByRole('button', { name: 'test-page-turn' }));
  await waitFor(
    () => expect(api.savePosition).toHaveBeenCalledWith(7, { chapter_id: 1, block_id: 42 }),
    { timeout: 1500 },
  );
});

test('selecting a chapter from the TOC saves its first block', async () => {
  (api.getPosition as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  renderReader();
  await screen.findByText('First chapter.'); // initial chapter loaded, restore settled
  await userEvent.click(screen.getByRole('button', { name: 'Chapter Two' }));
  await waitFor(
    () => expect(api.savePosition).toHaveBeenCalledWith(7, { chapter_id: 2, block_id: 20 }),
    { timeout: 1500 },
  );
});
