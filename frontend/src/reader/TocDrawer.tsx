import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Chapter } from '../api/client';
import { fuzzyFilter } from './fuzzy';

/** Scroll only the TOC's own scroll container (scrollIntoView would also move the page). */
function revealInPane(el: HTMLElement | null | undefined, center: boolean) {
  const pane = el?.closest('nav')?.parentElement;
  if (!el || !pane) return;
  const e = el.getBoundingClientRect();
  const p = pane.getBoundingClientRect();
  if (center) pane.scrollTop += e.top - p.top - (p.height - e.height) / 2;
  else if (e.top < p.top) pane.scrollTop -= p.top - e.top;
  else if (e.bottom > p.bottom) pane.scrollTop += e.bottom - p.bottom;
}

export function TocDrawer({
  chapters,
  activeId,
  onSelect,
}: {
  chapters: Chapter[];
  activeId: number | null;
  onSelect: (chapterId: number) => void;
}) {
  const [query, setQuery] = useState('');
  // Keyboard cursor within the filtered results (only meaningful while searching).
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const searching = query.trim() !== '';

  const shown = useMemo(() => fuzzyFilter(chapters, query, (c) => c.title), [chapters, query]);

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    if (!searching) return;
    revealInPane(listRef.current?.children[cursor] as HTMLElement | undefined, false);
  }, [cursor, searching]);

  // Outside a search, keep the current chapter in view (on open, after a jump, after clearing).
  useEffect(() => {
    if (searching) return;
    revealInPane(listRef.current?.querySelector<HTMLElement>('[aria-current="true"]'), true);
  }, [activeId, searching]);

  function choose(id: number) {
    onSelect(id);
    setQuery('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, shown.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = shown[cursor];
      if (searching && target) choose(target.id);
    } else if (e.key === 'Escape') {
      setQuery('');
    }
  }

  return (
    <nav aria-label="Table of contents">
      <div style={{ position: 'sticky', top: 0, background: 'var(--bg)', paddingBottom: '0.5rem' }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Jump to chapter…"
          aria-label="Search chapters"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '0.35rem 0.5rem',
            border: '1px solid var(--border)',
            borderRadius: 6,
            background: 'var(--bg)',
            color: 'var(--fg)',
            font: 'inherit',
            fontSize: '0.85rem',
          }}
        />
        {searching && (
          <div style={{ color: 'var(--muted)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
            {shown.length === 0 ? 'No matching chapters' : `${shown.length} of ${chapters.length}`}
          </div>
        )}
      </div>
      <ul ref={listRef} style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {shown.map((c, i) => {
          const hot = searching && i === cursor;
          return (
            <li key={c.id}>
              <button
                aria-current={c.id === activeId ? 'true' : undefined}
                onClick={() => choose(c.id)}
                onMouseEnter={searching ? () => setCursor(i) : undefined}
                style={{
                  background: hot ? 'var(--surface)' : 'transparent',
                  border: 'none',
                  borderRadius: 4,
                  color: c.id === activeId ? 'var(--accent)' : 'var(--fg)',
                  cursor: 'pointer',
                  padding: '0.25rem 0.3rem',
                  textAlign: 'left',
                  width: '100%',
                  overflowWrap: 'anywhere',
                }}
              >
                {c.title}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
