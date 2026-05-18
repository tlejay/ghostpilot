// HAR 1.2 export + shared network-filter logic (Plan #6).
//
// Spec: http://www.softwareishard.com/blog/har-12-spec/
//
// We keep filterEntries() as a pure function so list_network_requests + the
// new export_har tool share one implementation (and tests stay cheap).
//
// v1 caveats baked in:
//   - No response body capture (content.size=-1, no .text). HAR readers
//     (Chrome DevTools, Charles, Postman) handle this fine.
//   - Timings collapse into a single `wait` bucket — Electron's webRequest
//     events give us only request-start + response-end; we don't have DNS /
//     connect / send / receive breakdown without going to CDP Network.* (or
//     opening a separate puppeteer-style trace). Coarse-but-valid is fine.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { NetworkEntry, NetworkFilterOpts } from '../recorder.js';
// `electron` is imported lazily inside defaultHarMeta() so unit tests that
// run outside Electron's main process (plain Node, e.g. `node --test`) can
// import this file without the loader choking on `electron`'s exports.

// ── Filter ─────────────────────────────────────────────────────────────────

/** Compile `opts.urlPattern` once. Returns `null` for "match anything". */
function compileUrlMatcher(opts: NetworkFilterOpts): ((url: string) => boolean) | null {
  const pat = opts.urlPattern ?? opts.urlIncludes;
  if (!pat) return null;
  // Perl-style /…/flags → regex
  if (pat.length >= 2 && pat[0] === '/' && pat.lastIndexOf('/') > 0) {
    const last = pat.lastIndexOf('/');
    const body = pat.slice(1, last);
    const flags = pat.slice(last + 1);
    try {
      const re = new RegExp(body, flags);
      return (u) => re.test(u);
    } catch {
      // Fall through to substring on invalid regex.
    }
  }
  const lower = pat.toLowerCase();
  return (u) => u.toLowerCase().includes(lower);
}

function normalizeStringArray(v: string | string[] | undefined): string[] | null {
  if (v === undefined) return null;
  return (Array.isArray(v) ? v : [v]).map((s) => s.toUpperCase());
}

function normalizeNumberArray(v: number | number[] | undefined): number[] | null {
  if (v === undefined) return null;
  return Array.isArray(v) ? v.slice() : [v];
}

function normalizeSince(v: string | number | undefined): number | null {
  if (v === undefined) return null;
  if (typeof v === 'number') return v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

export function filterEntries(entries: NetworkEntry[], opts: NetworkFilterOpts): NetworkEntry[] {
  const methods = normalizeStringArray(opts.method);
  const statuses = normalizeNumberArray(opts.status);
  const urlMatch = compileUrlMatcher(opts);
  const since = normalizeSince(opts.since);
  const mime = opts.mimeType ? opts.mimeType.toLowerCase() : null;
  const failedOnly = opts.failedOnly === true;

  return entries.filter((e) => {
    if (methods && !methods.includes(e.method.toUpperCase())) return false;
    if (statuses && (e.status === undefined || !statuses.includes(e.status))) return false;
    if (urlMatch && !urlMatch(e.url)) return false;
    if (since !== null && e.startedAt < since) return false;
    if (mime && !(e.mimeType ?? '').toLowerCase().includes(mime)) return false;
    if (failedOnly && !((e.status ?? 0) >= 400 || e.error)) return false;
    return true;
  });
}

// ── HAR 1.2 mapper ─────────────────────────────────────────────────────────

interface HarNameValue {
  name: string;
  value: string;
}

interface HarEntry {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    httpVersion: string;
    cookies: never[];
    headers: HarNameValue[];
    queryString: HarNameValue[];
    headersSize: number;
    bodySize: number;
  };
  response: {
    status: number;
    statusText: string;
    httpVersion: string;
    cookies: never[];
    headers: HarNameValue[];
    content: { size: number; mimeType: string };
    redirectURL: string;
    headersSize: number;
    bodySize: number;
  };
  cache: Record<string, never>;
  timings: {
    blocked: number;
    dns: number;
    connect: number;
    send: number;
    wait: number;
    receive: number;
    ssl: number;
  };
  _error?: string;
}

export interface HarLog {
  log: {
    version: '1.2';
    creator: { name: string; version: string };
    browser: { name: string; version: string };
    pages: never[];
    entries: HarEntry[];
  };
}

function headerMapToList(
  headers: Record<string, string | string[]> | undefined,
): HarNameValue[] {
  if (!headers) return [];
  const out: HarNameValue[] = [];
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const v of value) out.push({ name, value: String(v) });
    } else if (value !== undefined && value !== null) {
      out.push({ name, value: String(value) });
    }
  }
  return out;
}

function parseQueryString(url: string): HarNameValue[] {
  try {
    const u = new URL(url);
    const out: HarNameValue[] = [];
    u.searchParams.forEach((value, name) => out.push({ name, value }));
    return out;
  } catch {
    return [];
  }
}

function parseStatusText(statusLine: string | undefined): string {
  if (!statusLine) return '';
  // "HTTP/1.1 200 OK" → "OK"
  const m = statusLine.match(/^HTTP\/[\d.]+\s+\d+\s+(.*)$/);
  return m ? m[1] : '';
}

function redirectURLFromHeaders(headers: Record<string, string | string[]> | undefined): string {
  if (!headers) return '';
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'location') {
      const val = Array.isArray(v) ? v[0] : v;
      if (typeof val === 'string') return val;
    }
  }
  return '';
}

export interface HarMeta {
  creatorName?: string;
  creatorVersion?: string;
  browserName?: string;
  browserVersion?: string;
}

export function toHar(entries: NetworkEntry[], meta: HarMeta = {}): HarLog {
  const harEntries: HarEntry[] = entries.map((e) => {
    const start = e.startedAt;
    const end = e.endedAt ?? start;
    const elapsed = Math.max(0, end - start);
    const httpVersion = e.httpVersion ?? 'HTTP/1.1';
    const entry: HarEntry = {
      startedDateTime: new Date(start).toISOString(),
      time: elapsed,
      request: {
        method: e.method,
        url: e.url,
        httpVersion,
        cookies: [],
        headers: headerMapToList(e.requestHeaders),
        queryString: parseQueryString(e.url),
        headersSize: -1,
        bodySize: -1,
      },
      response: {
        status: e.status ?? 0,
        statusText: parseStatusText(e.statusLine),
        httpVersion,
        cookies: [],
        headers: headerMapToList(e.responseHeaders),
        content: { size: -1, mimeType: e.mimeType ?? '' },
        redirectURL: redirectURLFromHeaders(e.responseHeaders),
        headersSize: -1,
        bodySize: -1,
      },
      cache: {},
      timings: {
        blocked: -1,
        dns: -1,
        connect: -1,
        send: 0,
        wait: elapsed,
        receive: 0,
        ssl: -1,
      },
    };
    if (e.error) entry._error = e.error;
    return entry;
  });

  return {
    log: {
      version: '1.2',
      creator: {
        name: meta.creatorName ?? 'GhostPilot',
        version: meta.creatorVersion ?? '0.3.0',
      },
      browser: {
        name: meta.browserName ?? 'Electron',
        version: meta.browserVersion ?? '33.4.11',
      },
      pages: [],
      entries: harEntries,
    },
  };
}

// ── Disk write helper ─────────────────────────────────────────────────────

export function defaultHarPath(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(tmpdir(), `ghostpilot-har-${stamp}.har`);
}

export async function writeHar(
  filePath: string,
  har: HarLog,
  pretty = false,
): Promise<{ path: string; size_bytes: number; entries: number }> {
  const json = pretty ? JSON.stringify(har, null, 2) : JSON.stringify(har);
  await fsp.writeFile(filePath, json, 'utf8');
  const stat = await fsp.stat(filePath);
  return { path: filePath, size_bytes: stat.size, entries: har.log.entries.length };
}

/** Pull live app metadata (used by the MCP tool wiring; tests bypass this).
 *  Lazy-requires `electron` so this module is safely importable from plain
 *  Node test runners. */
export function defaultHarMeta(): HarMeta {
  let appVersion = '0.3.0';
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as { app: { getVersion(): string } };
    appVersion = app.getVersion();
  } catch {
    /* not running under Electron (tests) — fall back to hardcoded */
  }
  const electronVersion = process.versions.electron ?? '33.4.11';
  return {
    creatorName: 'GhostPilot',
    creatorVersion: appVersion,
    browserName: 'Electron',
    browserVersion: electronVersion,
  };
}
