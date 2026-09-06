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

/** Adapt an array of boxes to topVisibleBlock's lazy accessors, counting position reads. */
function fromBoxes(boxes: { id: number; left: number }[]) {
  const reads = { count: 0 };
  const call = (viewLeft: number, viewRight: number) =>
    topVisibleBlock(
      boxes.length,
      (i) => { reads.count++; return boxes[i].left; },
      (i) => boxes[i].id,
      viewLeft,
      viewRight,
    );
  return { call, reads };
}

test('topVisibleBlock returns the first block whose left edge is within the viewport', () => {
  // viewport spans screen x [100, 400); the current page's transform has scrolled
  // earlier blocks off to the left (negative x).
  const boxes = [
    { id: 1, left: -300 }, // fully off-screen left (earlier pages)
    { id: 2, left: -40 },  // spans in from the previous page (starts before the view)
    { id: 3, left: 108 },  // first block that STARTS on this page -> top of page
    { id: 4, left: 260 },
  ];
  expect(fromBoxes(boxes).call(100, 400)).toBe(3);
});

test('topVisibleBlock returns the first block on page 0 (view flush with content)', () => {
  const boxes = [{ id: 7, left: 100 }, { id: 8, left: 250 }];
  expect(fromBoxes(boxes).call(100, 400)).toBe(7);
});

test('topVisibleBlock returns null when no block starts in view', () => {
  expect(fromBoxes([{ id: 1, left: -50 }, { id: 2, left: 500 }]).call(100, 400)).toBeNull();
});

test('topVisibleBlock returns the topmost of several blocks sharing a column', () => {
  // Blocks stacked in one column all report the same left edge; the first in
  // document order is the top of the page.
  const boxes = [
    { id: 1, left: -300 },
    { id: 2, left: 108 }, { id: 3, left: 108 }, { id: 4, left: 108 },
  ];
  expect(fromBoxes(boxes).call(100, 400)).toBe(2);
});

test('topVisibleBlock costs a handful of reads, not one per block', () => {
  // A 1911-block chapter — the largest in the library — laid out across columns.
  const boxes = Array.from({ length: 1911 }, (_, i) => ({ id: i + 1, left: i * 10 - 9000 }));
  const { call, reads } = fromBoxes(boxes);
  expect(call(100, 400)).toBe(911);
  // log2(1911) is ~11; a scan would have read all 1911.
  expect(reads.count).toBeLessThan(20);
});

test('topVisibleBlock handles an empty chapter', () => {
  expect(fromBoxes([]).call(100, 400)).toBeNull();
});
