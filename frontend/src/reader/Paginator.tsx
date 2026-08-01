import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { computePageCount, clampPage, translateXFor } from './pagination';
import styles from './Paginator.module.css';

export function Paginator({ children, resetKey }: { children: ReactNode; resetKey: unknown }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);

  const measure = useCallback(() => {
    const vp = viewportRef.current;
    const flow = flowRef.current;
    if (!vp || !flow) return;
    const count = computePageCount(flow.scrollWidth, vp.clientWidth);
    setPageCount(count);
    setPage((p) => clampPage(p, count));
  }, []);

  // Reset to the first page when the content changes (chapter switch).
  useLayoutEffect(() => {
    setPage(0);
    measure();
  }, [resetKey, measure]);

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

  const pageWidth = viewportRef.current?.clientWidth ?? 0;

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
          style={{ transform: `translateX(${translateXFor(page, pageWidth)}px)` }}
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
}
