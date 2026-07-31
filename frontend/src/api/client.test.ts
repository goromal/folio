import { afterEach, expect, test, vi } from 'vitest';
import { api } from './client';

afterEach(() => vi.restoreAllMocks());

function mockFetch(status: number, body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

test('listBooks GETs /books', async () => {
  const f = mockFetch(200, [{ id: 1, title: 'A', author: null }]);
  const books = await api.listBooks();
  expect(f).toHaveBeenCalledWith('/books', undefined);
  expect(books[0].title).toBe('A');
});

test('deleteBook DELETEs and resolves undefined on 204', async () => {
  const f = mockFetch(204, undefined);
  const res = await api.deleteBook(3);
  expect(f).toHaveBeenCalledWith('/books/3', { method: 'DELETE' });
  expect(res).toBeUndefined();
});

test('getBlocks passes chapter_id when given', async () => {
  const f = mockFetch(200, []);
  await api.getBlocks(2, 5);
  expect(f).toHaveBeenCalledWith('/books/2/blocks?chapter_id=5', undefined);
});

test('uploadBook POSTs multipart FormData', async () => {
  const f = mockFetch(201, { id: 1, title: 'A', author: null });
  await api.uploadBook(new File(['x'], 'a.epub'));
  const [url, init] = f.mock.calls[0];
  expect(url).toBe('/books');
  expect((init as RequestInit).method).toBe('POST');
  expect((init as RequestInit).body).toBeInstanceOf(FormData);
});

test('non-OK throws', async () => {
  mockFetch(500, { detail: 'boom' });
  await expect(api.listBooks()).rejects.toThrow();
});
