// Mirrored from src/preload/index.d.ts so the renderer can import without cross-project includes.
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
