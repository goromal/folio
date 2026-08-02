import { useState, type DragEvent } from 'react';
import { api } from '../api/client';

export function UploadDropzone({ onUploaded }: { onUploaded: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      await api.uploadBook(file);
      onUploaded();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) void upload(file);
  }

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      style={{
        border: '2px dashed var(--border)',
        borderRadius: 8,
        padding: '1.5rem',
        textAlign: 'center',
        color: 'var(--muted)',
      }}
    >
      <label>
        {busy ? 'Uploading…' : 'Drop an EPUB here, or '}
        {!busy && <span style={{ color: 'var(--accent)', cursor: 'pointer' }}>choose a file</span>}
        <input
          type="file"
          accept=".epub,application/epub+zip"
          aria-label="Upload EPUB"
          style={{ display: 'none' }}
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ''; // allow re-selecting the same filename (e.g. after a failed upload)
            if (file) void upload(file);
          }}
        />
      </label>
      {error && <p role="alert" style={{ color: 'crimson' }}>{error}</p>}
    </div>
  );
}
