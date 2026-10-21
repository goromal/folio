import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { TocDrawer } from './TocDrawer';

const chapters = ['Genesis 1', 'Genesis 2', 'Genesis 3', 'Exodus 1', 'Exodus 3'].map((title, i) => ({
  id: i + 1, title, order_idx: i, parent_id: null, first_block_id: null,
}));

const titles = () => screen.getAllByRole('listitem').map((li) => li.textContent);

test('typing filters and ranks chapters', async () => {
  render(<TocDrawer chapters={chapters} activeId={1} onSelect={vi.fn()} />);
  await userEvent.type(screen.getByRole('searchbox', { name: 'Search chapters' }), 'ex 3');
  expect(titles()).toEqual(['Exodus 3']);
  expect(screen.getByText('1 of 5')).toBeInTheDocument();
});

test('Enter jumps to the top result and clears the search', async () => {
  const onSelect = vi.fn();
  render(<TocDrawer chapters={chapters} activeId={1} onSelect={onSelect} />);
  const box = screen.getByRole('searchbox', { name: 'Search chapters' });
  await userEvent.type(box, 'gen{Enter}');
  expect(onSelect).toHaveBeenCalledWith(1);
  expect(box).toHaveValue('');
  expect(titles()).toHaveLength(5);
});

test('arrow keys move the cursor before Enter', async () => {
  const onSelect = vi.fn();
  render(<TocDrawer chapters={chapters} activeId={1} onSelect={onSelect} />);
  await userEvent.type(screen.getByRole('searchbox', { name: 'Search chapters' }), 'gen{ArrowDown}{ArrowDown}{Enter}');
  expect(onSelect).toHaveBeenCalledWith(3);
});

test('shows a message when nothing matches; Escape clears', async () => {
  render(<TocDrawer chapters={chapters} activeId={1} onSelect={vi.fn()} />);
  const box = screen.getByRole('searchbox', { name: 'Search chapters' });
  await userEvent.type(box, 'zzz');
  expect(screen.getByText('No matching chapters')).toBeInTheDocument();
  await userEvent.type(box, '{Escape}');
  expect(titles()).toHaveLength(5);
});

test('the clear button empties the search and refocuses it', async () => {
  render(<TocDrawer chapters={chapters} activeId={1} onSelect={vi.fn()} />);
  const box = screen.getByRole('searchbox', { name: 'Search chapters' });
  expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
  await userEvent.type(box, 'ex');
  await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(box).toHaveValue('');
  expect(box).toHaveFocus();
  expect(titles()).toHaveLength(5);
  expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
});
