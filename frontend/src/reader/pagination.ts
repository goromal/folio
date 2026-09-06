export function computePageCount(scrollWidth: number, pageWidth: number): number {
  if (pageWidth <= 0) return 1;
  return Math.max(1, Math.ceil(scrollWidth / pageWidth));
}

export function clampPage(page: number, pageCount: number): number {
  return Math.min(Math.max(0, page), Math.max(0, pageCount - 1));
}

export function translateXFor(page: number, pageWidth: number): number {
  return -page * pageWidth;
}

/** The id of the first block whose left edge falls within the viewport's x-range
 * `[viewLeft, viewRight)` — i.e. the top-left block of the currently-visible page.
 * Uses live rendered positions rather than `page * stride` arithmetic, so it is immune
 * to the column-gap drift that accumulates across pages. Blocks are addressed by index
 * in document order; returns null if no block starts in view.
 *
 * Positions are read lazily through `leftAt` and located by BINARY SEARCH rather than
 * scanned, because every read is a `getBoundingClientRect()` against a multi-column
 * layout and chapters here reach ~1900 blocks. Reading all of them on every page turn
 * blocked the main thread long enough to stall the next swipe. This needs `left` to be
 * non-decreasing in document order, which multi-column layout gives us: blocks fill a
 * column top-to-bottom before moving right, and nothing spans columns. */
export function topVisibleBlock(
  count: number,
  leftAt: (index: number) => number,
  idAt: (index: number) => number,
  viewLeft: number,
  viewRight: number,
): number | null {
  // Lower bound: the first block whose left edge reaches the viewport's left.
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (leftAt(mid) >= viewLeft - 1) hi = mid;
    else lo = mid + 1;
  }
  if (lo >= count) return null;
  // Left is non-decreasing, so if the first candidate already sits past the right
  // edge, every later block does too and nothing starts on this page.
  if (leftAt(lo) >= viewRight) return null;
  return idAt(lo);
}
