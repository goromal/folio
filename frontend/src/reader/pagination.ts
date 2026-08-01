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
