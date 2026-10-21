import { expect, test } from 'vitest';
import { authorKey, groupByLetter, sortBooks, titleKey } from './librarySort';
import type { Book } from '../api/client';

const b = (id: number, title: string, author: string | null = null, extra: Partial<Book> = {}): Book =>
  ({ id, title, author, shelf_ids: [], ...extra });

test('titleKey drops leading articles', () => {
  expect(titleKey('The Republic')).toBe('Republic');
  expect(titleKey('A Study in Scarlet')).toBe('Study in Scarlet');
  expect(titleKey('Anathem')).toBe('Anathem');
});

test('authorKey puts the surname first', () => {
  expect(authorKey('Immanuel Kant')).toBe('Kant Immanuel');
  expect(authorKey('Plato')).toBe('Plato');
  expect(authorKey('Kant, Immanuel')).toBe('Kant');
});

test('title sort is numeric-aware and case-insensitive', () => {
  const out = sortBooks([b(1, 'book 10'), b(2, 'Book 2'), b(3, 'apple')], 'title').map((x) => x.id);
  expect(out).toEqual([3, 2, 1]);
});

test('author sort sinks authorless books', () => {
  const out = sortBooks([b(1, 'X'), b(2, 'Y', 'Zed Zulu'), b(3, 'Z', 'Amy Adams')], 'author').map((x) => x.id);
  expect(out).toEqual([3, 2, 1]);
});

test('recent sort: read books first by time, then unread newest-added', () => {
  const out = sortBooks([
    b(1, 'a', null, { created_at: '2026-01', last_read_at: null }),
    b(2, 'b', null, { created_at: '2026-02', last_read_at: null }),
    b(3, 'c', null, { created_at: '2025-01', last_read_at: '2026-05' }),
  ], 'recent').map((x) => x.id);
  expect(out).toEqual([3, 2, 1]);
});

test('groupByLetter buckets non-letters under #', () => {
  const groups = groupByLetter(sortBooks([b(1, '1984'), b(2, 'Emma'), b(3, 'Éclair')], 'title'), 'title');
  expect(groups.map((g) => [g.letter, g.books.length])).toEqual([['#', 1], ['E', 2]]);
});
