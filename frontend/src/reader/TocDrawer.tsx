import type { Chapter } from '../api/client';

export function TocDrawer({
  chapters,
  activeId,
  onSelect,
}: {
  chapters: Chapter[];
  activeId: number | null;
  onSelect: (chapterId: number) => void;
}) {
  return (
    <nav aria-label="Table of contents">
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {chapters.map((c) => (
          <li key={c.id}>
            <button
              aria-current={c.id === activeId ? 'true' : undefined}
              onClick={() => onSelect(c.id)}
              style={{
                background: 'transparent',
                border: 'none',
                color: c.id === activeId ? 'var(--accent)' : 'var(--fg)',
                cursor: 'pointer',
                padding: '0.25rem 0',
                textAlign: 'left',
                width: '100%',
                overflowWrap: 'anywhere',
              }}
            >
              {c.title}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
