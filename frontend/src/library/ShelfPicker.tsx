import { useEffect, useRef, useState } from 'react';
import { api, type Book, type Shelf } from '../api/client';
import styles from './LibraryScreen.module.css';

/** Per-book "Shelves" button + popover: check shelves on/off, or make a new one. */
export function ShelfPicker({ book, shelves, onChanged, onError }: {
  book: Book;
  shelves: Shelf[];
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const current = book.shelf_ids ?? [];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function save(ids: number[]) {
    try {
      await api.setBookShelves(book.id, ids);
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  async function createAndAdd() {
    const name = newName.trim();
    if (!name) return;
    try {
      const existing = shelves.find((s) => s.name.toLowerCase() === name.toLowerCase());
      const shelf = existing ?? (await api.createShelf(name));
      setNewName('');
      await save([...current.filter((id) => id !== shelf.id), shelf.id]);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className={styles.picker} ref={ref}>
      <button
        type="button"
        className={styles.iconBtn}
        aria-label={`Shelves for ${book.title}`}
        aria-expanded={open}
        title="Add to shelf"
        onClick={() => setOpen((v) => !v)}
      >
        ⊞
      </button>
      {open && (
        <div className={styles.popover} role="dialog" aria-label={`Shelves for ${book.title}`}>
          {shelves.length === 0 && <p className={styles.muted}>No shelves yet.</p>}
          {shelves.map((s) => {
            const on = current.includes(s.id);
            return (
              <label key={s.id} className={styles.check}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => void save(on ? current.filter((id) => id !== s.id) : [...current, s.id])}
                />
                {s.name}
              </label>
            );
          })}
          <form
            className={styles.newShelf}
            onSubmit={(e) => { e.preventDefault(); void createAndAdd(); }}
          >
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New shelf…"
              aria-label="New shelf name"
            />
            <button type="submit" disabled={!newName.trim()}>Add</button>
          </form>
        </div>
      )}
    </div>
  );
}
