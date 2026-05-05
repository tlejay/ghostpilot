// Polls a remote manifest for the latest GhostPilot version and produces a
// short banner string when an update is available. The banner is injected into
// MCP tool responses so the CLI user sees it the next time Claude calls a tool.
//
// Manifest sources (any one):
//   AI_BROWSER_UPDATE_URL=https://example.com/latest.json
//     where the JSON is { "version": "0.3.0", "url": "https://...", "notes": "..." }
//
//   Default = GitHub releases API:
//     https://api.github.com/repos/<owner>/<repo>/releases/latest
//     The API returns { "tag_name": "v0.3.0", "html_url": "...", "body": "..." }.
//
// Disable the nag banner with AI_BROWSER_UPDATE_NAG=off.

import { app } from 'electron';

const DEFAULT_REPO = 'madebytle/ghostpilot';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const REQUEST_TIMEOUT_MS = 8000;

interface LatestInfo {
  version: string;
  url: string;
  notes?: string;
}

function compareSemver(a: string, b: string): number {
  const norm = (v: string) => v.replace(/^v/i, '').split(/[-+]/)[0]?.split('.').map((x) => parseInt(x, 10) || 0) ?? [];
  const A = norm(a);
  const B = norm(b);
  const len = Math.max(A.length, B.length);
  for (let i = 0; i < len; i++) {
    const x = A[i] ?? 0;
    const y = B[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'GhostPilot/update-checker', ...headers },
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export class UpdateChecker {
  private current: string;
  private latest: LatestInfo | null = null;
  private lastCheckAt = 0;
  private checking: Promise<void> | null = null;
  private nagEnabled: boolean;

  constructor() {
    this.current = app.getVersion();
    this.nagEnabled = (process.env.AI_BROWSER_UPDATE_NAG ?? '').toLowerCase() !== 'off';
  }

  async checkNow(force = false): Promise<LatestInfo | null> {
    if (!force && Date.now() - this.lastCheckAt < CHECK_INTERVAL_MS && this.latest !== null) {
      return this.latest;
    }
    if (this.checking) {
      await this.checking;
      return this.latest;
    }
    this.checking = this.doFetch();
    try {
      await this.checking;
    } finally {
      this.checking = null;
    }
    return this.latest;
  }

  private async doFetch(): Promise<void> {
    const customUrl = process.env.AI_BROWSER_UPDATE_URL?.trim();
    try {
      if (customUrl) {
        const data = (await fetchJson(customUrl)) as Partial<LatestInfo>;
        if (data?.version) {
          this.latest = {
            version: String(data.version),
            url: String(data.url ?? ''),
            notes: data.notes ? String(data.notes) : undefined,
          };
        }
      } else {
        const data = (await fetchJson(
          `https://api.github.com/repos/${DEFAULT_REPO}/releases/latest`,
          { Accept: 'application/vnd.github+json' },
        )) as { tag_name?: string; html_url?: string; body?: string };
        if (data?.tag_name) {
          this.latest = {
            version: data.tag_name,
            url: data.html_url ?? '',
            notes: data.body,
          };
        }
      }
    } catch (err) {
      // Offline / 404 / GitHub rate-limited / bogus URL — treat as no update info.
      if (process.env.AI_BROWSER_DEBUG) {
        console.warn('[update-checker] fetch failed:', (err as Error).message);
      }
    }
    this.lastCheckAt = Date.now();
  }

  // Returns banner text if an update is available; otherwise null.
  banner(): string | null {
    if (!this.nagEnabled) return null;
    if (!this.latest) return null;
    if (compareSemver(this.latest.version, this.current) <= 0) return null;
    const lines = [
      `🔔 GhostPilot ${this.latest.version} is available — you're on ${this.current}.`,
      this.latest.url ? `   → ${this.latest.url}` : '',
      `   Run \`pnpm install && pnpm dist\` to upgrade, or set AI_BROWSER_UPDATE_NAG=off to silence this notice.`,
    ].filter(Boolean);
    return lines.join('\n');
  }

  // For the dedicated `check_for_updates` MCP tool.
  status(): {
    current: string;
    latest: LatestInfo | null;
    upToDate: boolean;
    nagEnabled: boolean;
    lastCheckedAt: number;
  } {
    const upToDate = !this.latest || compareSemver(this.latest.version, this.current) <= 0;
    return {
      current: this.current,
      latest: this.latest,
      upToDate,
      nagEnabled: this.nagEnabled,
      lastCheckedAt: this.lastCheckAt,
    };
  }
}
