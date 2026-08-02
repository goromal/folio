import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { SelectionToolbar } from './SelectionToolbar';

const rect = { top: 10, left: 20, bottom: 30 } as DOMRect;

test('fires onHighlight with the chosen color, plus onNote/onTag', async () => {
  const onHighlight = vi.fn();
  const onNote = vi.fn();
  const onTag = vi.fn();
  render(<SelectionToolbar rect={rect} onHighlight={onHighlight} onNote={onNote} onTag={onTag} />);
  await userEvent.click(screen.getByRole('button', { name: 'Highlight green' }));
  expect(onHighlight).toHaveBeenCalledWith('green');
  await userEvent.click(screen.getByRole('button', { name: 'Add note' }));
  expect(onNote).toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Add tag' }));
  expect(onTag).toHaveBeenCalled();
});
