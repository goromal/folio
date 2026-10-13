import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { api, subscribeEvents, type Book, type PassageDetail } from '../api/client';
import { Markdown } from '../markdown/Markdown';
import { fuzzyMatch } from './fuzzy';
import styles from './NotesView.module.css';

type GroupBy = 'tag' | 'book';
const GROUP_KEY = 'folio.globalNotesGroup';
const UNTAGGED = 'Untagged';

/** Notes and tags across every book, for cross-book analysis. */
export function GlobalNotesView() {
  const navigate = useNavigate();
  const [books, setBooks] = useState<Book[]>([]);
  const [passages, setPassages] = useState<PassageDetail[]>([]);
  const [groupBy, setGroupBy] = useState<GroupBy>(() => {
    try { return (localStorage.getItem(GROUP_KEY) as GroupBy) || 'tag'; } catch { return 'tag'; }
  });
  const [query, setQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [bs, ps] = await Promise.all([api.listBooks(), api.listAllPassages()]);
      setBooks(bs); setPassages(ps);
    } catch (e) { setError(String(e)); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = subscribeEvents((e) => {
      if (e.type === 'changed') { clearTimeout(t); t = setTimeout(() => { void load(); }, 300); }
    });
    return () => { clearTimeout(t); off(); };
  }, [load]);

  function selectGroup(next: GroupBy) {
    setGroupBy(next);
    try { localStorage.setItem(GROUP_KEY, next); } catch { /* ignore */ }
  }
  const bookTitle = useCallback(
    (bid: number) => books.find((b) => b.id === bid)?.title ?? `book ${bid}`, [books]);
  function openInReader(p: PassageDetail) {
    navigate(`/book/${p.book_id}?focus=${p.start_block}${p.chapter_id != null ? `&ch=${p.chapter_id}` : ''}`);
  }
  function toggleTag(name: string) {
    setSelectedTags((cur) => cur.includes(name) ? cur.filter((t) => t !== name) : [...cur, name]);
  }

  // Per tag: passage count and the set of books it appears in. Tags shared by
  // several books sort first — those are the threads worth comparing.
  const tagStats = useMemo(() => {
    const stats = new Map<string, { count: number; books: Set<number> }>();
    passages.forEach((p) => p.tags.forEach((t) => {
      const s = stats.get(t.name) ?? { count: 0, books: new Set<number>() };
      s.count += 1; s.books.add(p.book_id);
      stats.set(t.name, s);
    }));
    return [...stats.entries()].sort((a, b) =>
      b[1].books.size - a[1].books.size || a[0].localeCompare(b[0]));
  }, [passages]);

  const shown = useMemo(() => passages.filter((p) => {
    if (selectedTags.length && !p.tags.some((t) => selectedTags.includes(t.name))) return false;
    if (query.trim()) {
      const hay = [p.preview, ...p.notes.map((n) => n.body), ...p.tags.map((t) => t.name),
                   bookTitle(p.book_id)].join(' \n ');
      if (!fuzzyMatch(query, hay)) return false;
    }
    return true;
  }), [passages, selectedTags, query, bookTitle]);

  const groups = useMemo((): [string, PassageDetail[]][] => {
    const byKey = new Map<string, PassageDetail[]>();
    const add = (k: string, p: PassageDetail) => {
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k)!.push(p);
    };
    if (groupBy === 'book') {
      shown.forEach((p) => add(bookTitle(p.book_id), p));
      return [...byKey.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    }
    // By tag: a passage appears under each of its tags. With a tag filter active,
    // only the selected tags get groups.
    shown.forEach((p) => {
      const names = p.tags.map((t) => t.name)
        .filter((n) => !selectedTags.length || selectedTags.includes(n));
      if (names.length) names.forEach((n) => add(n, p));
      else add(UNTAGGED, p);
    });
    const order = new Map(tagStats.map(([n], i) => [n, i] as const));
    return [...byKey.entries()].sort((a, b) =>
      (order.get(a[0]) ?? Infinity) - (order.get(b[0]) ?? Infinity));
  }, [shown, groupBy, selectedTags, tagStats, bookTitle]);

  const groupLabel = (key: string, ps: PassageDetail[]) => {
    if (groupBy === 'book') return `${key} (${ps.length})`;
    const nBooks = new Set(ps.map((p) => p.book_id)).size;
    return `${key} (${ps.length} · ${nBooks} book${nBooks === 1 ? '' : 's'})`;
  };

  return (
    <main className={styles.notesview}>
      <header className={styles.head}>
        <h1>All notes &amp; tags</h1>
        <RouterLink to="/">← Library</RouterLink>
      </header>
      {error && <p role="alert">{error}</p>}

      <div role="tablist" aria-label="Group by" className={styles.tabs}>
        <button role="tab" aria-selected={groupBy === 'tag'}
          className={groupBy === 'tag' ? styles.tabActive : styles.tab}
          onClick={() => selectGroup('tag')}>By tag</button>
        <button role="tab" aria-selected={groupBy === 'book'}
          className={groupBy === 'book' ? styles.tabActive : styles.tab}
          onClick={() => selectGroup('book')}>By book</button>
      </div>

      <input className={styles.search} type="search" placeholder="Search all notes…"
        aria-label="Search notes" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className={styles.filters}>
        {tagStats.map(([name, s]) => (
          <label key={name}
            className={selectedTags.includes(name) ? styles.filterActive : styles.filter}>
            <input type="checkbox" checked={selectedTags.includes(name)}
              onChange={() => toggleTag(name)} />{' '}
            {name} ({s.count}{s.books.size > 1 ? ` · ${s.books.size} books` : ''})
          </label>
        ))}
      </div>

      {passages.length === 0 && !error && <p>No annotated passages yet.</p>}
      {groups.map(([key, ps]) => (
        <details key={key} open className={styles.group}>
          <summary className={styles.groupTitle}>{groupLabel(key, ps)}</summary>
          <ul className={styles.rows}>
            {ps.map((p) => (
              <li key={p.id} className={styles.row}>
                {groupBy === 'tag' && <p className={styles.bookline}>{bookTitle(p.book_id)}</p>}
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
    </main>
  );
}
