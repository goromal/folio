import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import {
  api,
  subscribeEvents,
  type Block,
  type Chapter,
  type Link,
  type PassageDetail,
  type Summary,
} from '../api/client';
import { passageText } from '../reader/passageText';
import { Markdown } from '../markdown/Markdown';
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

  // Live sync: reload when data changes elsewhere (e.g. an agent edit via MCP).
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = subscribeEvents((e) => {
      if (e.type === 'changed') {
        clearTimeout(t);
        t = setTimeout(() => {
          void load();
        }, 300);
      }
    });
    return () => {
      clearTimeout(t);
      off();
    };
  }, [load]);

  const chapterOf = useCallback(
    (blockId: number) => blocks.find((b) => b.id === blockId)?.chapter_id ?? null,
    [blocks],
  );
  const preview = useCallback(
    (p: PassageDetail) => passageText(blocks, p).slice(0, 100) || `passage ${p.id}`,
    [blocks],
  );
  const firstBlockOf = useCallback(
    (chapterId: number) => blocks.find((b) => b.chapter_id === chapterId)?.id ?? null,
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

  async function createSummaryFor(scope: 'book' | 'chapter', scopeId: number, body: string): Promise<boolean> {
    try {
      await api.createSummary(scope, scopeId, body.trim());
      await load();
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  }

  async function updateSummaryBody(id: number, body: string, generatedBy?: string): Promise<boolean> {
    try {
      await api.updateSummary(id, body.trim(), generatedBy);
      await load();
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
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
          onCreate={(body) => createSummaryFor('book', id, body)}
          onUpdate={updateSummaryBody}
        />
        {chapters.map((c) => {
          const fb = firstBlockOf(c.id);
          const text = `Chapter: ${c.title}`;
          const label =
            fb != null ? (
              <RouterLink to={`/book/${id}?focus=${fb}&ch=${c.id}`}>{text}</RouterLink>
            ) : (
              text
            );
          return (
            <SummaryEditor
              key={c.id}
              label={label}
              summaries={summaries.filter((s) => s.scope === 'chapter' && s.scope_id === c.id)}
              onCreate={(body) => createSummaryFor('chapter', c.id, body)}
              onUpdate={updateSummaryBody}
            />
          );
        })}
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
                <Markdown key={n.id} className={styles.note}>
                  {n.body}
                </Markdown>
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
  onCreate,
  onUpdate,
}: {
  label: ReactNode;
  summaries: Summary[];
  onCreate: (body: string) => Promise<boolean>;
  onUpdate: (id: number, body: string, generatedBy?: string) => Promise<boolean>;
}) {
  const headingId = useId();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingBody, setEditingBody] = useState('');
  const [draft, setDraft] = useState('');
  const [saved, setSaved] = useState(false);

  return (
    <div className={styles.summary}>
      <h3 id={headingId} className={styles.summaryLabel}>{label}</h3>
      <ul className={styles.summaryList}>
        {summaries.map((s) =>
          editingId === s.id ? (
            <li key={s.id} className={styles.agentSummary}>
              <textarea
                aria-label="Edit summary"
                className={styles.summaryText}
                value={editingBody}
                onChange={(e) => setEditingBody(e.target.value)}
              />
              <div className={styles.summaryActions}>
                <button
                  className={styles.open}
                  onClick={async () => {
                    const body = editingBody.trim();
                    if (body) {
                      await onUpdate(s.id, body, s.generated_by !== 'user' ? 'user' : undefined);
                    }
                    setEditingId(null);
                  }}
                >
                  Save
                </button>
                <button className={styles.open} onClick={() => setEditingId(null)}>
                  Cancel
                </button>
              </div>
            </li>
          ) : (
            <li key={s.id} className={styles.agentSummary}>
              {s.generated_by !== 'user' && <span className={styles.badge}>agent</span>}
              <Markdown>{s.body}</Markdown>
              <button
                aria-label="Edit summary"
                className={styles.open}
                onClick={() => {
                  setEditingId(s.id);
                  setEditingBody(s.body);
                }}
              >
                Edit
              </button>
            </li>
          ),
        )}
      </ul>
      <textarea
        aria-labelledby={headingId}
        className={styles.summaryText}
        placeholder="Add a summary…"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setSaved(false);
        }}
      />
      <div className={styles.summaryActions}>
        <button
          className={styles.open}
          onClick={async () => {
            const body = draft.trim();
            if (body && (await onCreate(body))) {
              setDraft('');
              setSaved(true);
            }
          }}
        >
          Save
        </button>
        {saved && (
          <span className={styles.saved} role="status">Saved ✓</span>
        )}
      </div>
    </div>
  );
}
