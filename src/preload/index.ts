import { contextBridge, ipcRenderer } from 'electron';

export interface TabInfo {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  active: boolean;
}

export interface HistoryEntry {
  url: string;
  title: string;
  visitedAt: number;
}

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  createdAt: number;
  folder?: string;
}

export interface AutoUpdateState {
  stage: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  releaseNotes?: string;
  releaseUrl?: string;
  progressPercent?: number;
  errorMessage?: string;
}

export interface YtdlpStatus {
  installed: boolean;
  path?: string;
  version?: string;
  error?: string;
}

export interface YtdlpJob {
  id: string;
  url: string;
  filename?: string;
  outputDir: string;
  progressPercent?: number;
  speed?: string;
  eta?: string;
  state: 'starting' | 'downloading' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  endedAt?: number;
  errorMessage?: string;
  resultPath?: string;
}

export interface MediaEntry {
  id: string;
  url: string;
  filename: string;
  mime: string;
  type: 'video' | 'audio' | 'hls' | 'dash' | 'unknown';
  sizeBytes?: number;
  detectedAt: number;
  pageUrl: string;
}

export interface DownloadRecord {
  id: string;
  url: string;
  filename: string;
  savePath: string;
  totalBytes: number;
  receivedBytes: number;
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted';
  startedAt: number;
  endedAt?: number;
}

const onChannel = <T>(channel: string, cb: (payload: T) => void): (() => void) => {
  const listener = (_e: unknown, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

const api = {
  tabs: {
    list: (): Promise<TabInfo[]> => ipcRenderer.invoke('tabs:list'),
    open: (url?: string): Promise<TabInfo> => ipcRenderer.invoke('tabs:new', url),
    close: (id: string): Promise<void> => ipcRenderer.invoke('tabs:close', id),
    activate: (id: string): Promise<void> => ipcRenderer.invoke('tabs:activate', id),
    navigate: (id: string, url: string): Promise<void> =>
      ipcRenderer.invoke('tabs:navigate', id, url),
    back: (id: string): Promise<void> => ipcRenderer.invoke('tabs:back', id),
    forward: (id: string): Promise<void> => ipcRenderer.invoke('tabs:forward', id),
    reload: (id: string): Promise<void> => ipcRenderer.invoke('tabs:reload', id),
    stop: (id: string): Promise<void> => ipcRenderer.invoke('tabs:stop', id),
    toggleDevTools: (id: string): Promise<void> =>
      ipcRenderer.invoke('tabs:devtools', id),
    setToolbarHeight: (height: number): Promise<void> =>
      ipcRenderer.invoke('chrome:set-toolbar-height', height),
    setSidePanelWidth: (width: number): Promise<void> =>
      ipcRenderer.invoke('chrome:set-side-panel-width', width),
    onUpdated: (cb: (tabs: TabInfo[]) => void) => onChannel('tabs:updated', cb),
  },
  history: {
    list: (limit?: number, query?: string): Promise<HistoryEntry[]> =>
      ipcRenderer.invoke('history:list', limit, query),
    clear: (): Promise<void> => ipcRenderer.invoke('history:clear'),
  },
  bookmarks: {
    list: (query?: string): Promise<Bookmark[]> =>
      ipcRenderer.invoke('bookmarks:list', query),
    add: (url: string, title: string, folder?: string): Promise<Bookmark> =>
      ipcRenderer.invoke('bookmarks:add', url, title, folder),
    remove: (id: string): Promise<void> =>
      ipcRenderer.invoke('bookmarks:remove', id),
    removeByUrl: (url: string): Promise<void> =>
      ipcRenderer.invoke('bookmarks:remove-by-url', url),
    has: (url: string): Promise<boolean> => ipcRenderer.invoke('bookmarks:has', url),
  },
  media: {
    list: (tabId?: string): Promise<MediaEntry[]> =>
      ipcRenderer.invoke('media:list', tabId),
    download: (url: string): Promise<boolean> =>
      ipcRenderer.invoke('media:download', url),
    clear: (tabId?: string): Promise<void> =>
      ipcRenderer.invoke('media:clear', tabId),
    onUpdated: (cb: (payload: { tabId: string; items: MediaEntry[] }) => void) =>
      onChannel('media:updated', cb),
  },
  ytdlp: {
    status: (force?: boolean): Promise<YtdlpStatus> =>
      ipcRenderer.invoke('ytdlp:status', force),
    download: (url: string, opts?: { audioOnly?: boolean; format?: string }): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('ytdlp:download', url, opts),
    list: (): Promise<YtdlpJob[]> => ipcRenderer.invoke('ytdlp:list'),
    cancel: (id: string): Promise<boolean> => ipcRenderer.invoke('ytdlp:cancel', id),
    reveal: (id: string): Promise<boolean> => ipcRenderer.invoke('ytdlp:reveal', id),
    clear: (): Promise<void> => ipcRenderer.invoke('ytdlp:clear'),
    onJob: (cb: (job: YtdlpJob) => void) => onChannel('ytdlp:job', cb),
  },
  downloads: {
    list: (limit?: number): Promise<DownloadRecord[]> =>
      ipcRenderer.invoke('downloads:list', limit),
    cancel: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('downloads:cancel', id),
    reveal: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('downloads:reveal', id),
    clear: (): Promise<void> => ipcRenderer.invoke('downloads:clear'),
    onUpdated: (cb: (records: DownloadRecord[]) => void) =>
      onChannel('downloads:updated', cb),
  },
  profile: {
    current: (): Promise<string> => ipcRenderer.invoke('profile:current'),
  },
  chrome: {
    listProfiles: (): Promise<string[]> => ipcRenderer.invoke('chrome:profiles'),
    importBookmarks: (
      profile?: string,
    ): Promise<{ scanned: number; imported: number; skipped: number }> =>
      ipcRenderer.invoke('chrome:import-bookmarks', profile),
    importHistory: (
      profile?: string,
      limit?: number,
    ): Promise<{ scanned: number; imported: number; skipped: number }> =>
      ipcRenderer.invoke('chrome:import-history', profile, limit),
  },
  updates: {
    status: (): Promise<{
      current: string;
      latest: { version: string; url: string; notes?: string } | null;
      upToDate: boolean;
      nagEnabled: boolean;
      lastCheckedAt: number;
    }> => ipcRenderer.invoke('updates:status'),
    check: (
      force?: boolean,
    ): Promise<{
      current: string;
      latest: { version: string; url: string; notes?: string } | null;
      upToDate: boolean;
      nagEnabled: boolean;
      lastCheckedAt: number;
    }> => ipcRenderer.invoke('updates:check', force),
  },
  autoUpdate: {
    state: (): Promise<AutoUpdateState> => ipcRenderer.invoke('autoupdate:state'),
    check: (): Promise<AutoUpdateState> => ipcRenderer.invoke('autoupdate:check'),
    install: (): Promise<void> => ipcRenderer.invoke('autoupdate:install'),
    openReleaseNotes: (version?: string): Promise<void> =>
      ipcRenderer.invoke('autoupdate:release-notes', version),
    onState: (cb: (state: AutoUpdateState) => void) => onChannel('updates:state', cb),
  },
  app: {
    info: (): Promise<{
      name: string;
      version: string;
      electronVersion: string;
      nodeVersion: string;
      chromeVersion: string;
    }> => ipcRenderer.invoke('app:info'),
    notices: (): Promise<unknown[]> => ipcRenderer.invoke('app:notices'),
    openExternal: (url: string): Promise<void> =>
      ipcRenderer.invoke('app:open-external', url),
    openAbout: (): Promise<void> => ipcRenderer.invoke('app:open-about'),
    openLicenses: (): Promise<void> => ipcRenderer.invoke('app:open-licenses'),
  },
  events: {
    onFocusAddressBar: (cb: () => void) => onChannel('focus:address-bar', cb),
    onToggleSidePanel: (cb: () => void) => onChannel('toggle:side-panel', cb),
  },
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
