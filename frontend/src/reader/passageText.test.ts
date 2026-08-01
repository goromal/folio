import { expect, test } from 'vitest';
import { passageText } from './passageText';
import type { Block } from '../api/client';

const blocks: Block[] = [
  { id: 10, chapter_id: 1, order_idx: 0, type: 'para', text: 'The quick brown fox.' },
  { id: 11, chapter_id: 1, order_idx: 1, type: 'para', text: 'Jumps over the dog.' },
];

test('within-block slice', () => {
  expect(passageText(blocks, { start_block: 10, start_off: 4, end_block: 10, end_off: 9 })).toBe('quick');
});

test('cross-block joins tail + head', () => {
  expect(
    passageText(blocks, { start_block: 10, start_off: 16, end_block: 11, end_off: 5 }),
  ).toBe('fox.\nJumps');
});

test('missing block yields empty string', () => {
  expect(passageText(blocks, { start_block: 999, start_off: 0, end_block: 999, end_off: 1 })).toBe('');
});
