import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { api, subscribeEvents, type Chapter, type PassageDetail, type Summary } from '../api/client';
import { Markdown } from '../markdown/Markdown';
import { fuzzyMatch } from './fuzzy';
import styles from './NotesView.module.css';

type Tab = 'summaries' | 'notes';
const TAB_KEY = 'folio.notesTab';

export function NotesView() {
  const { bookId } = useParams();
  const id = Number(bookId);
  const navigate = useNavigate();

  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [passages, setPassages] = useState<PassageDetail[]>([]);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [tab, setTab] = useState<Tab>(() => {
    try { return (localStorage.getItem(TAB_KEY) as Tab) || 'notes'; } catch { return 'notes'; }
  });
  const [query, setQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [addChapter, setAddChapter] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [toc, ps, sums] = await Promise.all([
        api.getToc(id), api.listPassages(id), api.listBookSummaries(id),
      ]);
      setChapters(toc); setPassages(ps); setSummaries(sums);
    } catch (e) { setError(String(e)); }
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = subscribeEvents((e) => {
      if (e.type === 'changed') { clearTimeout(t); t = setTimeout(() => { void load(); }, 300); }
    });
    return () => { clearTimeout(t); off(); };
  }, [load]);

  function selectTab(next: Tab) {
    setTab(next);
    try { localStorage.setItem(TAB_KEY, next); } catch { /* ignore */ }
  }
  const chapterTitle = useCallback(
    (cid: number | null) => chapters.find((c) => c.id === cid)?.title ?? null, [chapters]);

  async function createSummaryFor(scope: 'book' | 'chapter', scopeId: number, body: string): Promise<boolean> {
    try { await api.createSummary(scope, scopeId, body.trim()); await load(); return true; }
    catch (e) { setError(String(e)); return false; }
  }
  async function updateSummaryBody(sid: number, body: string, generatedBy?: string): Promise<boolean> {
    try { await api.updateSummary(sid, body.trim(), generatedBy); await load(); return true; }
    catch (e) { setError(String(e)); return false; }
  }
  function openInReader(p: PassageDetail) {
    navigate(`/book/${id}?focus=${p.start_block}${p.chapter_id != null ? `&ch=${p.chapter_id}` : ''}`);
  }
  function toggleTag(name: string) {
    setSelectedTags((cur) => cur.includes(name) ? cur.filter((t) => t !== name) : [...cur, name]);
  }

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    passages.forEach((p) => p.tags.forEach((t) => counts.set(t.name, (counts.get(t.name) ?? 0) + 1)));
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [passages]);

  const shown = useMemo(() => passages.filter((p) => {
    if (selectedTags.length && !p.tags.some((t) => selectedTags.includes(t.name))) return false;
    if (query.trim()) {
      const hay = [p.preview, ...p.notes.map((n) => n.body), ...p.tags.map((t) => t.name),
                   chapterTitle(p.chapter_id) ?? ''].join(' \n ');
      if (!fuzzyMatch(query, hay)) return false;
    }
    return true;
  }), [passages, selectedTags, query, chapterTitle]);

  const groups = useMemo(() => {
    const order = new Map(chapters.map((c, i) => [c.id, i] as const));
    const byChapter = new Map<number | null, PassageDetail[]>();
    shown.forEach((p) => {
      const k = p.chapter_id ?? null;
      if (!byChapter.has(k)) byChapter.set(k, []);
      byChapter.get(k)!.push(p);
    });
    return [...byChapter.entries()].sort((a, b) => {
      const ai = a[0] == null ? Infinity : (order.get(a[0]) ?? Infinity);
      const bi = b[0] == null ? Infinity : (order.get(b[0]) ?? Infinity);
      return ai - bi;
    });
  }, [shown, chapters]);

  const bookSummaries = summaries.filter((s) => s.scope === 'book' && s.scope_id === id);
  const chapterSummaryIds = new Set(
    summaries.filter((s) => s.scope === 'chapter').map((s) => s.scope_id));
  const chaptersWithSummary = chapters.filter((c) => chapterSummaryIds.has(c.id));
  const chaptersWithout = chapters.filter((c) => !chapterSummaryIds.has(c.id));

  return (
    <main className={styles.notesview}>
      <header className={styles.head}>
        <h1>Notes</h1>
        <RouterLink to={`/book/${id}`}>← Back to reader</RouterLink>
      </header>
      {error && <p role="alert">{error}</p>}

      <div role="tablist" className={styles.tabs}>
        <button role="tab" aria-selected={tab === 'notes'}
          className={tab === 'notes' ? styles.tabActive : styles.tab}
          onClick={() => selectTab('notes')}>Notes &amp; Annotations</button>
        <button role="tab" aria-selected={tab === 'summaries'}
          className={tab === 'summaries' ? styles.tabActive : styles.tab}
          onClick={() => selectTab('summaries')}>Summaries</button>
      </div>

      {tab === 'summaries' ? (
        <section>
          <SummaryEditor label="Book summary" summaries={bookSummaries}
            onCreate={(b) => createSummaryFor('book', id, b)} onUpdate={updateSummaryBody} />
          {chaptersWithSummary.map((c) => (
            <SummaryEditor key={c.id}
              label={c.first_block_id != null
                ? <RouterLink to={`/book/${id}?focus=${c.first_block_id}&ch=${c.id}`}>{`Chapter: ${c.title}`}</RouterLink>
                : `Chapter: ${c.title}`}
              summaries={summaries.filter((s) => s.scope === 'chapter' && s.scope_id === c.id)}
              onCreate={(b) => createSummaryFor('chapter', c.id, b)} onUpdate={updateSummaryBody} />
          ))}
          <div className={styles.addChapter}>
            <label>
              Add summary to chapter:{' '}
              <select aria-label="Add summary to chapter" value={addChapter}
                onChange={(e) => setAddChapter(e.target.value ? Number(e.target.value) : '')}>
                <option value="">Select a chapter…</option>
                {chaptersWithout.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </label>
            {addChapter !== '' && (
              <SummaryEditor
                label={`Chapter: ${chapters.find((c) => c.id === addChapter)?.title ?? ''}`}
                summaries={[]}
                onCreate={(b) => createSummaryFor('chapter', addChapter as number, b)}
                onUpdate={updateSummaryBody} />
            )}
          </div>
        </section>
      ) : (
        <section>
          <input className={styles.search} type="search" placeholder="Search notes…"
            aria-label="Search notes" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className={styles.filters}>
            {allTags.map(([name, count]) => (
              <label key={name}
                className={selectedTags.includes(name) ? styles.filterActive : styles.filter}>
                <input type="checkbox" checked={selectedTags.includes(name)}
                  onChange={() => toggleTag(name)} /> {name} ({count})
              </label>
            ))}
          </div>
          {groups.map(([cid, ps]) => (
            <details key={cid ?? 'none'} open className={styles.group}>
              <summary className={styles.groupTitle}>
                {chapterTitle(cid) ?? 'Unassigned'} ({ps.length})
              </summary>
              <ul className={styles.rows}>
                {ps.map((p) => (
                  <li key={p.id} className={styles.row}>
                    <p className={styles.preview}>{p.preview || `passage ${p.id}`}</p>
                    <div className={styles.meta}>
                      {p.highlights.map((h) => (
                        <span key={h.id} className={styles.dot}
                          style={{ background: `var(--hl-${h.color})` }} />
                      ))}
                      {p.tags.map((t) => <span key={t.id} className={styles.tag}>{t.name}</span>)}
                    </div>
                    {p.notes.map((n) => <Markdown key={n.id} className={styles.note}>{n.body}</Markdown>)}
                    {p.link_count > 0 && <p className={styles.linkline}>{p.link_count} link(s)</p>}
                    <button className={styles.open} onClick={() => openInReader(p)}>Open in reader</button>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </section>
      )}
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
