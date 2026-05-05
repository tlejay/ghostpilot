import { useEffect, useState } from 'react';
import type { MediaEntry, TabInfo, YtdlpJob, YtdlpStatus } from '../types';

interface Props {
  activeTab: TabInfo | undefined;
}

const formatBytes = (n?: number): string => {
  if (!n || n <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
};

const typeLabel = (t: MediaEntry['type']): string => {
  switch (t) {
    case 'video':
      return 'Video';
    case 'audio':
      return 'Audio';
    case 'hls':
      return 'HLS playlist';
    case 'dash':
      return 'DASH manifest';
    default:
      return 'Media';
  }
};

const typeIcon = (t: MediaEntry['type']): string => {
  switch (t) {
    case 'audio':
      return '🎵';
    case 'hls':
    case 'dash':
      return '📡';
    default:
      return '🎬';
  }
};

function jobLine(job: YtdlpJob): string {
  if (job.state === 'completed') return `✓ done · ${job.resultPath ?? ''}`;
  if (job.state === 'failed') return `✗ ${job.errorMessage ?? 'failed'}`;
  if (job.state === 'cancelled') return 'cancelled';
  if (job.progressPercent != null) {
    const pct = Math.round(job.progressPercent);
    return `${pct}%${job.speed ? ` · ${job.speed}` : ''}${job.eta ? ` · ETA ${job.eta}` : ''}`;
  }
  return 'starting…';
}

export function MediaPanel({ activeTab }: Props) {
  const [items, setItems] = useState<MediaEntry[]>([]);
  const [ytdlpStatus, setYtdlpStatus] = useState<YtdlpStatus | null>(null);
  const [jobs, setJobs] = useState<Map<string, YtdlpJob>>(new Map());
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);

  const refresh = () => {
    if (!activeTab) {
      setItems([]);
      return;
    }
    window.api.media.list(activeTab.id).then(setItems);
  };

  useEffect(() => {
    refresh();
    return window.api.media.onUpdated((payload) => {
      if (activeTab && payload.tabId === activeTab.id) setItems(payload.items);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab?.id]);

  useEffect(() => {
    window.api.ytdlp.status().then(setYtdlpStatus);
    window.api.ytdlp.list().then((list) => {
      setJobs(new Map(list.map((j) => [j.id, j])));
    });
    return window.api.ytdlp.onJob((job) => {
      setJobs((prev) => {
        const next = new Map(prev);
        next.set(job.id, job);
        return next;
      });
      if (job.url === pendingUrl) setPendingUrl(null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const directDownload = async (entry: MediaEntry) => {
    setPendingUrl(entry.url);
    try {
      await window.api.media.download(entry.url);
    } finally {
      setPendingUrl(null);
    }
  };

  const ytdlpDownload = async (url: string, audioOnly = false) => {
    if (!ytdlpStatus?.installed) return;
    setPendingUrl(url);
    await window.api.ytdlp.download(url, { audioOnly });
  };

  const downloadEntry = (entry: MediaEntry) => {
    if (entry.type === 'hls' || entry.type === 'dash') {
      ytdlpDownload(entry.url);
    } else {
      directDownload(entry);
    }
  };

  // Show jobs newest-first, dedupe by URL
  const jobList = [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt);
  const activeJobs = jobList.filter(
    (j) => j.state === 'downloading' || j.state === 'starting',
  );

  return (
    <>
      {/* yt-dlp status banner */}
      {ytdlpStatus && !ytdlpStatus.installed ? (
        <div
          style={{
            background: '#3a2f1a',
            border: '1px solid #5a4623',
            color: '#fbbc04',
            padding: '8px 10px',
            borderRadius: 6,
            marginBottom: 10,
            fontSize: 11,
            lineHeight: 1.5,
          }}
        >
          <strong>yt-dlp not installed.</strong> HLS / DASH / YouTube downloads need it.
          <br />
          Install with{' '}
          <code
            style={{
              background: '#000',
              padding: '1px 5px',
              borderRadius: 3,
              cursor: 'pointer',
            }}
            onClick={() => navigator.clipboard.writeText('brew install yt-dlp')}
            title="Click to copy"
          >
            brew install yt-dlp
          </code>
          .
        </div>
      ) : null}

      {/* Active yt-dlp jobs */}
      {activeJobs.length > 0 ? (
        <div style={{ marginBottom: 10 }}>
          {activeJobs.map((job) => (
            <div
              key={job.id}
              style={{
                background: '#1e3a5f',
                border: '1px solid #3a5f8f',
                borderRadius: 6,
                padding: '8px 10px',
                marginBottom: 4,
              }}
            >
              <div style={{ fontSize: 11, color: '#c5d8ff', marginBottom: 4 }}>
                ⬇ yt-dlp · {jobLine(job)}
              </div>
              <div style={{ fontSize: 10, color: '#80868b', wordBreak: 'break-all' }}>
                {job.url}
              </div>
              {job.state === 'downloading' && job.progressPercent != null ? (
                <div className="progress-bar" style={{ marginTop: 4 }}>
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${Math.round(job.progressPercent)}%` }}
                  />
                </div>
              ) : null}
              <button
                type="button"
                className="text-btn"
                style={{ marginTop: 4 }}
                onClick={() => window.api.ytdlp.cancel(job.id)}
              >
                Cancel
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {/* Page-level download button (for YouTube / Twitter / Vimeo etc.) */}
      {activeTab?.url && /^https?:/i.test(activeTab.url) ? (
        <div className="section-actions" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
          <button
            type="button"
            className="text-btn"
            style={{
              background: '#2a1657',
              color: '#c5a8ff',
              padding: '8px',
              fontWeight: 600,
              borderRadius: 6,
            }}
            disabled={!ytdlpStatus?.installed}
            onClick={() => ytdlpDownload(activeTab.url)}
            title={
              ytdlpStatus?.installed
                ? 'Use yt-dlp to download the video on this page (works for YouTube/Twitter/Vimeo/~1500 sites)'
                : 'Install yt-dlp first'
            }
          >
            ⬇ Download this page's video (yt-dlp)
          </button>
          <button
            type="button"
            className="text-btn"
            style={{ background: '#1a3a2a', color: '#a8e0c0', padding: '6px', borderRadius: 6 }}
            disabled={!ytdlpStatus?.installed}
            onClick={() => ytdlpDownload(activeTab.url, true)}
          >
            🎵 Audio only (mp3)
          </button>
        </div>
      ) : null}

      <div className="section-actions" style={{ gap: 4, marginTop: 8 }}>
        <button type="button" className="text-btn" onClick={refresh}>
          Refresh
        </button>
        <button
          type="button"
          className="text-btn"
          onClick={async () => {
            await window.api.media.clear(activeTab?.id);
            refresh();
          }}
        >
          Clear
        </button>
      </div>

      {/* Detected media */}
      {!activeTab ? (
        <div className="empty">No active tab.</div>
      ) : items.length === 0 ? (
        <div className="empty">
          No media detected from network yet.
          <br />
          Play any video on this page — it will show up here.
        </div>
      ) : (
        items.map((entry) => (
          <div key={entry.id} className="list-item">
            <div className="list-item-title">
              {typeIcon(entry.type)} {entry.filename}
            </div>
            <div className="list-item-url">{entry.url}</div>
            <div className="list-item-meta">
              {typeLabel(entry.type)} · {entry.mime} · {formatBytes(entry.sizeBytes)}
            </div>
            <div style={{ marginTop: 6 }}>
              <button
                type="button"
                className="text-btn"
                onClick={() => downloadEntry(entry)}
                disabled={
                  pendingUrl === entry.url ||
                  ((entry.type === 'hls' || entry.type === 'dash') && !ytdlpStatus?.installed)
                }
                style={{ fontWeight: 600 }}
              >
                {pendingUrl === entry.url
                  ? 'Starting…'
                  : entry.type === 'hls' || entry.type === 'dash'
                    ? '⬇ Download via yt-dlp'
                    : '⬇ Download'}
              </button>
            </div>
          </div>
        ))
      )}
    </>
  );
}
