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

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((e: { data: string }) => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
}

test('getLinks GETs a passage links', async () => {
  const f = mockFetch(200, []);
  await api.getLinks(5);
  expect(f).toHaveBeenCalledWith('/passages/5/links', undefined);
});

test('createLink POSTs to_passage + note', async () => {
  const f = mockFetch(201, { id: 1 });
  await api.createLink(5, 8, 'see also');
  const [url, init] = f.mock.calls[0];
  expect(url).toBe('/passages/5/links');
  expect(JSON.parse((init as RequestInit).body as string)).toEqual({ to_passage: 8, note: 'see also' });
});

test('deleteLink DELETEs', async () => {
  const f = mockFetch(204, undefined);
  await api.deleteLink(3);
  expect(f).toHaveBeenCalledWith('/links/3', { method: 'DELETE' });
});

test('listBookSummaries GETs book summaries', async () => {
  const f = mockFetch(200, []);
  await api.listBookSummaries(7);
  expect(f).toHaveBeenCalledWith('/books/7/summaries', undefined);
});

test('createSummary POSTs scope + scope_id + body', async () => {
  const f = mockFetch(201, { id: 1 });
  await api.createSummary('book', 7, 'the gist');
  const [url, init] = f.mock.calls[0];
  expect(url).toBe('/summaries');
  expect(JSON.parse((init as RequestInit).body as string)).toEqual({ scope: 'book', scope_id: 7, body: 'the gist' });
});

test('deleteSummary DELETEs', async () => {
  const f = mockFetch(204, undefined);
  await api.deleteSummary(9);
  expect(f).toHaveBeenCalledWith('/summaries/9', { method: 'DELETE' });
});

test('subscribeEvents delivers parsed events and unsubscribes', async () => {
  const { subscribeEvents } = await import('./client');
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  FakeEventSource.instances = [];
  const seen: Array<{ type: string; block_id?: number }> = [];
  const off = subscribeEvents((e) => seen.push(e as { type: string; block_id?: number }));
  const es = FakeEventSource.instances[0];
  expect(es.url).toContain('/view/stream');
  es.onmessage!({ data: JSON.stringify({ type: 'focus', version: 1, book_id: 7, chapter_id: 2, block_id: 10 }) });
  es.onmessage!({ data: JSON.stringify({ type: 'changed' }) });
  es.onmessage!({ data: ': keep-alive' });
  expect(seen).toHaveLength(2);
  expect(seen[0].block_id).toBe(10);
  expect(seen[1].type).toBe('changed');
  off();
  expect(es.closed).toBe(true);
  delete (globalThis as unknown as { EventSource?: unknown }).EventSource;
});
