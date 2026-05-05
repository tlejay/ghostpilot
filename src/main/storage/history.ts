import { join } from 'node:path';
import { app } from 'electron';
import { JsonStore } from './json-store.js';

export interface HistoryEntry {
  url: string;
  title: string;
  visitedAt: number; // epoch ms
}

interface HistoryFile {
  entries: HistoryEntry[];
}

const MAX_ENTRIES = 5000;

export class HistoryStore {
  private store: JsonStore<HistoryFile>;

  constructor(profile: string) {
    const path = join(app.getPath('userData'), 'profiles', profile, 'history.json');
    this.store = new JsonStore<HistoryFile>(path, { entries: [] });
  }

  async record(entry: HistoryEntry): Promise<void> {
    if (!entry.url || entry.url === 'about:blank') return;
    await this.store.update((current) => {
      const last = current.entries[0];
      // Skip noise: identical url visited within 2s
      if (last && last.url === entry.url && entry.visitedAt - last.visitedAt < 2000) {
        return current;
      }
      const entries = [entry, ...current.entries].slice(0, MAX_ENTRIES);
      return { entries };
    });
  }

  async list(limit = 100, query?: string): Promise<HistoryEntry[]> {
    const data = await this.store.read();
    let entries = data.entries;
    if (query) {
      const q = query.toLowerCase();
      entries = entries.filter(
        (e) => e.url.toLowerCase().includes(q) || e.title.toLowerCase().includes(q),
      );
    }
    return entries.slice(0, limit);
  }

  async clear(): Promise<void> {
    await this.store.write({ entries: [] });
  }
}
