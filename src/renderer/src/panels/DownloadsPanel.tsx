import { useEffect, useState } from 'react';
import type { DownloadRecord } from '../types';

const formatBytes = (n: number): string => {
  if (n <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
};

const stateLabel = (state: DownloadRecord['state']): string => {
  switch (state) {
    case 'progressing':
      return 'Downloading';
    case 'completed':
      return 'Complete';
    case 'cancelled':
      return 'Cancelled';
    case 'interrupted':
      return 'Failed';
  }
};

export function DownloadsPanel() {
  const [records, setRecords] = useState<DownloadRecord[]>([]);

  useEffect(() => {
    window.api.downloads.list().then(setRecords);
    return window.api.downloads.onUpdated(setRecords);
  }, []);

  return (
    <>
      <div className="section-actions">
        <button
          type="button"
          className="text-btn"
          onClick={() => window.api.downloads.clear()}
        >
          Clear finished
        </button>
      </div>
      {records.length === 0 ? (
        <div className="empty">No downloads yet.</div>
      ) : (
        records.map((rec) => {
          const pct =
            rec.totalBytes > 0 ? Math.min(100, (rec.receivedBytes / rec.totalBytes) * 100) : 0;
          return (
            <div key={rec.id} className="list-item">
              <div className="list-item-title">{rec.filename}</div>
              <div className="list-item-url">{rec.url}</div>
              <div className="list-item-meta">
                {stateLabel(rec.state)} ·{' '}
                {rec.state === 'progressing'
                  ? `${formatBytes(rec.receivedBytes)} / ${formatBytes(rec.totalBytes)}`
                  : formatBytes(rec.totalBytes || rec.receivedBytes)}
              </div>
              {rec.state === 'progressing' && rec.totalBytes > 0 ? (
                <div className="progress-bar">
                  <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
                </div>
              ) : null}
              <div className="list-item-actions">
                {rec.state === 'progressing' ? (
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => window.api.downloads.cancel(rec.id)}
                    title="Cancel"
                  >
                    ×
                  </button>
                ) : rec.state === 'completed' ? (
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => window.api.downloads.reveal(rec.id)}
                    title="Reveal in Finder"
                  >
                    📁
                  </button>
                ) : null}
              </div>
            </div>
          );
        })
      )}
    </>
  );
}
