import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, type Block, type Chapter } from '../api/client';
import { BlockList } from './BlockList';
import { TocDrawer } from './TocDrawer';
import styles from './ReaderShell.module.css';

export function ReaderShell() {
  const { bookId } = useParams();
  const id = Number(bookId);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeChapter, setActiveChapter] = useState<number | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Reset on book switch so stale chapters/blocks don't linger and effect-2
    // can't fire a mismatched getBlocks(newBook, oldChapter).
    setChapters([]);
    setActiveChapter(null);
    setBlocks([]);
    setError(null);
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
    return () => {
      cancelled = true;
    };
  }, [id]);

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
    return () => {
      cancelled = true;
    };
  }, [id, activeChapter]);

  return (
    <div className={styles.reader}>
      <aside className={styles.toc}>
        <TocDrawer chapters={chapters} activeId={activeChapter} onSelect={setActiveChapter} />
      </aside>
      <section className={styles.content}>
        {error && <p role="alert">{error}</p>}
        <BlockList blocks={blocks} />
      </section>
    </div>
  );
}
