import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, subscribeFocus, type Block, type Chapter, type Focus, type PassageDetail } from '../api/client';
import { BlockList } from './BlockList';
import { TocDrawer } from './TocDrawer';
import { Paginator, type PaginatorHandle } from './Paginator';
import { SelectionToolbar } from './SelectionToolbar';
import { PassagePanel } from './PassagePanel';
import { useSelectionAnchor } from './useSelectionAnchor';
import { paintHighlights } from './highlights';
import { anchorToRange, type PassageAnchor } from './anchors';
import type { HighlightColor } from './highlights';
import styles from './ReaderShell.module.css';

export function ReaderShell() {
  const { bookId } = useParams();
  const id = Number(bookId);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeChapter, setActiveChapter] = useState<number | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [passages, setPassages] = useState<PassageDetail[]>([]);
  const [openPassage, setOpenPassage] = useState<PassageDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tocOpen, setTocOpen] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= 800,
  );

  const flowRef = useRef<HTMLDivElement>(null);
  const selection = useSelectionAnchor(flowRef);

  const navigate = useNavigate();
  const paginatorRef = useRef<PaginatorHandle>(null);
  const [pendingFocus, setPendingFocus] = useState<Focus | null>(null);
  const [flashBlock, setFlashBlock] = useState<number | null>(null);

  // Subscribe to agent view-follow. A focus for another book navigates there
  // (the new mount re-subscribes and receives the current focus on connect).
  useEffect(() => {
    const off = subscribeFocus((f) => {
      if (f.book_id !== id) {
        navigate(`/book/${f.book_id}`);
        return;
      }
      if (f.chapter_id != null) setActiveChapter(f.chapter_id);
      setPendingFocus(f);
    });
    return off;
  }, [id, navigate]);

  // Once the pending focus's chapter blocks are on screen, turn to the block.
  useEffect(() => {
    if (!pendingFocus || blocks.length === 0) return;
    const target = pendingFocus.block_id;
    const raf = requestAnimationFrame(() => {
      paginatorRef.current?.goToBlock(target);
      setFlashBlock(target);
    });
    setPendingFocus(null);
    return () => cancelAnimationFrame(raf);
  }, [pendingFocus, blocks]);

  // Clear the flash after a moment.
  useEffect(() => {
    if (flashBlock == null) return;
    const t = setTimeout(() => setFlashBlock(null), 1200);
    return () => clearTimeout(t);
  }, [flashBlock]);

  const refreshPassages = useCallback(async () => {
    try {
      setPassages(await api.listPassages(id));
    } catch (e) {
      setError(String(e));
    }
  }, [id]);

  // Load TOC (reset on book switch).
  useEffect(() => {
    let cancelled = false;
    setChapters([]); setActiveChapter(null); setBlocks([]); setError(null);
    void (async () => {
      try {
        const toc = await api.getToc(id);
        if (cancelled) return;
        setChapters(toc);
        setActiveChapter(toc[0]?.id ?? null);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Load chapter blocks.
  useEffect(() => {
    if (activeChapter == null) return;
    let cancelled = false;
    void (async () => {
      try {
        const b = await api.getBlocks(id, activeChapter);
        if (!cancelled) setBlocks(b);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [id, activeChapter]);

  useEffect(() => { void refreshPassages(); }, [refreshPassages]);

  // Repaint whenever the rendered blocks or the passage set changes.
  useEffect(() => {
    if (flowRef.current) paintHighlights(flowRef.current, passages);
  }, [passages, blocks]);

  async function createPassageFrom(anchor: PassageAnchor): Promise<number> {
    const p = await api.createPassage({ book_id: id, ...anchor });
    return p.id;
  }

  async function highlight(color: HighlightColor) {
    if (!selection) return;
    try {
      const pid = await createPassageFrom(selection.anchor);
      await api.addHighlight(pid, color);
      window.getSelection()?.removeAllRanges();
      await refreshPassages();
    } catch (e) { setError(String(e)); }
  }

  async function quickCreateAndOpen(anchor: PassageAnchor) {
    const pid = await createPassageFrom(anchor);
    await api.addHighlight(pid, 'yellow');
    await refreshPassages();
    window.getSelection()?.removeAllRanges();
    setOpenPassage(await api.getPassage(pid));
  }

  // Open the panel for the passage under a click on a painted highlight.
  // Typed to just the fields used, so no React namespace import is needed.
  function onFlowClick(e: { clientX: number; clientY: number }) {
    const cr = (document as unknown as {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    }).caretRangeFromPoint?.(e.clientX, e.clientY);
    if (!cr || !flowRef.current) return;
    for (const p of passages) {
      const r = anchorToRange(flowRef.current, p);
      if (r && r.isPointInRange(cr.startContainer, cr.startOffset)) {
        void api.getPassage(p.id).then(setOpenPassage);
        return;
      }
    }
  }

  return (
    <div className={styles.reader} data-toc={tocOpen ? 'open' : 'closed'}>
      {tocOpen && (
        <aside className={styles.toc}>
          <TocDrawer chapters={chapters} activeId={activeChapter} onSelect={setActiveChapter} />
        </aside>
      )}
      <section className={styles.content}>
        <div className={styles.contentBar}>
          <button
            type="button"
            className={styles.tocToggle}
            aria-label={tocOpen ? 'Hide contents' : 'Show contents'}
            aria-expanded={tocOpen}
            onClick={() => setTocOpen((o) => !o)}
          >
            ☰
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
        <div ref={flowRef} onClick={onFlowClick} style={{ height: '70vh' }}>
          <Paginator ref={paginatorRef} resetKey={activeChapter}>
            <BlockList blocks={blocks} flashBlockId={flashBlock} />
          </Paginator>
        </div>
      </section>

      {selection && (
        <SelectionToolbar
          rect={selection.rect}
          onHighlight={highlight}
          onNote={() => void quickCreateAndOpen(selection.anchor)}
          onTag={() => void quickCreateAndOpen(selection.anchor)}
        />
      )}

      {openPassage && (
        <PassagePanel
          passage={openPassage}
          onAddNote={async (body) => {
            await api.addNote(openPassage.id, body);
            const p = await api.getPassage(openPassage.id);
            setOpenPassage(p); await refreshPassages();
          }}
          onAddTag={async (name) => {
            await api.tagPassage(openPassage.id, name);
            setOpenPassage(await api.getPassage(openPassage.id)); await refreshPassages();
          }}
          onRemoveTag={async (tagId) => {
            await api.untagPassage(openPassage.id, tagId);
            setOpenPassage(await api.getPassage(openPassage.id)); await refreshPassages();
          }}
          onDelete={async () => {
            await api.deletePassage(openPassage.id);
            setOpenPassage(null); await refreshPassages();
          }}
          onClose={() => setOpenPassage(null)}
        />
      )}
    </div>
  );
}
