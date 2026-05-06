export interface TabInfo {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  active: boolean;
  pinned: boolean;
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
  stage:
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'error';
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

export interface Api {
  tabs: {
    list(): Promise<TabInfo[]>;
    open(url?: string): Promise<TabInfo>;
    close(id: string): Promise<void>;
    activate(id: string): Promise<void>;
    navigate(id: string, url: string): Promise<void>;
    back(id: string): Promise<void>;
    forward(id: string): Promise<void>;
    reload(id: string): Promise<void>;
    stop(id: string): Promise<void>;
    toggleDevTools(id: string): Promise<void>;
    setToolbarHeight(height: number): Promise<void>;
    setSidePanelWidth(width: number): Promise<void>;
    pin(id: string): Promise<void>;
    unpin(id: string): Promise<void>;
    reorder(id: string, toIndex: number): Promise<void>;
    find(id: string, text: string): Promise<void>;
    findStop(id: string): Promise<void>;
    onUpdated(cb: (tabs: TabInfo[]) => void): () => void;
  };
  history: {
    list(limit?: number, query?: string): Promise<HistoryEntry[]>;
    clear(): Promise<void>;
  };
  bookmarks: {
    list(query?: string): Promise<Bookmark[]>;
    add(url: string, title: string, folder?: string): Promise<Bookmark>;
    remove(id: string): Promise<void>;
    removeByUrl(url: string): Promise<void>;
    has(url: string): Promise<boolean>;
  };
  media: {
    list(tabId?: string): Promise<MediaEntry[]>;
    download(url: string): Promise<boolean>;
    clear(tabId?: string): Promise<void>;
    onUpdated(
      cb: (payload: { tabId: string; items: MediaEntry[] }) => void,
    ): () => void;
  };
  ytdlp: {
    status(force?: boolean): Promise<YtdlpStatus>;
    download(
      url: string,
      opts?: { audioOnly?: boolean; format?: string },
    ): Promise<{ ok: boolean }>;
    list(): Promise<YtdlpJob[]>;
    cancel(id: string): Promise<boolean>;
    reveal(id: string): Promise<boolean>;
    clear(): Promise<void>;
    onJob(cb: (job: YtdlpJob) => void): () => void;
  };
  downloads: {
    list(limit?: number): Promise<DownloadRecord[]>;
    cancel(id: string): Promise<boolean>;
    reveal(id: string): Promise<boolean>;
    clear(): Promise<void>;
    onUpdated(cb: (records: DownloadRecord[]) => void): () => void;
  };
  profile: {
    current(): Promise<string>;
    list(): Promise<string[]>;
    switch(name: string): Promise<void>;
  };
  chrome: {
    listProfiles(): Promise<string[]>;
    importBookmarks(
      profile?: string,
    ): Promise<{ scanned: number; imported: number; skipped: number }>;
    importHistory(
      profile?: string,
      limit?: number,
    ): Promise<{ scanned: number; imported: number; skipped: number }>;
  };
  updates: {
    status(): Promise<{
      current: string;
      latest: { version: string; url: string; notes?: string } | null;
      upToDate: boolean;
      nagEnabled: boolean;
      lastCheckedAt: number;
    }>;
    check(force?: boolean): Promise<{
      current: string;
      latest: { version: string; url: string; notes?: string } | null;
      upToDate: boolean;
      nagEnabled: boolean;
      lastCheckedAt: number;
    }>;
  };
  autoUpdate: {
    state(): Promise<AutoUpdateState>;
    check(): Promise<AutoUpdateState>;
    install(): Promise<void>;
    openReleaseNotes(version?: string): Promise<void>;
    onState(cb: (state: AutoUpdateState) => void): () => void;
  };
  app: {
    info(): Promise<{
      name: string;
      version: string;
      electronVersion: string;
      nodeVersion: string;
      chromeVersion: string;
    }>;
    notices(): Promise<
      Array<{
        name: string;
        version: string;
        license: string;
        author?: string;
        homepage?: string;
        description?: string;
        licenseText?: string;
      }>
    >;
    openExternal(url: string): Promise<void>;
    openAbout(): Promise<void>;
    openLicenses(): Promise<void>;
  };
  events: {
    onFocusAddressBar(cb: () => void): () => void;
    onToggleSidePanel(cb: () => void): () => void;
    onOpenFindBar(cb: () => void): () => void;
  };
}

declare global {
  interface Window {
    api: Api;
  }
}
