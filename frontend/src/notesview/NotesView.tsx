import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import {
  api,
  type Block,
  type Chapter,
  type Link,
  type PassageDetail,
  type Summary,
} from '../api/client';
import { passageText } from '../reader/passageText';
import styles from './NotesView.module.css';

export function NotesView() {
  const { bookId } = useParams();
  const id = Number(bookId);
  const navigate = useNavigate();

  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [passages, setPassages] = useState<PassageDetail[]>([]);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [linksBy, setLinksBy] = useState<Record<number, Link[]>>({});
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [toc, ps, sums, blks] = await Promise.all([
        api.getToc(id),
        api.listPassages(id),
        api.listBookSummaries(id),
        api.getBlocks(id),
      ]);
      setChapters(toc);
      setPassages(ps);
      setSummaries(sums);
      setBlocks(blks);
      const linkLists = await Promise.all(ps.map((p) => api.getLinks(p.id)));
      const map: Record<number, Link[]> = {};
      ps.forEach((p, i) => (map[p.id] = linkLists[i]));
      setLinksBy(map);
    } catch (e) {
      setError(String(e));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const chapterOf = useCallback(
    (blockId: number) => blocks.find((b) => b.id === blockId)?.chapter_id ?? null,
    [blocks],
  );
  const preview = useCallback(
    (p: PassageDetail) => passageText(blocks, p).slice(0, 100) || `passage ${p.id}`,
    [blocks],
  );

  const allTags = useMemo(() => {
    const s = new Set<string>();
    passages.forEach((p) => p.tags.forEach((t) => s.add(t.name)));
    return [...s].sort();
  }, [passages]);

  const shown = tagFilter
    ? passages.filter((p) => p.tags.some((t) => t.name === tagFilter))
    : passages;

  async function saveSummary(scope: 'book' | 'chapter', scopeId: number, body: string) {
    const mine = summaries.filter(
      (s) => s.scope === scope && s.scope_id === scopeId && s.generated_by === 'user',
    );
    await Promise.all(mine.map((s) => api.deleteSummary(s.id)));
    if (body.trim()) await api.createSummary(scope, scopeId, body.trim());
    await load();
  }

  function openInReader(p: PassageDetail) {
    const ch = chapterOf(p.start_block);
    navigate(`/book/${id}?focus=${p.start_block}${ch != null ? `&ch=${ch}` : ''}`);
  }

  return (
    <main className={styles.notesview}>
      <header className={styles.head}>
        <h1>Notes</h1>
        <RouterLink to={`/book/${id}`}>← Back to reader</RouterLink>
      </header>
      {error && <p role="alert">{error}</p>}

      <section>
        <h2>Summaries</h2>
        <SummaryEditor
          label="Book summary"
          summaries={summaries.filter((s) => s.scope === 'book' && s.scope_id === id)}
          onSave={(body) => saveSummary('book', id, body)}
        />
        {chapters.map((c) => (
          <SummaryEditor
            key={c.id}
            label={`Chapter: ${c.title}`}
            summaries={summaries.filter((s) => s.scope === 'chapter' && s.scope_id === c.id)}
            onSave={(body) => saveSummary('chapter', c.id, body)}
          />
        ))}
      </section>

      <section>
        <h2>Annotations</h2>
        <div className={styles.filters}>
          <button
            className={tagFilter === null ? styles.filterActive : styles.filter}
            onClick={() => setTagFilter(null)}
          >
            All
          </button>
          {allTags.map((t) => (
            <button
              key={t}
              className={tagFilter === t ? styles.filterActive : styles.filter}
              onClick={() => setTagFilter(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <ul className={styles.rows}>
          {shown.map((p) => (
            <li key={p.id} className={styles.row}>
              <p className={styles.preview}>{preview(p)}</p>
              <div className={styles.meta}>
                {p.highlights.map((h) => (
                  <span
                    key={h.id}
                    className={styles.dot}
                    style={{ background: `var(--hl-${h.color})` }}
                  />
                ))}
                {p.tags.map((t) => (
                  <span key={t.id} className={styles.tag}>
                    {t.name}
                  </span>
                ))}
              </div>
              {p.notes.map((n) => (
                <p key={n.id} className={styles.note}>
                  {n.body}
                </p>
              ))}
              {(linksBy[p.id] ?? []).length > 0 && (
                <p className={styles.linkline}>{(linksBy[p.id] ?? []).length} link(s)</p>
              )}
              <button className={styles.open} onClick={() => openInReader(p)}>
                Open in reader
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function SummaryEditor({
  label,
  summaries,
  onSave,
}: {
  label: string;
  summaries: Summary[];
  onSave: (body: string) => void;
}) {
  const mine = summaries.find((s) => s.generated_by === 'user');
  const agent = summaries.filter((s) => s.generated_by !== 'user');
  const [body, setBody] = useState(mine?.body ?? '');
  return (
    <div className={styles.summary}>
      <h3 className={styles.summaryLabel}>{label}</h3>
      <textarea
        aria-label={label}
        className={styles.summaryText}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <button className={styles.open} onClick={() => onSave(body)}>
        Save
      </button>
      {agent.map((s) => (
        <p key={s.id} className={styles.agentSummary}>
          <span className={styles.badge}>agent</span> {s.body}
        </p>
      ))}
    </div>
  );
}
