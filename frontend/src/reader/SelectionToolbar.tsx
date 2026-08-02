import { HIGHLIGHT_COLORS, type HighlightColor } from './highlights';

export function SelectionToolbar({
  rect,
  onHighlight,
  onNote,
  onTag,
}: {
  rect: Pick<DOMRect, 'top' | 'left'>;
  onHighlight: (color: HighlightColor) => void;
  onNote: () => void;
  onTag: () => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Selection actions"
      style={{
        position: 'fixed',
        top: rect.top,
        left: rect.left,
        transform: 'translateY(-100%)',
        display: 'flex',
        gap: '0.25rem',
        padding: '0.25rem',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        zIndex: 10,
      }}
    >
      {HIGHLIGHT_COLORS.map((c) => (
        <button
          key={c}
          aria-label={`Highlight ${c}`}
          onClick={() => onHighlight(c)}
          style={{
            width: 18, height: 18, borderRadius: '50%',
            border: '1px solid var(--border)', cursor: 'pointer',
            background: `var(--hl-${c})`,
          }}
        />
      ))}
      <button aria-label="Add note" onClick={onNote}>✎</button>
      <button aria-label="Add tag" onClick={onTag}>#</button>
    </div>
  );
}
