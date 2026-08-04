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

export interface BlockBox {
  id: number;
  /** The block's on-screen left (viewport coordinates): `el.getBoundingClientRect().left`. */
  left: number;
}

/** The id of the first block whose left edge falls within the viewport's x-range
 * `[viewLeft, viewRight)` — i.e. the top-left block of the currently-visible page.
 * Uses live rendered positions rather than `page * stride` arithmetic, so it is immune
 * to the column-gap drift that accumulates across pages. `boxes` must be in document
 * order. Returns null if no block starts in view (e.g. a block wider than the page). */
export function topVisibleBlock(boxes: BlockBox[], viewLeft: number, viewRight: number): number | null {
  for (const b of boxes) {
    if (b.left >= viewLeft - 1 && b.left < viewRight) return b.id;
  }
  return null;
}
