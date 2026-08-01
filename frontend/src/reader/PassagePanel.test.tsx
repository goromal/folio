import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { PassagePanel } from './PassagePanel';
import type { PassageDetail } from '../api/client';

const passage: PassageDetail = {
  id: 5, book_id: 7, start_block: 11, start_off: 0, end_block: 11, end_off: 3,
  highlights: [{ id: 1, color: 'yellow' }],
  notes: [{ id: 9, body: 'existing note', created_at: '', updated_at: '' }],
  tags: [{ id: 2, name: 'kant' }],
};

function setup() {
  const handlers = {
    onAddNote: vi.fn(), onAddTag: vi.fn(), onRemoveTag: vi.fn(),
    onDelete: vi.fn(), onClose: vi.fn(),
  };
  render(<PassagePanel passage={passage} {...handlers} />);
  return handlers;
}

test('shows existing notes and tags', () => {
  setup();
  expect(screen.getByText('existing note')).toBeInTheDocument();
  expect(screen.getByText('kant')).toBeInTheDocument();
});

test('adds a note', async () => {
  const h = setup();
  await userEvent.type(screen.getByLabelText('New note'), 'fresh');
  await userEvent.click(screen.getByRole('button', { name: 'Save note' }));
  expect(h.onAddNote).toHaveBeenCalledWith('fresh');
});

test('adds and removes tags, and deletes the passage', async () => {
  const h = setup();
  await userEvent.type(screen.getByLabelText('New tag'), 'ethics');
  await userEvent.click(screen.getByRole('button', { name: 'Add tag' }));
  expect(h.onAddTag).toHaveBeenCalledWith('ethics');
  await userEvent.click(screen.getByRole('button', { name: 'Remove tag kant' }));
  expect(h.onRemoveTag).toHaveBeenCalledWith(2);
  await userEvent.click(screen.getByRole('button', { name: 'Delete passage' }));
  expect(h.onDelete).toHaveBeenCalled();
});
