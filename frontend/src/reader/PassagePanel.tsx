import { useState } from 'react';
import type { Link, PassageDetail } from '../api/client';
import { Markdown } from '../markdown/Markdown';
import styles from './PassagePanel.module.css';

export function PassagePanel({
  passage,
  onAddNote,
  onEditNote,
  onAddTag,
  onRemoveTag,
  onDelete,
  onClose,
  links,
  linkTargets,
  onCreateLink,
  onRemoveLink,
}: {
  passage: PassageDetail;
  onAddNote: (body: string) => void;
  onEditNote: (noteId: number, body: string) => void;
  onAddTag: (name: string) => void;
  onRemoveTag: (tagId: number) => void;
  onDelete: () => void;
  onClose: () => void;
  links: Link[];
  linkTargets: { id: number; preview: string }[];
  onCreateLink: (toPassageId: number) => void;
  onRemoveLink: (linkId: number) => void;
}) {
  const [note, setNote] = useState('');
  const [tag, setTag] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingBody, setEditingBody] = useState('');
  const [picking, setPicking] = useState(false);
  const linkedIds = new Set(
    links.map((l) => (l.from_passage === passage.id ? l.to_passage : l.from_passage)),
  );

  return (
    <aside aria-label="Passage" className={styles.panel}>
      <header className={styles.header}>
        <h2 className={styles.title}>Passage</h2>
        <button aria-label="Close" className={styles.close} onClick={onClose}>
          ×
        </button>
      </header>

      <section className={styles.section}>
        <h3 className={styles.heading}>Notes</h3>
        {passage.notes.length === 0 && <p className={styles.empty}>No notes yet.</p>}
        <ul className={styles.notes}>
          {passage.notes.map((n) =>
            editingId === n.id ? (
              <li key={n.id} className={styles.noteEditing}>
                <textarea
                  aria-label="Edit note"
                  className={styles.textarea}
                  value={editingBody}
                  onChange={(e) => setEditingBody(e.target.value)}
                />
                <div className={styles.noteActions}>
                  <button
                    className={styles.primary}
                    onClick={() => {
                      if (editingBody.trim()) onEditNote(n.id, editingBody.trim());
                      setEditingId(null);
                    }}
                  >
                    Save
                  </button>
                  <button className={styles.secondary} onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                </div>
              </li>
            ) : (
              <li key={n.id} className={styles.note}>
                <Markdown className={styles.noteBody}>{n.body}</Markdown>
                <button
                  aria-label="Edit note"
                  className={styles.noteEdit}
                  onClick={() => {
                    setEditingId(n.id);
                    setEditingBody(n.body);
                  }}
                >
                  Edit
                </button>
              </li>
            ),
          )}
        </ul>
        <textarea
          aria-label="New note"
          className={styles.textarea}
          placeholder="Add a note…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button
          className={styles.primary}
          onClick={() => {
            if (note.trim()) onAddNote(note.trim());
            setNote('');
          }}
        >
          Save note
        </button>
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>Tags</h3>
        <ul className={styles.tags}>
          {passage.tags.map((t) => (
            <li key={t.id} className={styles.tag}>
              {t.name}
              <button
                aria-label={`Remove tag ${t.name}`}
                className={styles.tagRemove}
                onClick={() => onRemoveTag(t.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <div className={styles.tagAdd}>
          <input
            aria-label="New tag"
            className={styles.input}
            placeholder="Add a tag…"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
          />
          <button
            className={styles.secondary}
            onClick={() => {
              if (tag.trim()) onAddTag(tag.trim());
              setTag('');
            }}
          >
            Add tag
          </button>
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>Links</h3>
        {links.length === 0 && <p className={styles.empty}>No links yet.</p>}
        <ul className={styles.notes}>
          {links.map((l) => {
            // Links are bidirectional; show whichever end ISN'T this passage.
            const otherId = l.from_passage === passage.id ? l.to_passage : l.from_passage;
            return (
              <li key={l.id} className={styles.note}>
                <span className={styles.noteBody}>
                  {linkTargets.find((t) => t.id === otherId)?.preview ?? `passage ${otherId}`}
                </span>
                <button
                  aria-label="Remove link"
                  className={styles.noteEdit}
                  onClick={() => onRemoveLink(l.id)}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
        <button className={styles.secondary} onClick={() => setPicking(true)}>
          + New link
        </button>
        {picking && (
          <LinkPicker
            // Only offer passages this one isn't already linked to.
            targets={linkTargets.filter((t) => !linkedIds.has(t.id))}
            onPick={(toId) => {
              onCreateLink(toId);
              setPicking(false);
            }}
            onCancel={() => setPicking(false)}
          />
        )}
      </section>

      <footer className={styles.footer}>
        <button className={styles.danger} onClick={onDelete}>
          Delete passage
        </button>
      </footer>
    </aside>
  );
}

function LinkPicker({
  targets,
  onPick,
  onCancel,
}: {
  targets: { id: number; preview: string }[];
  onPick: (id: number) => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState('');
  const filtered = q
    ? targets.filter((t) => t.preview.toLowerCase().includes(q.toLowerCase()))
    : targets;
  return (
    <div
      className={styles.backdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New link"
        className={styles.dialog}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
      >
        <header className={styles.header}>
          <h2 className={styles.title}>Link to passage</h2>
          <button aria-label="Cancel link" className={styles.close} onClick={onCancel}>
            ×
          </button>
        </header>
        <input
          aria-label="Filter passages"
          className={styles.input}
          placeholder="Filter…"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {filtered.length === 0 && <p className={styles.empty}>No candidate passages.</p>}
        <ul className={styles.candidates}>
          {filtered.map((t) => (
            <li key={t.id}>
              <button className={styles.candidate} onClick={() => onPick(t.id)}>
                {t.preview}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
