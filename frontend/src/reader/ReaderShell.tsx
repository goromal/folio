import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, subscribeEvents, type Block, type Chapter, type Focus, type Link, type PassageDetail } from '../api/client';
import { BlockList } from './BlockList';
import { TocDrawer } from './TocDrawer';
import { Paginator, type PaginatorHandle } from './Paginator';
import { SelectionToolbar } from './SelectionToolbar';
import { PassagePanel } from './PassagePanel';
import { useSelectionAnchor } from './useSelectionAnchor';
import { paintHighlights } from './highlights';
import { anchorToRange, type PassageAnchor } from './anchors';
import { passageText } from './passageText';
import type { HighlightColor } from './highlights';
import styles from './ReaderShell.module.css';

export function ReaderShell() {
  const { bookId } = useParams();
  const id = Number(bookId);
  const [searchParams] = useSearchParams();
  const focusBlockParam = searchParams.get('focus');
  const focusChapterParam = searchParams.get('ch');
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeChapter, setActiveChapter] = useState<number | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [passages, setPassages] = useState<PassageDetail[]>([]);
  const [openPassage, setOpenPassage] = useState<PassageDetail | null>(null);
  const [openLinks, setOpenLinks] = useState<Link[]>([]);
  const [allBlocks, setAllBlocks] = useState<Block[]>([]);
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

  // Persisted reading position: restore on open, save (debounced) on move.
  const restoredRef = useRef(false);            // suppress saves until restore applied
  const userChapterNav = useRef(false);         // a TOC-selected chapter saves; a restore/agent jump does not
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  const savePosition = useCallback((blockId: number | null) => {
    if (blockId == null || !restoredRef.current) return; // no block, or restore not yet applied
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void api.savePosition(id, { chapter_id: activeChapter, block_id: blockId }).catch(() => {});
    }, 500);
  }, [id, activeChapter]);

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  // Live events: focus drives view-follow; 'changed' re-fetches passages so agent
  // (MCP) edits show up without a manual refresh (debounced to coalesce bursts).
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = subscribeEvents((e) => {
      if (e.type === 'focus') {
        if (e.book_id !== id) {
          navigate(`/book/${e.book_id}`);
          return;
        }
        if (e.chapter_id != null) setActiveChapter(e.chapter_id);
        setPendingFocus(e);
      } else if (e.type === 'changed') {
        clearTimeout(t);
        t = setTimeout(() => {
          void api.listPassages(id).then(setPassages).catch((err) => setError(String(err)));
        }, 300);
      }
    });
    return () => {
      clearTimeout(t);
      off();
    };
  }, [id, navigate]);

  // Deep link: /book/:id?focus=<block>&ch=<chapter> jumps to a passage.
  useEffect(() => {
    if (!focusBlockParam) return;
    setPendingFocus({
      version: 0, book_id: id,
      chapter_id: focusChapterParam ? Number(focusChapterParam) : null,
      block_id: Number(focusBlockParam),
    });
  }, [id, focusBlockParam, focusChapterParam]);

  // Once the pending focus's chapter blocks are on screen, turn to the block.
  // A layout effect (not an rAF) so the jump is applied synchronously after the child
  // Paginator has measured — the previous rAF was canceled by this effect's own cleanup
  // when setPendingFocus(null) re-ran it, so goToBlock never fired. The save gate opens
  // only AFTER the jump lands, so the initial page-0 report can't clobber the position.
  useLayoutEffect(() => {
    if (pendingFocus) {
      if (blocks.length === 0) return; // wait for the chapter's blocks before jumping
      const target = pendingFocus.block_id;
      paginatorRef.current?.goToBlock(target);
      setFlashBlock(target);
      setPendingFocus(null);
    }
    // Open the save gate even when the chapter has no blocks (e.g. a titlepage): otherwise
    // a book whose first chapter is empty never opens the gate and NOTHING ever saves.
    restoredRef.current = true;
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

  // Load TOC (reset on book switch), then apply the initial position:
  // ?focus deep-link > saved position > first chapter.
  useEffect(() => {
    let cancelled = false;
    setChapters([]); setActiveChapter(null); setBlocks([]); setError(null);
    restoredRef.current = false;
    void (async () => {
      try {
        const [toc, saved] = await Promise.all([
          api.getToc(id),
          focusBlockParam ? Promise.resolve(null) : api.getPosition(id).catch(() => null),
        ]);
        if (cancelled) return;
        setChapters(toc);
        if (focusBlockParam) {
          setActiveChapter(focusChapterParam ? Number(focusChapterParam) : (toc[0]?.id ?? null));
        } else if (saved && saved.chapter_id != null) {
          setActiveChapter(saved.chapter_id);
          if (saved.block_id != null) {
            setPendingFocus({
              version: 0, book_id: id, chapter_id: saved.chapter_id, block_id: saved.block_id,
            });
          }
        } else {
          setActiveChapter(toc[0]?.id ?? null);
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [id, focusBlockParam, focusChapterParam]);

  // Load chapter blocks.
  useEffect(() => {
    if (activeChapter == null) return;
    let cancelled = false;
    void (async () => {
      try {
        const b = await api.getBlocks(id, activeChapter);
        if (cancelled) return;
        setBlocks(b);
        // A user-selected chapter saves its first block, so books read by chapter
        // navigation (or with single-page chapters that can't be paged) still persist a
        // position. Restore/agent jumps set pendingFocus instead and don't flag this.
        if (userChapterNav.current) {
          userChapterNav.current = false;
          if (restoredRef.current && b[0]) savePosition(b[0].id);
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [id, activeChapter]);

  // All blocks (whole book) — resolves link/passage preview text across chapters
  // (the paginator's `blocks` only holds the active chapter).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const b = await api.getBlocks(id);
        if (!cancelled) setAllBlocks(b);
      } catch {
        /* previews just fall back to "passage N" */
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

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

  async function openPassageById(pid: number) {
    const [detail, links] = await Promise.all([api.getPassage(pid), api.getLinks(pid)]);
    setOpenLinks(links);
    setOpenPassage(detail);
  }

  async function quickCreateAndOpen(anchor: PassageAnchor) {
    const pid = await createPassageFrom(anchor);
    await api.addHighlight(pid, 'yellow');
    await refreshPassages();
    window.getSelection()?.removeAllRanges();
    await openPassageById(pid);
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
        void openPassageById(p.id);
        return;
      }
    }
  }

  const linkTargets = openPassage
    ? passages
        .filter((p) => p.id !== openPassage.id)
        .map((p) => ({ id: p.id, preview: passageText(allBlocks, p).slice(0, 80) || `passage ${p.id}` }))
    : [];

  return (
    <div className={styles.reader} data-toc={tocOpen ? 'open' : 'closed'}>
      {tocOpen && (
        <aside className={styles.toc}>
          <TocDrawer
            chapters={chapters}
            activeId={activeChapter}
            onSelect={(cid) => { userChapterNav.current = true; setActiveChapter(cid); }}
          />
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
          <RouterLink to={`/book/${id}/notes`} className={styles.notesLink}>
            Notes
          </RouterLink>
        </div>
        {error && <p role="alert">{error}</p>}
        <div ref={flowRef} onClick={onFlowClick} style={{ height: '70vh' }}>
          <Paginator ref={paginatorRef} resetKey={activeChapter} onPageBlock={savePosition}>
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
          links={openLinks}
          linkTargets={linkTargets}
          onCreateLink={async (toId) => {
            await api.createLink(openPassage.id, toId);
            setOpenLinks(await api.getLinks(openPassage.id));
          }}
          onRemoveLink={async (linkId) => {
            await api.deleteLink(linkId);
            setOpenLinks(await api.getLinks(openPassage.id));
          }}
          onAddNote={async (body) => {
            await api.addNote(openPassage.id, body);
            const p = await api.getPassage(openPassage.id);
            setOpenPassage(p); await refreshPassages();
          }}
          onEditNote={async (noteId, body) => {
            await api.updateNote(noteId, body);
            setOpenPassage(await api.getPassage(openPassage.id)); await refreshPassages();
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
