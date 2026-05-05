import { useEffect, useState } from 'react';
import type { Bookmark } from '../types';

interface Props {
  onOpen: (url: string) => void;
}

export function BookmarksPanel({ onOpen }: Props) {
  const [items, setItems] = useState<Bookmark[]>([]);
  const [query, setQuery] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  const refresh = (q?: string) => {
    window.api.bookmarks.list(q).then(setItems);
  };

  useEffect(() => {
    refresh();
  }, []);

  const importFromChrome = async () => {
    setImporting(true);
    setImportMessage(null);
    try {
      const result = await window.api.chrome.importBookmarks();
      setImportMessage(
        `Imported ${result.imported} new bookmarks (${result.skipped} duplicates skipped).`,
      );
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
        placeholder="Search bookmarks…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          refresh(e.target.value || undefined);
        }}
      />
      <div className="section-actions">
        <button
          type="button"
          className="text-btn"
          onClick={importFromChrome}
          disabled={importing}
        >
          {importing ? 'Importing…' : 'Import from Chrome'}
        </button>
      </div>
      {importMessage ? (
        <div style={{ fontSize: 11, color: '#9aa0a6', padding: '4px 8px 8px' }}>
          {importMessage}
        </div>
      ) : null}
      {items.length === 0 ? (
        <div className="empty">No bookmarks yet. Click ☆ in the address bar to save one.</div>
      ) : (
        items.map((bm) => (
          <div
            key={bm.id}
            className="list-item"
            onClick={() => onOpen(bm.url)}
            role="button"
          >
            <div className="list-item-title">★ {bm.title || bm.url}</div>
            <div className="list-item-url">{bm.url}</div>
            <div className="list-item-actions">
              <button
                type="button"
                className="icon-btn"
                onClick={async (e) => {
                  e.stopPropagation();
                  await window.api.bookmarks.remove(bm.id);
                  refresh(query || undefined);
                }}
                aria-label="Remove bookmark"
                title="Remove"
              >
                ×
              </button>
            </div>
          </div>
        ))
      )}
    </>
  );
}
