import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ReaderShell } from './ReaderShell';
import { api } from '../api/client';

vi.mock('../api/client', () => ({
  api: { getToc: vi.fn(), getBlocks: vi.fn() },
}));

beforeEach(() => {
  (api.getToc as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: 1, title: 'Chapter One', order_idx: 0, parent_id: null },
    { id: 2, title: 'Chapter Two', order_idx: 1, parent_id: null },
  ]);
  (api.getBlocks as ReturnType<typeof vi.fn>).mockImplementation(
    (_book: number, chapterId?: number) =>
      Promise.resolve(
        chapterId === 2
          ? [{ id: 20, chapter_id: 2, order_idx: 0, type: 'para', text: 'Second chapter.' }]
          : [{ id: 10, chapter_id: 1, order_idx: 0, type: 'para', text: 'First chapter.' }],
      ),
  );
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

test('loads TOC and first chapter blocks', async () => {
  renderReader();
  expect(await screen.findByText('Chapter One')).toBeInTheDocument();
  expect(await screen.findByText('First chapter.')).toBeInTheDocument();
  expect(api.getToc).toHaveBeenCalledWith(7);
});

test('selecting a chapter loads its blocks', async () => {
  const { container } = renderReader();
  await screen.findByText('First chapter.');
  await userEvent.click(screen.getByRole('button', { name: 'Chapter Two' }));
  await waitFor(() =>
    expect(container.querySelector('[data-block-id="20"]')).toBeInTheDocument(),
  );
  expect(api.getBlocks).toHaveBeenCalledWith(7, 2);
});
