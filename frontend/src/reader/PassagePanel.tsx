import { useState } from 'react';
import type { PassageDetail } from '../api/client';
import styles from './PassagePanel.module.css';

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
          {passage.notes.map((n) => (
            <li key={n.id} className={styles.note}>
              {n.body}
            </li>
          ))}
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

      <footer className={styles.footer}>
        <button className={styles.danger} onClick={onDelete}>
          Delete passage
        </button>
      </footer>
    </aside>
  );
}
