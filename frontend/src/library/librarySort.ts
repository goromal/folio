import type { Book } from '../api/client';

export type SortMode = 'recent' | 'title' | 'author' | 'added';

export const SORT_LABELS: Record<SortMode, string> = {
  recent: 'Recently read',
  title: 'Title',
  author: 'Author',
  added: 'Recently added',
};

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** Title sort key: leading articles don't count ("The Republic" files under R). */
export function titleKey(title: string): string {
  return title.trim().replace(/^(the|a|an)\s+/i, '');
}

/** Author sort key: surname first ("Immanuel Kant" files under K). */
export function authorKey(author: string | null | undefined): string {
  const first = (author ?? '').split(/[,;&]| and /)[0].trim();
  const parts = first.split(/\s+/);
  return parts.length > 1 ? `${parts[parts.length - 1]} ${parts.slice(0, -1).join(' ')}` : first;
}

function byTitle(a: Book, b: Book) {
  return collator.compare(titleKey(a.title), titleKey(b.title));
}

export function sortBooks(books: Book[], mode: SortMode): Book[] {
  const out = [...books];
  switch (mode) {
    case 'title':
      return out.sort(byTitle);
    case 'author':
      // Books without an author sink to the bottom.
      return out.sort((a, b) =>
        (!a.author ? 1 : 0) - (!b.author ? 1 : 0)
        || collator.compare(authorKey(a.author), authorKey(b.author))
        || byTitle(a, b));
    case 'added':
      return out.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '') || b.id - a.id);
    case 'recent':
      // Read books by last-read time, then never-read books newest-added first.
      return out.sort((a, b) =>
        (b.last_read_at ?? '').localeCompare(a.last_read_at ?? '')
        || (b.created_at ?? '').localeCompare(a.created_at ?? '')
        || b.id - a.id);
  }
}

/** The letter a book files under for alphabetical sorts; null for the other sorts. */
export function letterOf(book: Book, mode: SortMode): string | null {
  if (mode !== 'title' && mode !== 'author') return null;
  const key = mode === 'title' ? titleKey(book.title) : authorKey(book.author);
  if (mode === 'author' && !book.author) return 'Unknown author';
  const ch = key.normalize('NFD').charAt(0).toUpperCase();
  return /[A-Z]/.test(ch) ? ch : '#';
}

/** Split an already-sorted list into consecutive letter sections. */
export function groupByLetter(books: Book[], mode: SortMode): { letter: string | null; books: Book[] }[] {
  const groups: { letter: string | null; books: Book[] }[] = [];
  for (const b of books) {
    const letter = letterOf(b, mode);
    const last = groups[groups.length - 1];
    if (last && last.letter === letter) last.books.push(b);
    else groups.push({ letter, books: [b] });
  }
  return groups;
}

export function matchesQuery(book: Book, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return book.title.toLowerCase().includes(q) || (book.author ?? '').toLowerCase().includes(q);
}
