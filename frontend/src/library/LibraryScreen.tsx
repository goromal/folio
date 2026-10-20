import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Book, type Shelf } from '../api/client';
import { UploadDropzone } from './UploadDropzone';
import { ShelfPicker } from './ShelfPicker';
import { SORT_LABELS, groupByLetter, matchesQuery, sortBooks, type SortMode } from './librarySort';
import styles from './LibraryScreen.module.css';

type ViewMode = 'grid' | 'list';
type ShelfFilter = 'all' | 'none' | number;
interface Prefs { view: ViewMode; sort: SortMode; shelf: ShelfFilter }

const PREFS_KEY = 'folio.library.prefs';
const DEFAULT_PREFS: Prefs = { view: 'grid', sort: 'recent', shelf: 'all' };

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

function errText(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.startsWith('409') ? 'A shelf with that name already exists.' : msg;
}

export function LibraryScreen() {
  const [books, setBooks] = useState<Book[]>([]);
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastBookId, setLastBookId] = useState<number | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [query, setQuery] = useState('');
  const [newShelf, setNewShelf] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    void api.getLastPosition().then((p) => setLastBookId(p?.book_id ?? null)).catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [b, s] = await Promise.all([api.listBooks(), api.listShelves()]);
      setBooks(b);
      setShelves(s);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const update = (p: Partial<Prefs>) => {
    setPrefs((old) => {
      const next = { ...old, ...p };
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* per-browser nicety */ }
      return next;
    });
    if ('shelf' in p) { setRenaming(null); setConfirmDelete(false); }
  };

  // A remembered shelf that has since been deleted falls back to All books.
  const activeShelf = typeof prefs.shelf === 'number'
    ? shelves.find((s) => s.id === prefs.shelf) ?? null
    : null;
  const shelfFilter: ShelfFilter = typeof prefs.shelf === 'number' && !activeShelf ? 'all' : prefs.shelf;

  const visible = useMemo(() => {
    const onShelf = books.filter((b) => {
      const ids = b.shelf_ids ?? [];
      if (shelfFilter === 'all') return true;
      if (shelfFilter === 'none') return ids.length === 0;
      return ids.includes(shelfFilter);
    });
    return sortBooks(onShelf.filter((b) => matchesQuery(b, query)), prefs.sort);
  }, [books, shelfFilter, query, prefs.sort]);

  // Letter sections suit the dense list; in the grid they'd strand a card or two per row.
  const groups = useMemo(
    () => (prefs.view === 'list' ? groupByLetter(visible, prefs.sort) : [{ letter: null, books: visible }]),
    [visible, prefs.sort, prefs.view],
  );
  const shelfName = useMemo(() => new Map(shelves.map((s) => [s.id, s.name])), [shelves]);
  const unshelvedCount = books.filter((b) => (b.shelf_ids ?? []).length === 0).length;

  async function run(fn: () => Promise<unknown>) {
    try {
      setError(null);
      await fn();
      await refresh();
    } catch (e) {
      setError(errText(e));
    }
  }

  async function createShelf() {
    const name = (newShelf ?? '').trim();
    if (!name) { setNewShelf(null); return; }
    await run(async () => {
      const s = await api.createShelf(name);
      setNewShelf(null);
      update({ shelf: s.id });
    });
  }

  async function renameShelf() {
    const name = (renaming ?? '').trim();
    if (!activeShelf || !name || name === activeShelf.name) { setRenaming(null); return; }
    await run(async () => {
      await api.renameShelf(activeShelf.id, name);
      setRenaming(null);
    });
  }

  async function deleteShelf() {
    if (!activeShelf) return;
    await run(async () => {
      await api.deleteShelf(activeShelf.id);
      update({ shelf: 'all' });
    });
  }

  const shelfChips = (b: Book) => (b.shelf_ids ?? [])
    .map((id) => shelfName.get(id))
    .filter((n): n is string => !!n);

  const actions = (b: Book) => (
    <span className={styles.actions}>
      <ShelfPicker book={b} shelves={shelves} onChanged={() => void refresh()} onError={setError} />
      <button
        type="button"
        className={styles.iconBtn}
        aria-label={`Delete ${b.title}`}
        title="Delete book"
        onClick={() => void run(() => api.deleteBook(b.id))}
      >
        ×
      </button>
    </span>
  );

  return (
    <main className={styles.library}>
      <UploadDropzone onUploaded={refresh} />
      <div className={styles.links}>
        {lastBookId != null && books.some((b) => b.id === lastBookId) && (
          <Link to={`/book/${lastBookId}`} className={styles.resume}>
            Continue reading → {books.find((b) => b.id === lastBookId)?.title}
          </Link>
        )}
        <Link to="/notes" className={styles.allNotes}>All notes &amp; tags →</Link>
      </div>

      <nav className={styles.shelves} aria-label="Shelves">
        <button
          type="button"
          className={styles.chip}
          aria-pressed={shelfFilter === 'all'}
          onClick={() => update({ shelf: 'all' })}
        >
          All books <span className={styles.count}>{books.length}</span>
        </button>
        {shelves.map((s) => (
          <button
            key={s.id}
            type="button"
            className={styles.chip}
            aria-pressed={shelfFilter === s.id}
            onClick={() => update({ shelf: s.id })}
          >
            {s.name} <span className={styles.count}>{s.book_count}</span>
          </button>
        ))}
        {shelves.length > 0 && (
          <button
            type="button"
            className={styles.chip}
            aria-pressed={shelfFilter === 'none'}
            onClick={() => update({ shelf: 'none' })}
          >
            Unshelved <span className={styles.count}>{unshelvedCount}</span>
          </button>
        )}
        {newShelf == null ? (
          <button type="button" className={`${styles.chip} ${styles.addChip}`} onClick={() => setNewShelf('')}>
            + New shelf
          </button>
        ) : (
          <form className={styles.inlineForm} onSubmit={(e) => { e.preventDefault(); void createShelf(); }}>
            <input
              autoFocus
              value={newShelf}
              onChange={(e) => setNewShelf(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setNewShelf(null); }}
              placeholder="Shelf name"
              aria-label="Shelf name"
            />
            <button type="submit">Create</button>
            <button type="button" onClick={() => setNewShelf(null)}>Cancel</button>
          </form>
        )}
      </nav>

      {activeShelf && (
        <div className={styles.shelfHeader}>
          {renaming == null ? (
            <>
              <h2>{activeShelf.name}</h2>
              <button type="button" className={styles.textBtn} onClick={() => setRenaming(activeShelf.name)}>
                Rename
              </button>
              {confirmDelete ? (
                <>
                  <span className={styles.muted}>Delete this shelf? Its books stay in your library.</span>
                  <button type="button" className={styles.dangerBtn} onClick={() => void deleteShelf()}>
                    Delete shelf
                  </button>
                  <button type="button" className={styles.textBtn} onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button type="button" className={styles.textBtn} onClick={() => setConfirmDelete(true)}>
                  Delete…
                </button>
              )}
            </>
          ) : (
            <form className={styles.inlineForm} onSubmit={(e) => { e.preventDefault(); void renameShelf(); }}>
              <input
                autoFocus
                value={renaming}
                onChange={(e) => setRenaming(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(null); }}
                aria-label="Rename shelf"
              />
              <button type="submit">Save</button>
              <button type="button" onClick={() => setRenaming(null)}>Cancel</button>
            </form>
          )}
        </div>
      )}

      <div className={styles.toolbar}>
        <input
          type="search"
          className={styles.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by title or author"
          aria-label="Filter books"
        />
        <label className={styles.sort}>
          Sort
          <select value={prefs.sort} onChange={(e) => update({ sort: e.target.value as SortMode })}>
            {(Object.keys(SORT_LABELS) as SortMode[]).map((m) => (
              <option key={m} value={m}>{SORT_LABELS[m]}</option>
            ))}
          </select>
        </label>
        <div className={styles.segmented} role="group" aria-label="View">
          <button type="button" aria-pressed={prefs.view === 'grid'} onClick={() => update({ view: 'grid' })}>
            Grid
          </button>
          <button type="button" aria-pressed={prefs.view === 'list'} onClick={() => update({ view: 'list' })}>
            List
          </button>
        </div>
      </div>

      {error && <p role="alert" className={styles.error}>{error}</p>}

      {visible.length === 0 && books.length > 0 && (
        <p className={styles.empty}>
          {query ? 'No books match that filter.' : 'No books on this shelf yet — use ⊞ on a book to add it.'}
        </p>
      )}

      {groups.map((g) => (
        <section key={g.letter ?? 'all'} aria-label={g.letter ?? undefined}>
          {g.letter && <h3 className={styles.letter}>{g.letter}</h3>}
          {prefs.view === 'grid' ? (
            <ul className={styles.grid}>
              {g.books.map((b) => (
                <li key={b.id} className={styles.card}>
                  <Link to={`/book/${b.id}`}>{b.title}</Link>
                  {b.author && <span className={styles.author}>{b.author}</span>}
                  {shelfChips(b).length > 0 && (
                    <span className={styles.tags}>{shelfChips(b).join(' · ')}</span>
                  )}
                  {actions(b)}
                </li>
              ))}
            </ul>
          ) : (
            <ul className={styles.list}>
              {g.books.map((b) => (
                <li key={b.id} className={styles.row}>
                  <Link to={`/book/${b.id}`} className={styles.rowTitle}>{b.title}</Link>
                  <span className={styles.author}>{b.author ?? ''}</span>
                  <span className={styles.tags}>{shelfChips(b).join(' · ')}</span>
                  {actions(b)}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </main>
  );
}
