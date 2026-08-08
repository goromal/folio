import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { LeaseBanner } from './LeaseBanner';
import { api } from '../api/client';

vi.mock('../api/client', () => ({
  LOCKED_EVENT: 'folio:locked',
  api: { getLease: vi.fn(), acquireLease: vi.fn(), releaseLease: vi.fn() },
}));

beforeEach(() => {
  (api.acquireLease as ReturnType<typeof vi.fn>).mockResolvedValue({ held: true, holder: 'dell' });
  (api.releaseLease as ReturnType<typeof vi.fn>).mockResolvedValue({ held: false, holder: null });
});

test('shows acquire control when read-only', async () => {
  (api.getLease as ReturnType<typeof vi.fn>).mockResolvedValue({ role: 'spoke', held: false, holder: null });
  render(<LeaseBanner />);
  expect(await screen.findByRole('button', { name: /acquire/i })).toBeInTheDocument();
});

test('acquire calls the API and re-fetches state', async () => {
  (api.getLease as ReturnType<typeof vi.fn>)
    .mockResolvedValueOnce({ role: 'spoke', held: false, holder: null })
    .mockResolvedValue({ role: 'spoke', held: true, holder: 'dell' });
  render(<LeaseBanner />);
  await userEvent.click(await screen.findByRole('button', { name: /acquire/i }));
  await waitFor(() => expect(api.acquireLease).toHaveBeenCalled());
  expect(await screen.findByRole('button', { name: /release/i })).toBeInTheDocument();
});
