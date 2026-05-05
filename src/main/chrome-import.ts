// Import bookmarks + history from Google Chrome on macOS.
//
// Chrome stores user data under ~/Library/Application Support/Google/Chrome/<profile>/
//   Bookmarks  → JSON file
//   History    → SQLite (locked while Chrome is running, so we copy to tmp first)
//
// For SQLite we use sql.js (pure-JS WASM) to avoid native rebuilds.

import { app } from 'electron';
import { promises as fs } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import initSqlJs from 'sql.js';
import type { BookmarksStore } from './storage/bookmarks.js';
import type { HistoryStore } from './storage/history.js';

interface ChromeBookmarkNode {
  type: 'url' | 'folder';
  name: string;
  url?: string;
  children?: ChromeBookmarkNode[];
  date_added?: string;
}

interface ChromeBookmarksFile {
  roots: Record<string, ChromeBookmarkNode>;
}

export interface ImportResult {
  scanned: number;
  imported: number;
  skipped: number;
}

function defaultProfileDir(profile = 'Default'): string {
  return join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome', profile);
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

export async function findChromeProfiles(): Promise<string[]> {
  const root = join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
  if (!(await exists(root))) return [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  const profiles: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'Default' || /^Profile \d+$/.test(entry.name) || entry.name.startsWith('Guest')) {
      if (await exists(join(root, entry.name, 'Bookmarks'))) {
        profiles.push(entry.name);
      }
    }
  }
  return profiles.sort();
}

function flattenBookmarkNode(
  node: ChromeBookmarkNode,
  folderPath: string,
): Array<{ url: string; title: string; folder: string }> {
  if (node.type === 'url' && node.url) {
    return [{ url: node.url, title: node.name || node.url, folder: folderPath }];
  }
  if (node.type === 'folder' && node.children) {
    const next = folderPath ? `${folderPath}/${node.name}` : node.name;
    return node.children.flatMap((c) => flattenBookmarkNode(c, next));
  }
  return [];
}

export async function importBookmarks(
  store: BookmarksStore,
  profile = 'Default',
): Promise<ImportResult> {
  const path = join(defaultProfileDir(profile), 'Bookmarks');
  const raw = await fs.readFile(path, 'utf8');
  const data = JSON.parse(raw) as ChromeBookmarksFile;

  const flat: Array<{ url: string; title: string; folder: string }> = [];
  for (const [rootKey, rootNode] of Object.entries(data.roots ?? {})) {
    if (!rootNode || typeof rootNode !== 'object') continue;
    flat.push(...flattenBookmarkNode(rootNode, rootKey));
  }

  let imported = 0;
  let skipped = 0;
  for (const item of flat) {
    if (await store.hasUrl(item.url)) {
      skipped++;
      continue;
    }
    await store.add({ url: item.url, title: item.title, folder: item.folder });
    imported++;
  }

  return { scanned: flat.length, imported, skipped };
}

const CHROME_EPOCH_OFFSET_US = 11644473600000000n; // microseconds between 1601-01-01 and 1970-01-01

export async function importHistory(
  store: HistoryStore,
  options: {
    profile?: string;
    limit?: number;
  } = {},
): Promise<ImportResult> {
  const profile = options.profile ?? 'Default';
  const limit = options.limit ?? 5000;
  const sourcePath = join(defaultProfileDir(profile), 'History');

  // Chrome locks the DB while running — copy to tmp before opening.
  const tmpPath = join(tmpdir(), `ghostpilot-chrome-history-${randomBytes(6).toString('hex')}.sqlite`);
  await fs.copyFile(sourcePath, tmpPath);

  try {
    // Production: wasm is asar-unpacked next to app.asar. Dev: read from node_modules.
    const candidates = app.isPackaged
      ? [
          join(app.getAppPath() + '.unpacked', 'node_modules/sql.js/dist/sql-wasm.wasm'),
          join(app.getAppPath(), 'node_modules/sql.js/dist/sql-wasm.wasm'),
        ]
      : [join(app.getAppPath(), 'node_modules/sql.js/dist/sql-wasm.wasm')];
    let wasmBinary: Buffer | null = null;
    for (const path of candidates) {
      try {
        wasmBinary = await fs.readFile(path);
        break;
      } catch {
        /* try next */
      }
    }
    if (!wasmBinary) throw new Error('sql.js wasm not found');
    // sql.js types want ArrayBuffer, but the runtime accepts Uint8Array fine.
    const SQL = await initSqlJs({
      wasmBinary: new Uint8Array(wasmBinary).buffer as ArrayBuffer,
    });

    const dbBytes = await fs.readFile(tmpPath);
    const db = new SQL.Database(dbBytes);

    const stmt = db.prepare(
      `SELECT url, title, last_visit_time FROM urls
       WHERE hidden = 0
       ORDER BY last_visit_time DESC
       LIMIT ?`,
    );
    stmt.bind([limit]);

    let scanned = 0;
    let imported = 0;
    while (stmt.step()) {
      const row = stmt.getAsObject() as { url: string; title: string; last_visit_time: number };
      scanned++;
      const visitedAt = Number(BigInt(row.last_visit_time) - CHROME_EPOCH_OFFSET_US) / 1000;
      if (!Number.isFinite(visitedAt) || visitedAt <= 0) continue;
      await store.record({
        url: row.url,
        title: row.title || row.url,
        visitedAt: Math.round(visitedAt),
      });
      imported++;
    }
    stmt.free();
    db.close();

    return { scanned, imported, skipped: scanned - imported };
  } finally {
    await fs.rm(tmpPath, { force: true });
  }
}
