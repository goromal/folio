import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Book } from '../api/client';
import styles from './LibraryScreen.module.css';

export function LibraryScreen() {
  const [books, setBooks] = useState<Book[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setBooks(await api.listBooks());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function remove(id: number) {
    await api.deleteBook(id);
    await refresh();
  }

  return (
    <main className={styles.library}>
      {error && <p role="alert">{error}</p>}
      <ul className={styles.grid}>
        {books.map((b) => (
          <li key={b.id} className={styles.card}>
            <Link to={`/book/${b.id}`}>{b.title}</Link>
            {b.author && <span className={styles.author}>{b.author}</span>}
            <button aria-label={`Delete ${b.title}`} onClick={() => void remove(b.id)}>
              ×
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
