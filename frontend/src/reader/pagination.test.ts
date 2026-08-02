import { expect, test } from 'vitest';
import { computePageCount, clampPage, translateXFor } from './pagination';

test('computePageCount rounds up and is at least 1', () => {
  expect(computePageCount(0, 500)).toBe(1);
  expect(computePageCount(500, 500)).toBe(1);
  expect(computePageCount(501, 500)).toBe(2);
  expect(computePageCount(1500, 500)).toBe(3);
  expect(computePageCount(1000, 0)).toBe(1); // guard divide-by-zero
});

test('clampPage keeps the index in range', () => {
  expect(clampPage(-1, 3)).toBe(0);
  expect(clampPage(5, 3)).toBe(2);
  expect(clampPage(1, 3)).toBe(1);
  expect(clampPage(0, 0)).toBe(0);
});

test('translateXFor shifts left by whole pages', () => {
  expect(translateXFor(0, 500)).toBe(-0);
  expect(translateXFor(2, 500)).toBe(-1000);
});
