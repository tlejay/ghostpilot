import type { Session, WebContents } from 'electron';

// Per-tab ring buffers for console messages and network requests.
// Console: webContents.on('console-message', ...) — synchronous, no perf concern.
// Network: session.webRequest.onBeforeRequest / onCompleted — fires for every request
// in the partition, mapped back to a tabId via webContentsId.

const CONSOLE_BUFFER = 200;
const NETWORK_BUFFER = 500;

export interface ConsoleEntry {
  level: string; // info | warning | error | debug
  message: string;
  source: string;
  line: number;
  timestamp: number;
}

export interface NetworkEntry {
  id: string; // request id from Electron
  url: string;
  method: string;
  resourceType: string;
  startedAt: number;
  endedAt?: number;
  status?: number;
  fromCache?: boolean;
  error?: string;
}

const LEVEL_NAME = ['debug', 'info', 'warning', 'error'] as const;
function levelFor(level: number | string | undefined): string {
  if (typeof level === 'string') return level;
  if (typeof level === 'number') return LEVEL_NAME[level] ?? 'info';
  return 'info';
}

export class Recorder {
  // tabId → buffers
  private console = new Map<string, ConsoleEntry[]>();
  private network = new Map<string, NetworkEntry[]>();
  // webContents.id → tabId (so session-level webRequest can route)
  private wcToTab = new Map<number, string>();
  // pending requests by network request id
  private pending = new Map<string, NetworkEntry>();

  attachConsole(tabId: string, wc: WebContents): void {
    this.wcToTab.set(wc.id, tabId);
    this.console.set(tabId, []);

    // Electron 33 uses an event object; older signatures pass (e, level, message, line, sourceId).
    // Cast to any to support both APIs without breaking types.
    wc.on('console-message', (...args: unknown[]) => {
      const buf = this.console.get(tabId);
      if (!buf) return;
      let entry: ConsoleEntry;
      const first = args[0] as { level?: number | string; message?: string; lineNumber?: number; sourceId?: string } | undefined;
      if (first && typeof first === 'object' && 'message' in first) {
        // New API: single Event object
        entry = {
          level: levelFor(first.level),
          message: String(first.message ?? ''),
          source: String(first.sourceId ?? ''),
          line: Number(first.lineNumber ?? 0),
          timestamp: Date.now(),
        };
      } else {
        // Old API: (event, level, message, line, sourceId)
        const [, level, message, line, sourceId] = args as [
          unknown,
          number | string,
          string,
          number,
          string,
        ];
        entry = {
          level: levelFor(level),
          message: String(message ?? ''),
          source: String(sourceId ?? ''),
          line: Number(line ?? 0),
          timestamp: Date.now(),
        };
      }
      buf.push(entry);
      if (buf.length > CONSOLE_BUFFER) buf.shift();
    });
  }

  detach(tabId: string, webContentsId?: number): void {
    this.console.delete(tabId);
    this.network.delete(tabId);
    if (webContentsId !== undefined) this.wcToTab.delete(webContentsId);
  }

  // Attach session-level webRequest hooks. Idempotent — call once per session partition.
  attachNetwork(session: Session): void {
    session.webRequest.onBeforeRequest((details, cb) => {
      const tabId = this.wcToTab.get(details.webContentsId ?? -1);
      if (tabId) {
        const entry: NetworkEntry = {
          id: String(details.id),
          url: details.url,
          method: details.method,
          resourceType: details.resourceType,
          startedAt: Date.now(),
        };
        this.pending.set(entry.id, entry);
        const buf = this.network.get(tabId) ?? (this.network.set(tabId, []).get(tabId) as NetworkEntry[]);
        buf.push(entry);
        if (buf.length > NETWORK_BUFFER) buf.shift();
      }
      cb({});
    });

    session.webRequest.onCompleted((details) => {
      const entry = this.pending.get(String(details.id));
      if (entry) {
        entry.endedAt = Date.now();
        entry.status = details.statusCode;
        entry.fromCache = details.fromCache;
        this.pending.delete(entry.id);
      }
    });

    session.webRequest.onErrorOccurred((details) => {
      const entry = this.pending.get(String(details.id));
      if (entry) {
        entry.endedAt = Date.now();
        entry.error = details.error;
        this.pending.delete(entry.id);
      }
    });
  }

  getConsole(tabId: string, level?: string): ConsoleEntry[] {
    const buf = this.console.get(tabId) ?? [];
    if (!level) return [...buf];
    return buf.filter((e) => e.level === level);
  }

  getNetwork(tabId: string, opts?: { method?: string; status?: number; urlIncludes?: string }): NetworkEntry[] {
    const buf = this.network.get(tabId) ?? [];
    let out = [...buf];
    if (opts?.method) {
      const m = opts.method.toUpperCase();
      out = out.filter((e) => e.method === m);
    }
    if (opts?.status) out = out.filter((e) => e.status === opts.status);
    if (opts?.urlIncludes) {
      const q = opts.urlIncludes.toLowerCase();
      out = out.filter((e) => e.url.toLowerCase().includes(q));
    }
    return out;
  }

  clearConsole(tabId: string): void {
    this.console.set(tabId, []);
  }

  clearNetwork(tabId: string): void {
    this.network.set(tabId, []);
  }
}
