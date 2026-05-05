import { useEffect, useState } from 'react';
import type { HistoryEntry } from '../types';

interface Props {
  onOpen: (url: string) => void;
}

const formatTime = (ms: number): string => {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ms).toLocaleDateString();
};

export function HistoryPanel({ onOpen }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [query, setQuery] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  const refresh = (q?: string) => {
    window.api.history.list(200, q).then(setEntries);
  };

  useEffect(() => {
    refresh();
  }, []);

  const importFromChrome = async () => {
    setImporting(true);
    setImportMessage(null);
    try {
      const result = await window.api.chrome.importHistory();
      setImportMessage(`Imported ${result.imported} of ${result.scanned} history entries.`);
      refresh();
    } catch (err) {
      setImportMessage(`Import failed: ${(err as Error).message}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <input
        className="side-panel-search"
        placeholder="Search history…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          refresh(e.target.value || undefined);
        }}
      />
      <div className="section-actions" style={{ gap: 4 }}>
        <button
          type="button"
          className="text-btn"
          onClick={importFromChrome}
          disabled={importing}
        >
          {importing ? 'Importing…' : 'Import from Chrome'}
        </button>
        <button
          type="button"
          className="text-btn"
          onClick={async () => {
            await window.api.history.clear();
            refresh();
          }}
        >
          Clear all
        </button>
      </div>
      {importMessage ? (
        <div style={{ fontSize: 11, color: '#9aa0a6', padding: '4px 8px 8px' }}>
          {importMessage}
        </div>
      ) : null}
      {entries.length === 0 ? (
        <div className="empty">No history yet.</div>
      ) : (
        entries.map((entry, i) => (
          <div
            key={`${entry.url}-${entry.visitedAt}-${i}`}
            className="list-item"
            onClick={() => onOpen(entry.url)}
            role="button"
          >
            <div className="list-item-title">{entry.title || entry.url}</div>
            <div className="list-item-url">{entry.url}</div>
            <div className="list-item-meta">{formatTime(entry.visitedAt)}</div>
          </div>
        ))
      )}
    </>
  );
}
