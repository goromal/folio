import { expect, test } from 'vitest';
import { computePageCount, clampPage, translateXFor, topVisibleBlock } from './pagination';

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

test('topVisibleBlock returns the first block whose left edge is within the viewport', () => {
  // viewport spans screen x [100, 400); the current page's transform has scrolled
  // earlier blocks off to the left (negative x).
  const boxes = [
    { id: 1, left: -300 }, // fully off-screen left (earlier pages)
    { id: 2, left: -40 },  // spans in from the previous page (starts before the view)
    { id: 3, left: 108 },  // first block that STARTS on this page -> top of page
    { id: 4, left: 260 },
  ];
  expect(topVisibleBlock(boxes, 100, 400)).toBe(3);
});

test('topVisibleBlock returns the first block on page 0 (view flush with content)', () => {
  const boxes = [{ id: 7, left: 100 }, { id: 8, left: 250 }];
  expect(topVisibleBlock(boxes, 100, 400)).toBe(7);
});

test('topVisibleBlock returns null when no block starts in view', () => {
  expect(topVisibleBlock([{ id: 1, left: -50 }, { id: 2, left: 500 }], 100, 400)).toBeNull();
});
