import { useState } from 'react';
import type { PassageDetail } from '../api/client';

export function PassagePanel({
  passage,
  onAddNote,
  onAddTag,
  onRemoveTag,
  onDelete,
  onClose,
}: {
  passage: PassageDetail;
  onAddNote: (body: string) => void;
  onAddTag: (name: string) => void;
  onRemoveTag: (tagId: number) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const [tag, setTag] = useState('');

  return (
    <aside
      aria-label="Passage"
      style={{
        position: 'fixed', right: 0, top: 0, bottom: 0, width: 300, padding: '1rem',
        background: 'var(--surface)', borderLeft: '1px solid var(--border)', overflowY: 'auto', zIndex: 20,
      }}
    >
      <button aria-label="Close" onClick={onClose} style={{ float: 'right' }}>×</button>

      <h3>Notes</h3>
      <ul>
        {passage.notes.map((n) => (
          <li key={n.id}>{n.body}</li>
        ))}
      </ul>
      <textarea aria-label="New note" value={note} onChange={(e) => setNote(e.target.value)} />
      <button
        onClick={() => {
          if (note.trim()) onAddNote(note.trim());
          setNote('');
        }}
      >
        Save note
      </button>

      <h3>Tags</h3>
      <ul>
        {passage.tags.map((t) => (
          <li key={t.id}>
            {t.name}
            <button aria-label={`Remove tag ${t.name}`} onClick={() => onRemoveTag(t.id)}>×</button>
          </li>
        ))}
      </ul>
      <input aria-label="New tag" value={tag} onChange={(e) => setTag(e.target.value)} />
      <button
        onClick={() => {
          if (tag.trim()) onAddTag(tag.trim());
          setTag('');
        }}
      >
        Add tag
      </button>

      <hr />
      <button onClick={onDelete}>Delete passage</button>
    </aside>
  );
}
