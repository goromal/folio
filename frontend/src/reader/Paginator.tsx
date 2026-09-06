import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect,
  useRef, useState, type ReactNode, type TouchEvent as ReactTouchEvent,
} from 'react';
import { computePageCount, clampPage, translateXFor, topVisibleBlock } from './pagination';
import { swipePageDelta, swipeThreshold } from './swipe';
import styles from './Paginator.module.css';

export interface PaginatorHandle {
  goToBlock(blockId: number): void;
}

export const Paginator = forwardRef<
  PaginatorHandle,
  {
    children: ReactNode;
    resetKey: unknown;
    onPageBlock?: (blockId: number | null) => void;
    /** Reader text size (px). Passed in rather than read from ThemeProvider so the
     * Paginator stays context-free; a change re-paginates. */
    fontSize?: number;
  }
>(function Paginator({ children, resetKey, onPageBlock, fontSize }, ref) {
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

  /** The block at the top of the currently-visible page, or null with no layout. */
  const currentTopBlock = useCallback((): number | null => {
    const flow = flowRef.current;
    const vp = viewportRef.current;
    if (!flow || !vp || stride <= 0) return null; // jsdom / no layout
    // Use live on-screen positions vs. the viewport, not page*stride arithmetic: the
    // column gap drifts across pages, so the first block whose left edge is inside the
    // viewport is the drift-proof top-of-page block. (`page` stays in deps so this
    // re-runs after a page turn moves the transform.)
    const vpRect = vp.getBoundingClientRect();
    // Hand the elements over lazily: topVisibleBlock binary-searches them, so only a
    // dozen or so rects get measured instead of one per block in the chapter.
    const els = flow.querySelectorAll('[data-block-id]') as NodeListOf<HTMLElement>;
    return topVisibleBlock(
      els.length,
      (i) => els[i].getBoundingClientRect().left,
      (i) => Number(els[i].getAttribute('data-block-id')),
      vpRect.left,
      vpRect.right,
    );
  }, [page, stride]);

  const reportPageBlock = useCallback(() => {
    if (!onPageBlock) return;
    onPageBlock(currentTopBlock());
  }, [onPageBlock, currentTopBlock]);

  // Report the page's top block ONLY after a user-initiated page turn, never after a
  // programmatic page change (chapter reset, re-measure, or a restore goToBlock). This
  // is what keeps a restore from clobbering the saved position: the restore jump moves
  // `page` but must not trigger a save.
  const userNavRef = useRef(false);
  useEffect(() => {
    if (!userNavRef.current) return;
    userNavRef.current = false;
    reportPageBlock();
  }, [page, reportPageBlock]);

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
    (delta: number) => {
      userNavRef.current = true; // mark this page change as user-initiated -> report it
      setPage((p) => clampPage(p + delta, pageCount));
    },
    [pageCount],
  );

  // Touch paging. The turn fires from touchmove, the moment the finger crosses the
  // threshold — NOT from touchend. Waiting for the lift makes the reader feel laggy:
  // perceived latency becomes the whole gesture plus the transform transition, and
  // nothing on screen acknowledges the swipe until the finger is already gone.
  // Multi-touch (pinch-zoom) is ignored outright. `consumed` keeps one gesture to one
  // page turn, so the rest of the drag is inert rather than paging repeatedly.
  const gesture = useRef<{ x: number; y: number; t: number; consumed: boolean } | null>(null);

  const onTouchStart = useCallback((e: ReactTouchEvent<HTMLDivElement>) => {
    const t = e.touches.length === 1 ? e.touches[0] : null;
    gesture.current = t ? { x: t.clientX, y: t.clientY, t: Date.now(), consumed: false } : null;
  }, []);

  const onTouchMove = useCallback(
    (e: ReactTouchEvent<HTMLDivElement>) => {
      const g = gesture.current;
      const t = e.touches[0];
      if (!g || g.consumed || !t) return;
      // A live selection means the finger is dragging a text selection (to highlight or
      // annotate), not turning a page. Selection always wins — drop the gesture entirely
      // so a later part of the same drag can't page either.
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) { gesture.current = null; return; }
      const delta = swipePageDelta(
        { dx: t.clientX - g.x, dy: t.clientY - g.y, dt: Date.now() - g.t },
        { minDistance: swipeThreshold(viewportRef.current?.clientWidth ?? 0) },
      );
      if (delta === 0) return;
      g.consumed = true;
      go(delta);
    },
    [go],
  );

  const onTouchEnd = useCallback((e: ReactTouchEvent<HTMLDivElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g?.consumed) return;
    // Suppress the synthesized click that would otherwise land wherever the finger
    // lifted — on a painted highlight that would pop the passage panel open mid-swipe.
    // (React leaves touchend non-passive, so preventDefault still applies here; it does
    // NOT on touchmove, which is why the turn above can't rely on preventing anything.)
    e.preventDefault();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  const goToBlock = useCallback(
    (blockId: number) => {
      const flow = flowRef.current;
      const vp = viewportRef.current;
      if (!flow || !vp) return;
      const el = flow.querySelector(`[data-block-id="${blockId}"]`) as HTMLElement | null;
      const gap = parseFloat(getComputedStyle(flow).columnGap) || 0;
      const s = vp.clientWidth + gap;
      // x within untranslated content = element x in the translated flow plus
      // the current translate (page*stride).
      if (!el) return;
      if (s <= 0) return; // no layout (jsdom) -> no-op
      const x = el.getBoundingClientRect().left - flow.getBoundingClientRect().left + page * stride;
      // Count pages from live layout, not the (possibly stale) pageCount state: on a
      // fresh chapter+restore the measure() that sets pageCount may not have committed
      // yet, and clamping the target against a stale count of 1 would pin us to page 0.
      const count = computePageCount(flow.scrollWidth + gap, s);
      setPage(clampPage(Math.floor(x / s), count));
    },
    [page, stride],
  );

  useImperativeHandle(ref, () => ({ goToBlock }), [goToBlock]);

  // Re-paginate when the reader's text size changes. Nothing else notices: the
  // ResizeObserver watches the viewport, whose box is unchanged by a font-size change,
  // and the column width is derived from that same width — so without this the reflow
  // silently invalidates pageCount (the total stops matching the content).
  // Hold the reader's place by BLOCK, not by page index: the reflow moves text between
  // pages, so the old index points somewhere arbitrary in the resized text.
  useEffect(() => {
    if (fontSize == null) return;
    const anchor = currentTopBlock();
    // One frame's delay is required, not defensive: ThemeProvider writes --reader-fs in
    // its own passive effect, and a parent's effect runs AFTER its children's, so
    // measuring synchronously here would read the pre-resize layout.
    const raf = requestAnimationFrame(() => {
      measure();
      if (anchor != null) goToBlock(anchor);
    });
    return () => cancelAnimationFrame(raf);
    // Deliberately keyed on fontSize alone: this must run when the text resizes, not
    // every time a page turn gives goToBlock/currentTopBlock a new identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontSize]);

  return (
    <div className={styles.pager}>
      <button className={styles.zone} aria-label="Previous page" onClick={() => go(-1)}>
        ‹
      </button>
      <div
        className={styles.viewport}
        ref={viewportRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={() => { gesture.current = null; }}
      >
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
