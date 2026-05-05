// Sniffs every network response in the active session and keeps a per-tab
// list of anything that looks like playable media (video/audio direct files,
// HLS playlists, DASH manifests). The user can then click "Download" on any
// detected entry — Electron's session.downloadURL replays the request with
// the same cookies, then the existing DownloadManager catches it via
// session.on('will-download').

import type { BrowserWindow, Session } from 'electron';

const VIDEO_MIME = /^video\//i;
const AUDIO_MIME = /^audio\//i;
const HLS_MIME = /application\/vnd\.apple\.mpegurl|application\/x-mpegurl/i;
const DASH_MIME = /application\/dash\+xml/i;

const URL_HINT = /\.(mp4|m4v|mov|webm|mkv|avi|m3u8|mpd|mp3|m4a|ogg|flac|wav|aac|opus)(\?|#|$)/i;

const SKIP_HOSTS = /(?:googlevideo\.com|googletagmanager|google-analytics|doubleclick|gstatic|i\.ytimg)/i;

export type MediaType = 'video' | 'audio' | 'hls' | 'dash' | 'unknown';

export interface MediaEntry {
  id: string;
  url: string;
  filename: string;
  mime: string;
  type: MediaType;
  sizeBytes?: number;
  detectedAt: number;
  pageUrl: string;
}

const MAX_PER_TAB = 100;

function classify(url: string, mime: string): MediaType | null {
  if (VIDEO_MIME.test(mime)) return 'video';
  if (AUDIO_MIME.test(mime)) return 'audio';
  if (HLS_MIME.test(mime)) return 'hls';
  if (DASH_MIME.test(mime)) return 'dash';
  if (URL_HINT.test(url)) {
    const ext = url.match(URL_HINT)?.[1]?.toLowerCase() ?? '';
    if (['m3u8'].includes(ext)) return 'hls';
    if (['mpd'].includes(ext)) return 'dash';
    if (['mp3', 'm4a', 'ogg', 'flac', 'wav', 'aac', 'opus'].includes(ext)) return 'audio';
    if (['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi'].includes(ext)) return 'video';
  }
  return null;
}

function filenameFor(url: string, type: MediaType): string {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '');
    if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return last;
    const host = u.hostname.replace(/^www\./, '');
    const ext = type === 'audio' ? 'mp3' : type === 'hls' ? 'm3u8' : type === 'dash' ? 'mpd' : 'mp4';
    return `${host}-${Date.now()}.${ext}`;
  } catch {
    return `media-${Date.now()}.bin`;
  }
}

function nextId(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

interface DetectorOptions {
  window: BrowserWindow;
  resolveTabId: (webContentsId: number) => string | undefined;
  resolvePageUrl: (tabId: string) => string;
}

export class MediaDetector {
  private byTab = new Map<string, MediaEntry[]>();
  private window: BrowserWindow;
  private resolveTabId: (webContentsId: number) => string | undefined;
  private resolvePageUrl: (tabId: string) => string;

  constructor(opts: DetectorOptions) {
    this.window = opts.window;
    this.resolveTabId = opts.resolveTabId;
    this.resolvePageUrl = opts.resolvePageUrl;
  }

  attach(session: Session): void {
    session.webRequest.onCompleted((details) => {
      try {
        if (details.statusCode < 200 || details.statusCode >= 400) return;
        if (SKIP_HOSTS.test(details.url)) return;

        const headers = details.responseHeaders ?? {};
        const ct = (headers['content-type'] ?? headers['Content-Type'] ?? [''])[0]?.toLowerCase() ?? '';
        const type = classify(details.url, ct);
        if (!type) return;

        const tabId = this.resolveTabId(details.webContentsId ?? -1);
        if (!tabId) return;

        // Dedupe: same URL twice → ignore
        const existing = this.byTab.get(tabId) ?? [];
        if (existing.some((e) => e.url === details.url)) return;

        const sizeHeader = (headers['content-length'] ?? headers['Content-Length'] ?? [])[0];
        const sizeBytes = sizeHeader ? Number(sizeHeader) || undefined : undefined;

        const entry: MediaEntry = {
          id: nextId(),
          url: details.url,
          filename: filenameFor(details.url, type),
          mime: ct || 'application/octet-stream',
          type,
          sizeBytes,
          detectedAt: Date.now(),
          pageUrl: this.resolvePageUrl(tabId),
        };
        const next = [entry, ...existing].slice(0, MAX_PER_TAB);
        this.byTab.set(tabId, next);
        this.broadcast(tabId);
      } catch {
        /* swallow — never break the request pipeline */
      }
    });
  }

  // Clear when a tab navigates to a fresh page so the list isn't polluted by
  // earlier visits within the same tab.
  clearForNavigation(tabId: string, newUrl: string): void {
    const items = this.byTab.get(tabId);
    if (!items || items.length === 0) return;
    const sameOrigin = items.some((e) => {
      try {
        return new URL(e.pageUrl).origin === new URL(newUrl).origin;
      } catch {
        return false;
      }
    });
    if (!sameOrigin) {
      this.byTab.delete(tabId);
      this.broadcast(tabId);
    }
  }

  list(tabId: string): MediaEntry[] {
    return this.byTab.get(tabId) ?? [];
  }

  count(tabId: string): number {
    return this.byTab.get(tabId)?.length ?? 0;
  }

  clear(tabId: string): void {
    this.byTab.delete(tabId);
    this.broadcast(tabId);
  }

  detach(tabId: string): void {
    this.byTab.delete(tabId);
  }

  // Trigger a download via the session's download handler. The existing
  // DownloadManager picks it up via session.on('will-download').
  download(session: Session, url: string): void {
    session.downloadURL(url);
  }

  private broadcast(tabId: string): void {
    if (this.window.isDestroyed()) return;
    this.window.webContents.send('media:updated', {
      tabId,
      items: this.list(tabId),
    });
  }
}
