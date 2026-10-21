import { expect, test } from 'vitest';
import { fuzzyFilter, fuzzyScore } from './fuzzy';

const books = ['Genesis', 'Exodus', 'Job', 'John', 'Jonah', '1 Nephi', '2 Nephi'];
const bible = books.flatMap((b) => Array.from({ length: 40 }, (_, i) => `${b} ${i + 1}`));
const search = (q: string) => fuzzyFilter(bible, q, (t) => t);

test('an exact chapter number outranks numeric prefixes', () => {
  expect(search('gen 3').slice(0, 3)).toEqual(['Genesis 3', 'Genesis 30', 'Genesis 31']);
});

test('numbered book names', () => {
  expect(search('1 ne 3')[0]).toBe('1 Nephi 3');
  expect(search('2 nephi')[0]).toBe('2 Nephi 1');
});

test('subsequence fallback keeps reading order among equals', () => {
  expect(search('jhn 3')[0]).toBe('John 3');
});

test('word prefix beats substring beats subsequence', () => {
  expect(fuzzyScore('gen', 'Genesis')).toBeGreaterThan(fuzzyScore('nes', 'Genesis'));
  expect(fuzzyScore('nes', 'Genesis')).toBeGreaterThan(fuzzyScore('gns', 'Genesis'));
});

test('every token must match; case and accents are ignored', () => {
  expect(fuzzyScore('gen zzz', 'Genesis 1')).toBe(0);
  expect(fuzzyScore('CAFE', 'Café Society')).toBeGreaterThan(0);
});

test('empty query returns everything untouched', () => {
  expect(search('  ')).toBe(bible);
});
