import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import { JsonStore } from './json-store.js';

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  createdAt: number;
  folder?: string;
}

interface BookmarksFile {
  items: Bookmark[];
}

export class BookmarksStore {
  private store: JsonStore<BookmarksFile>;

  constructor(profile: string) {
    const path = join(app.getPath('userData'), 'profiles', profile, 'bookmarks.json');
    this.store = new JsonStore<BookmarksFile>(path, { items: [] });
  }

  async add(input: Omit<Bookmark, 'id' | 'createdAt'>): Promise<Bookmark> {
    const bookmark: Bookmark = {
      ...input,
      id: randomUUID(),
      createdAt: Date.now(),
    };
    await this.store.update((current) => {
      // Avoid exact duplicates by url
      const items = current.items.filter((b) => b.url !== bookmark.url);
      return { items: [bookmark, ...items] };
    });
    return bookmark;
  }

  async remove(id: string): Promise<void> {
    await this.store.update((current) => ({
      items: current.items.filter((b) => b.id !== id),
    }));
  }

  async removeByUrl(url: string): Promise<void> {
    await this.store.update((current) => ({
      items: current.items.filter((b) => b.url !== url),
    }));
  }

  async list(query?: string): Promise<Bookmark[]> {
    const data = await this.store.read();
    let items = data.items;
    if (query) {
      const q = query.toLowerCase();
      items = items.filter(
        (b) =>
          b.url.toLowerCase().includes(q) ||
          b.title.toLowerCase().includes(q) ||
          (b.folder ?? '').toLowerCase().includes(q),
      );
    }
    return items;
  }

  async hasUrl(url: string): Promise<boolean> {
    const data = await this.store.read();
    return data.items.some((b) => b.url === url);
  }
}
