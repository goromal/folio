import type { components } from './schema';

export type Book = components['schemas']['BookOut'];
export type Chapter = components['schemas']['ChapterOut'];
export type Block = components['schemas']['BlockOut'];
export type Passage = components['schemas']['PassageOut'];
export interface Highlight { id: number; color: string }
export interface Note { id: number; body: string; created_at: string; updated_at: string }
export interface Tag { id: number; name: string }
// The backend's passage-with-annotations endpoints have no response_model, so
// this shape is authored here to match app.py's assembled dict.
export interface PassageDetail extends Passage {
  highlights: Highlight[];
  notes: Note[];
  tags: Tag[];
}

export interface Link {
  id: number;
  from_passage: number;
  to_passage: number;
  note: string | null;
}

export interface Summary {
  id: number;
  scope: string;
  scope_id: number;
  body: string;
  generated_by: string;
  created_at: string;
}

export interface Position {
  book_id: number;
  chapter_id: number | null;
  block_id: number | null;
  updated_at: string;
}

export interface PassageAnchorInput {
  book_id: number;
  start_block: number;
  start_off: number;
  end_block: number;
  end_off: number;
}

// Same-origin: the SPA is served at /folio and the API at the root of the same
// host:port (browser and Electron alike), so relative paths resolve correctly.
const BASE = '';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function jsonInit(method: string, data: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) };
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
  listPassages: (bookId: number) => req<PassageDetail[]>(`/books/${bookId}/passages`),
  getPassage: (id: number) => req<PassageDetail>(`/passages/${id}`),
  createPassage: (a: PassageAnchorInput) => req<Passage>('/passages', jsonInit('POST', a)),
  addHighlight: (passageId: number, color: string) =>
    req<{ id: number }>(`/passages/${passageId}/highlights`, jsonInit('POST', { color })),
  addNote: (passageId: number, body: string) =>
    req<{ id: number }>('/notes', jsonInit('POST', { passage_id: passageId, body })),
  updateNote: (id: number, body: string) =>
    req<{ id: number }>(`/notes/${id}`, jsonInit('PUT', { body })),
  tagPassage: (passageId: number, name: string) =>
    req<{ tag_id: number }>(`/passages/${passageId}/tags`, jsonInit('POST', { name })),
  deletePassage: (id: number) => req<void>(`/passages/${id}`, { method: 'DELETE' }),
  deleteHighlight: (id: number) => req<void>(`/highlights/${id}`, { method: 'DELETE' }),
  deleteNote: (id: number) => req<void>(`/notes/${id}`, { method: 'DELETE' }),
  untagPassage: (passageId: number, tagId: number) =>
    req<void>(`/passages/${passageId}/tags/${tagId}`, { method: 'DELETE' }),
  getLinks: (passageId: number) => req<Link[]>(`/passages/${passageId}/links`),
  createLink: (fromPassage: number, toPassage: number, note?: string) =>
    req<{ id: number }>(
      `/passages/${fromPassage}/links`,
      jsonInit('POST', { to_passage: toPassage, note: note ?? null }),
    ),
  deleteLink: (id: number) => req<void>(`/links/${id}`, { method: 'DELETE' }),
  listBookSummaries: (bookId: number) => req<Summary[]>(`/books/${bookId}/summaries`),
  createSummary: (scope: 'book' | 'chapter', scopeId: number, body: string) =>
    req<{ id: number }>('/summaries', jsonInit('POST', { scope, scope_id: scopeId, body })),
  deleteSummary: (id: number) => req<void>(`/summaries/${id}`, { method: 'DELETE' }),
  getPosition: (bookId: number) =>
    req<Position | null>(`/books/${bookId}/position`),
  getLastPosition: () => req<Position | null>('/position'),
  savePosition: (bookId: number, body: { chapter_id: number | null; block_id: number | null }) =>
    req<Position>(`/books/${bookId}/position`, jsonInit('PUT', body)),
};

export interface Focus {
  version: number;
  book_id: number;
  chapter_id: number | null;
  block_id: number;
}

export type FolioEvent = ({ type: 'focus' } & Focus) | { type: 'changed' };

/** Subscribe to the folio SSE event stream. Returns an unsubscribe. */
export function subscribeEvents(onEvent: (e: FolioEvent) => void): () => void {
  const es = new EventSource(`${BASE}/view/stream`);
  es.onmessage = (ev) => {
    try {
      onEvent(JSON.parse(ev.data) as FolioEvent);
    } catch {
      /* ignore keep-alive / non-JSON frames */
    }
  };
  return () => es.close();
}
