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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const toc = await api.getToc(id);
      if (cancelled) return;
      setChapters(toc);
      const first = toc[0]?.id ?? null;
      setActiveChapter(first);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (activeChapter == null) return;
    let cancelled = false;
    void (async () => {
      const b = await api.getBlocks(id, activeChapter);
      if (!cancelled) setBlocks(b);
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
        <BlockList blocks={blocks} />
      </section>
    </div>
  );
}
