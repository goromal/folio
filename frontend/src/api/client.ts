import type { components } from './schema';

export type Book = components['schemas']['BookOut'];
export type Chapter = components['schemas']['ChapterOut'];
export type Block = components['schemas']['BlockOut'];

// Same-origin: the SPA is served at /folio and the API at the root of the same
// host:port (browser and Electron alike), so relative paths resolve correctly.
const BASE = '';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  listBooks: () => req<Book[]>('/books'),
  uploadBook: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return req<Book>('/books', { method: 'POST', body: fd });
  },
  deleteBook: (id: number) => req<void>(`/books/${id}`, { method: 'DELETE' }),
  getToc: (id: number) => req<Chapter[]>(`/books/${id}/toc`),
  getBlocks: (id: number, chapterId?: number) =>
    req<Block[]>(
      `/books/${id}/blocks${chapterId != null ? `?chapter_id=${chapterId}` : ''}`,
    ),
};
