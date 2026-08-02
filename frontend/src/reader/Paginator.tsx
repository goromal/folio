import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect,
  useRef, useState, type ReactNode,
} from 'react';
import { computePageCount, clampPage, translateXFor } from './pagination';
import styles from './Paginator.module.css';

export interface PaginatorHandle {
  goToBlock(blockId: number): void;
}

export const Paginator = forwardRef<
  PaginatorHandle,
  { children: ReactNode; resetKey: unknown; onPageBlock?: (blockId: number | null) => void }
>(function Paginator({ children, resetKey, onPageBlock }, ref) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [stride, setStride] = useState(0);
  const [colWidth, setColWidth] = useState(0);

  const measure = useCallback(() => {
    const vp = viewportRef.current;
    const flow = flowRef.current;
    if (!vp || !flow) return;
    const gap = parseFloat(getComputedStyle(flow).columnGap) || 0;
    // Drive columns by WIDTH, not column-count: the browser then makes as many
    // fixed-width columns as the content needs (overflow columns = pages). With
    // column-count:1 a single column just overflows vertically -> one page (the
    // mobile bug). Fit `nCols` columns per viewport (2 when wide, else 1), sized
    // from the MEASURED width so it collapses to one column when the flow is
    // narrow (small screen or TOC open).
    const nCols = vp.clientWidth >= 640 ? 2 : 1;
    setColWidth((vp.clientWidth - (nCols - 1) * gap) / nCols);
    // One page advances by the viewport width PLUS the column gap (columns are
    // pitched at colWidth+gap); ignoring the gap accumulates drift across pages.
    const s = vp.clientWidth + gap;
    const count = computePageCount(flow.scrollWidth + gap, s);
    setStride(s);
    setPageCount(count);
    setPage((p) => clampPage(p, count));
  }, []);

  const reportPageBlock = useCallback(() => {
    if (!onPageBlock) return;
    const flow = flowRef.current;
    if (!flow || stride <= 0) { onPageBlock(null); return; } // jsdom / no layout
    const left = page * stride; // untranslated x of the current page's left edge
    const flowLeft = flow.getBoundingClientRect().left;
    let best: number | null = null;
    for (const el of Array.from(flow.querySelectorAll('[data-block-id]')) as HTMLElement[]) {
      const r = el.getBoundingClientRect();
      const x = r.left - flowLeft + page * stride; // block's untranslated left x
      if (x + r.width > left) { // first block whose extent reaches this page
        const id = Number(el.getAttribute('data-block-id'));
        best = Number.isNaN(id) ? null : id;
        break;
      }
    }
    onPageBlock(best);
  }, [onPageBlock, page, stride]);

  useEffect(() => {
    reportPageBlock();
  }, [reportPageBlock, pageCount]);

  // Reset to the first page when the content changes (chapter switch).
  useLayoutEffect(() => {
    setPage(0);
    measure();
  }, [resetKey, measure]);

  // Re-measure after a column-width change reflows the content (the ResizeObserver
  // watches the viewport, which doesn't resize when only the column width changes).
  useLayoutEffect(() => {
    measure();
  }, [colWidth, measure]);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const ro = new ResizeObserver(measure);
    ro.observe(vp);
    return () => ro.disconnect();
  }, [measure]);

  const go = useCallback(
    (delta: number) => setPage((p) => clampPage(p + delta, pageCount)),
    [pageCount],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  useImperativeHandle(
    ref,
    () => ({
      goToBlock(blockId: number) {
        const flow = flowRef.current;
        const vp = viewportRef.current;
        if (!flow || !vp) return;
        const el = flow.querySelector(`[data-block-id="${blockId}"]`) as HTMLElement | null;
        if (!el) return;
        const gap = parseFloat(getComputedStyle(flow).columnGap) || 0;
        const s = vp.clientWidth + gap;
        if (s <= 0) return; // no layout (jsdom) -> no-op
        // x within untranslated content = element x in the translated flow plus
        // the current translate (page*stride).
        const x = el.getBoundingClientRect().left - flow.getBoundingClientRect().left + page * stride;
        setPage(clampPage(Math.floor(x / s), pageCount));
      },
    }),
    [page, stride, pageCount],
  );

  return (
    <div className={styles.pager}>
      <button className={styles.zone} aria-label="Previous page" onClick={() => go(-1)}>
        ‹
      </button>
      <div className={styles.viewport} ref={viewportRef}>
        <div
          className={styles.flow}
          data-folio-flow=""
          ref={flowRef}
          style={{
            columnWidth: colWidth > 0 ? `${colWidth}px` : undefined,
            transform: `translateX(${translateXFor(page, stride)}px)`,
          }}
        >
          {children}
        </div>
      </div>
      <button className={styles.zone} aria-label="Next page" onClick={() => go(1)}>
        ›
      </button>
      <span className={styles.count} aria-hidden="true">
        {page + 1} / {pageCount}
      </span>
    </div>
  );
});
