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
    onAddNote: vi.fn(), onEditNote: vi.fn(), onAddTag: vi.fn(), onRemoveTag: vi.fn(),
    onDelete: vi.fn(), onClose: vi.fn(),
    onCreateLink: vi.fn(), onRemoveLink: vi.fn(),
  };
  render(
    <PassagePanel
      passage={passage}
      links={[{ id: 3, from_passage: 5, to_passage: 8, note: null }]}
      linkTargets={[{ id: 8, preview: 'the categorical imperative' }]}
      {...handlers}
    />,
  );
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

test('edits an existing note', async () => {
  const h = setup();
  await userEvent.click(screen.getByRole('button', { name: 'Edit note' }));
  const box = screen.getByLabelText('Edit note');
  await userEvent.clear(box);
  await userEvent.type(box, 'updated body');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(h.onEditNote).toHaveBeenCalledWith(9, 'updated body');
});

test('cancelling an edit does not call onEditNote', async () => {
  const h = setup();
  await userEvent.click(screen.getByRole('button', { name: 'Edit note' }));
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(h.onEditNote).not.toHaveBeenCalled();
  expect(screen.getByText('existing note')).toBeInTheDocument();
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

test('shows a link with its target preview and can remove it', async () => {
  const h = setup();
  expect(screen.getAllByText('the categorical imperative').length).toBeGreaterThan(0);
  await userEvent.click(screen.getByRole('button', { name: 'Remove link' }));
  expect(h.onRemoveLink).toHaveBeenCalledWith(3);
});

test('the link picker filters and creates a link', async () => {
  const h = setup();
  await userEvent.type(screen.getByLabelText('Link to passage'), 'categorical');
  await userEvent.click(screen.getByRole('button', { name: 'the categorical imperative' }));
  expect(h.onCreateLink).toHaveBeenCalledWith(8);
});

test('shows the other end when this passage is the link target (bidirectional)', () => {
  // passage.id === 5; the link is 8 -> 5, so the panel should show passage 8.
  render(
    <PassagePanel
      passage={passage}
      links={[{ id: 4, from_passage: 8, to_passage: 5, note: null }]}
      linkTargets={[{ id: 8, preview: 'the categorical imperative' }]}
      onAddNote={vi.fn()}
      onEditNote={vi.fn()}
      onAddTag={vi.fn()}
      onRemoveTag={vi.fn()}
      onDelete={vi.fn()}
      onClose={vi.fn()}
      onCreateLink={vi.fn()}
      onRemoveLink={vi.fn()}
    />,
  );
  expect(screen.getAllByText('the categorical imperative').length).toBeGreaterThan(0);
});
