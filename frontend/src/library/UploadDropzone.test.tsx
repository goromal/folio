import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { UploadDropzone } from './UploadDropzone';
import { api } from '../api/client';

vi.mock('../api/client', () => ({ api: { uploadBook: vi.fn() } }));

beforeEach(() => {
  (api.uploadBook as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 1, title: 'X', author: null,
  });
});
afterEach(() => vi.clearAllMocks());

test('uploads a file chosen via the input and calls onUploaded', async () => {
  const onUploaded = vi.fn();
  render(<UploadDropzone onUploaded={onUploaded} />);
  const file = new File(['epub'], 'book.epub', { type: 'application/epub+zip' });
  const input = screen.getByLabelText(/upload epub/i) as HTMLInputElement;
  await userEvent.upload(input, file);
  expect(api.uploadBook).toHaveBeenCalledWith(file);
  await waitFor(() => expect(onUploaded).toHaveBeenCalled());
});

test('surfaces upload errors', async () => {
  (api.uploadBook as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('bad epub'));
  render(<UploadDropzone onUploaded={vi.fn()} />);
  const file = new File(['x'], 'book.epub');
  await userEvent.upload(screen.getByLabelText(/upload epub/i), file);
  expect(await screen.findByRole('alert')).toHaveTextContent(/bad epub/);
});
