import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ReaderShell } from './ReaderShell';
import { api, subscribeFocus } from '../api/client';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));

vi.mock('../api/client', () => ({
  api: {
    getToc: vi.fn(), getBlocks: vi.fn(), listPassages: vi.fn(),
    createPassage: vi.fn(), addHighlight: vi.fn(), getPassage: vi.fn(),
  },
  subscribeFocus: vi.fn(() => () => {}),
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
  const cb = (subscribeFocus as ReturnType<typeof vi.fn>).mock.calls[0][0] as (f: unknown) => void;
  act(() => cb({ version: 1, book_id: 7, chapter_id: 2, block_id: 20 }));
  await waitFor(() =>
    expect(container.querySelector('[data-block-id="20"]')).toBeInTheDocument(),
  );
});

test('a focus for a different book navigates there', async () => {
  renderReader();
  await screen.findByText('First chapter.');
  const cb = (subscribeFocus as ReturnType<typeof vi.fn>).mock.calls[0][0] as (f: unknown) => void;
  act(() => cb({ version: 2, book_id: 99, chapter_id: 1, block_id: 5 }));
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
