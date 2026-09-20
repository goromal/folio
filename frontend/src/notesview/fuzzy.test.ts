import { expect, test } from 'vitest';
import { fuzzyMatch } from './fuzzy';

test('empty query matches anything', () => expect(fuzzyMatch('', 'abc')).toBe(true));
test('subsequence matches', () => expect(fuzzyMatch('brwn', 'the quick brown fox')).toBe(true));
test('out-of-order does not match', () => expect(fuzzyMatch('nworb', 'brown')).toBe(false));
test('missing chars do not match', () => expect(fuzzyMatch('xyz', 'abc')).toBe(false));
test('case-insensitive', () => expect(fuzzyMatch('FOX', 'the fox')).toBe(true));
