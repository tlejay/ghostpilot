// Raw CDP-over-WebSocket client for the *external* Chrome instance.
//
// Why this exists: GhostPilot's embedded tabs are Electron WebContentsViews
// driven via `webContents.debugger`. That backend can't touch a SEPARATE
// Chrome process (e.g. ~/.chrome-agent on port 9222 used for LINE). To drive
// both surfaces from one MCP server, we add this thin client and a parallel
// set of ext_* tools.
//
// Design notes:
//   - We use the `ws` package (~150 KB, MIT) for the WebSocket client.
//     Node 20 hides its built-in WebSocket behind --experimental-websocket;
//     Electron 33 ships Node 20.18 so we can't rely on the global. `ws` is
//     the de-facto standard. No heavyweight dep (no puppeteer-core, no
//     chrome-remote-interface) — embedded path also uses raw CDP, so the
//     mental model stays unified.
//   - One ExtBrowserSession per (cdp_url, target_id). Caches are keyed by the
//     ws URL of the target page so back-to-back calls reuse one socket.
//   - 'list_tabs' hits the HTTP /json endpoint (no socket needed).
//   - On WS close (Chrome quit, tab closed) we drop the cache entry so the
//     next call reconnects transparently.

import { request as httpRequest } from 'node:http';
import { URL } from 'node:url';
import WebSocket, { type ErrorEvent } from 'ws';

export interface ExtTabInfo {
  id: string;
  url: string;
  title: string;
  type: string;
  webSocketDebuggerUrl: string;
  /** Convenience flag — first 'page'-type tab is the natural default. */
  active?: boolean;
}

interface PendingResult {
  resolve: (v: unknown) => void;
  reject: (err: Error) => void;
}

/** GET http://host:port/json — Chrome's tab listing. */
export async function listExternalTabs(cdpUrl: string): Promise<ExtTabInfo[]> {
  const u = new URL('/json', cdpUrl);
  const body = await httpGet(u);
  const arr = JSON.parse(body) as Array<Record<string, unknown>>;
  // First 'page' is the natural default. Service workers + iframes show up
  // here too; surface them but flag the first page so callers can pick.
  let firstPageSeen = false;
  return arr.map((t) => {
    const isPage = t.type === 'page';
    const active = isPage && !firstPageSeen;
    if (active) firstPageSeen = true;
    return {
      id: String(t.id ?? ''),
      url: String(t.url ?? ''),
      title: String(t.title ?? ''),
      type: String(t.type ?? ''),
      webSocketDebuggerUrl: String(t.webSocketDebuggerUrl ?? ''),
      active,
    };
  });
}

/** GET http://host:port/json/version — Browser/Protocol-Version. */
export async function externalBrowserVersion(cdpUrl: string): Promise<Record<string, string>> {
  const u = new URL('/json/version', cdpUrl);
  const body = await httpGet(u);
  return JSON.parse(body) as Record<string, string>;
}

function httpGet(url: URL): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: url.hostname,
        port: url.port || 80,
        path: url.pathname + url.search,
        method: 'GET',
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.from(c)));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(Buffer.concat(chunks).toString('utf8'));
          } else {
            reject(new Error(`HTTP ${res.statusCode} from ${url}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error(`Timeout connecting to ${url}`)));
    req.end();
  });
}

/**
 * Resolve the WebSocket URL for the target the caller wants. If `targetId` is
 * given, pick that one (404 if not found). Otherwise default to the first
 * 'page' type tab. This is what most LINE calls will want — the user opens
 * Chrome at chrome-extension://…/index.html#/chats and that's the active page.
 */
export async function resolveTargetWsUrl(opts: {
  cdpUrl: string;
  targetId?: string;
}): Promise<string> {
  const tabs = await listExternalTabs(opts.cdpUrl);
  if (opts.targetId) {
    const hit = tabs.find((t) => t.id === opts.targetId);
    if (!hit) throw new Error(`Target not found: ${opts.targetId}`);
    if (!hit.webSocketDebuggerUrl) throw new Error(`Target has no debugger URL: ${opts.targetId}`);
    return hit.webSocketDebuggerUrl;
  }
  const page = tabs.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page) throw new Error('No page-type tab found at external Chrome');
  return page.webSocketDebuggerUrl;
}

/**
 * A live page-level CDP session over WebSocket. Reused across calls via the
 * SESSION_CACHE below.
 */
export class ExtBrowserSession {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingResult>();
  private readyPromise: Promise<void>;
  private closed = false;

  constructor(public readonly wsUrl: string) {
    this.readyPromise = this.connect();
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error(`Timeout connecting to ${this.wsUrl}`));
      }, 5000);

      ws.on('open', () => {
        clearTimeout(timeout);
        resolve();
      });

      ws.on('error', (err: Error | ErrorEvent) => {
        clearTimeout(timeout);
        const msg = (err as Error).message ?? 'connection failed';
        reject(new Error(`WS error: ${msg}`));
      });

      ws.on('close', () => {
        this.closed = true;
        // Reject every still-pending command so callers don't hang.
        for (const p of this.pending.values()) {
          p.reject(new Error('CDP session closed'));
        }
        this.pending.clear();
        // Eviction from SESSION_CACHE happens via getSession() retry.
        SESSION_CACHE.delete(this.wsUrl);
      });

      ws.on('message', (data: Buffer | string) => {
        let msg: { id?: number; result?: unknown; error?: { message?: string } };
        try {
          msg = JSON.parse(typeof data === 'string' ? data : data.toString('utf8'));
        } catch {
          return;
        }
        if (typeof msg.id !== 'number') return; // events (no id) — ignore for now
        const handler = this.pending.get(msg.id);
        if (!handler) return;
        this.pending.delete(msg.id);
        if (msg.error) {
          handler.reject(new Error(msg.error.message ?? 'CDP error'));
        } else {
          handler.resolve(msg.result ?? null);
        }
      });
    });
  }

  isOpen(): boolean {
    return !this.closed && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /** Send a CDP command and await its result. */
  async send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    await this.readyPromise;
    if (!this.ws || this.closed) throw new Error('CDP session not open');
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
      });
      const payload = JSON.stringify({ id, method, params });
      try {
        this.ws!.send(payload);
      } catch (err) {
        this.pending.delete(id);
        reject(err as Error);
      }
    });
  }

  close(): void {
    if (this.ws && !this.closed) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
    }
  }
}

/** Per-wsUrl session cache. Drops entries on WS close. */
const SESSION_CACHE = new Map<string, ExtBrowserSession>();

export async function getSession(opts: {
  cdpUrl: string;
  targetId?: string;
}): Promise<ExtBrowserSession> {
  const wsUrl = await resolveTargetWsUrl(opts);
  const cached = SESSION_CACHE.get(wsUrl);
  if (cached?.isOpen()) return cached;
  if (cached) SESSION_CACHE.delete(wsUrl);
  const fresh = new ExtBrowserSession(wsUrl);
  SESSION_CACHE.set(wsUrl, fresh);
  // Force-await connect so the caller sees connect errors here, not on first send().
  try {
    await fresh.send('Runtime.evaluate', { expression: '1', returnByValue: true });
  } catch (err) {
    fresh.close();
    SESSION_CACHE.delete(wsUrl);
    throw err;
  }
  return fresh;
}

/** Wipe all cached sessions — useful in tests / shutdown. */
export function closeAllExtSessions(): void {
  for (const s of SESSION_CACHE.values()) s.close();
  SESSION_CACHE.clear();
}
