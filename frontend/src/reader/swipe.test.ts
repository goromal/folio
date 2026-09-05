import { expect, test } from 'vitest';
import { swipePageDelta, swipeThreshold } from './swipe';

const limits = { minDistance: 40 };

test('a leftward swipe advances a page, a rightward swipe goes back', () => {
  expect(swipePageDelta({ dx: -80, dy: 5, dt: 200 }, limits)).toBe(1);
  expect(swipePageDelta({ dx: 80, dy: 5, dt: 200 }, limits)).toBe(-1);
});

test('short travel is a tap, not a swipe', () => {
  expect(swipePageDelta({ dx: -20, dy: 0, dt: 100 }, limits)).toBe(0);
});

test('a mostly-vertical drag never turns a page', () => {
  expect(swipePageDelta({ dx: -60, dy: 120, dt: 200 }, limits)).toBe(0);
});

test('a slow drag (text selection) is not a swipe', () => {
  expect(swipePageDelta({ dx: -200, dy: 0, dt: 1500 }, limits)).toBe(0);
});

test('threshold scales with width and stays within bounds', () => {
  expect(swipeThreshold(400)).toBe(60); // mid-range: 15% of the width
  expect(swipeThreshold(100)).toBe(40); // narrow viewport -> floor
  expect(swipeThreshold(2000)).toBe(80); // wide viewport -> ceiling
  expect(swipeThreshold(0)).toBe(40); // unmeasured (jsdom)
});
