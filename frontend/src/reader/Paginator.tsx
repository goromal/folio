import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect,
  useRef, useState, type ReactNode,
} from 'react';
import { computePageCount, clampPage, translateXFor } from './pagination';
import styles from './Paginator.module.css';

export interface PaginatorHandle {
  goToBlock(blockId: number): void;
}

export const Paginator = forwardRef<PaginatorHandle, { children: ReactNode; resetKey: unknown }>(
  function Paginator({ children, resetKey }, ref) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [stride, setStride] = useState(0);
  const [cols, setCols] = useState(2);

  const measure = useCallback(() => {
    const vp = viewportRef.current;
    const flow = flowRef.current;
    if (!vp || !flow) return;
    // Column count from the MEASURED reading width, not a window media query, so
    // it collapses to one column whenever the flow is narrow (e.g. the TOC is
    // open, or a small screen).
    setCols(vp.clientWidth >= 640 ? 2 : 1);
    // One page advances by the viewport width PLUS the column gap: the k-th
    // multicolumn column starts at k*(colWidth+gap), so a page (1 or 2 columns)
    // advances by clientWidth+gap. Ignoring the gap makes each page drift by one
    // gap and accumulate (bits of three columns after several turns).
    const gap = parseFloat(getComputedStyle(flow).columnGap) || 0;
    const s = vp.clientWidth + gap;
    const count = computePageCount(flow.scrollWidth + gap, s);
    setStride(s);
    setPageCount(count);
    setPage((p) => clampPage(p, count));
  }, []);

  // Reset to the first page when the content changes (chapter switch).
  useLayoutEffect(() => {
    setPage(0);
    measure();
  }, [resetKey, measure]);

  // Re-measure after a column-count change reflows the content (the ResizeObserver
  // watches the viewport, which doesn't resize when only `cols` changes).
  useLayoutEffect(() => {
    measure();
  }, [cols, measure]);

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
          style={{ columnCount: cols, transform: `translateX(${translateXFor(page, stride)}px)` }}
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
