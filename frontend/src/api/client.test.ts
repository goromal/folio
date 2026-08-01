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

test('createPassage POSTs anchor JSON to /passages', async () => {
  const f = mockFetch(201, { id: 5, book_id: 7, start_block: 1, start_off: 0, end_block: 1, end_off: 3 });
  await api.createPassage({ book_id: 7, start_block: 1, start_off: 0, end_block: 1, end_off: 3 });
  const [url, init] = f.mock.calls[0];
  expect(url).toBe('/passages');
  expect((init as RequestInit).method).toBe('POST');
  expect((init as RequestInit).headers).toMatchObject({ 'content-type': 'application/json' });
  expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ book_id: 7, start_block: 1 });
});

test('listPassages GETs the book passages', async () => {
  const f = mockFetch(200, []);
  await api.listPassages(7);
  expect(f).toHaveBeenCalledWith('/books/7/passages', undefined);
});

test('addHighlight POSTs color', async () => {
  const f = mockFetch(201, { id: 3 });
  await api.addHighlight(5, 'green');
  const [url, init] = f.mock.calls[0];
  expect(url).toBe('/passages/5/highlights');
  expect(JSON.parse((init as RequestInit).body as string)).toEqual({ color: 'green' });
});

test('addNote POSTs body + passage_id to /notes', async () => {
  const f = mockFetch(201, { id: 9 });
  await api.addNote(5, 'a note');
  const [url, init] = f.mock.calls[0];
  expect(url).toBe('/notes');
  expect(JSON.parse((init as RequestInit).body as string)).toEqual({ passage_id: 5, body: 'a note' });
});

test('tagPassage POSTs the tag name', async () => {
  const f = mockFetch(201, { tag_id: 2 });
  await api.tagPassage(5, 'kant');
  const [url, init] = f.mock.calls[0];
  expect(url).toBe('/passages/5/tags');
  expect(JSON.parse((init as RequestInit).body as string)).toEqual({ name: 'kant' });
});

test('untagPassage DELETEs the junction row', async () => {
  const f = mockFetch(204, undefined);
  await api.untagPassage(5, 2);
  expect(f).toHaveBeenCalledWith('/passages/5/tags/2', { method: 'DELETE' });
});

test('deletePassage DELETEs', async () => {
  const f = mockFetch(204, undefined);
  await api.deletePassage(5);
  expect(f).toHaveBeenCalledWith('/passages/5', { method: 'DELETE' });
});
