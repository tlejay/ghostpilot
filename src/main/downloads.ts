import { app, type BrowserWindow, type DownloadItem, type Session, shell } from 'electron';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { JsonStore } from './storage/json-store.js';

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

interface DownloadsFile {
  records: DownloadRecord[];
}

const MAX_RECORDS = 500;

export class DownloadManager {
  private store: JsonStore<DownloadsFile>;
  private active = new Map<string, DownloadItem>();
  private window: BrowserWindow;

  constructor(window: BrowserWindow, profile: string) {
    this.window = window;
    const path = join(app.getPath('userData'), 'profiles', profile, 'downloads.json');
    this.store = new JsonStore<DownloadsFile>(path, { records: [] });
  }

  attach(session: Session): void {
    session.on('will-download', (_event, item) => this.handle(item));
  }

  private async handle(item: DownloadItem): Promise<void> {
    const id = randomUUID();
    this.active.set(id, item);

    const record: DownloadRecord = {
      id,
      url: item.getURL(),
      filename: item.getFilename(),
      savePath: item.getSavePath(),
      totalBytes: item.getTotalBytes(),
      receivedBytes: 0,
      state: 'progressing',
      startedAt: Date.now(),
    };

    await this.append(record);

    item.on('updated', async (_e, state) => {
      record.receivedBytes = item.getReceivedBytes();
      record.totalBytes = item.getTotalBytes();
      record.savePath = item.getSavePath();
      if (state === 'interrupted') record.state = 'interrupted';
      await this.upsert(record);
    });

    item.once('done', async (_e, state) => {
      record.state =
        state === 'completed'
          ? 'completed'
          : state === 'cancelled'
            ? 'cancelled'
            : 'interrupted';
      record.endedAt = Date.now();
      record.savePath = item.getSavePath();
      this.active.delete(id);
      await this.upsert(record);
    });
  }

  async list(limit = 100): Promise<DownloadRecord[]> {
    const data = await this.store.read();
    return data.records.slice(0, limit);
  }

  async clear(): Promise<void> {
    // Only remove finished entries; keep in-flight ones
    await this.store.update((current) => ({
      records: current.records.filter((r) => r.state === 'progressing'),
    }));
    this.broadcast();
  }

  async cancel(id: string): Promise<boolean> {
    const item = this.active.get(id);
    if (!item) return false;
    item.cancel();
    return true;
  }

  async revealInFinder(id: string): Promise<boolean> {
    const data = await this.store.read();
    const rec = data.records.find((r) => r.id === id);
    if (!rec || rec.state !== 'completed') return false;
    shell.showItemInFolder(rec.savePath);
    return true;
  }

  private async append(record: DownloadRecord): Promise<void> {
    await this.store.update((current) => ({
      records: [record, ...current.records].slice(0, MAX_RECORDS),
    }));
    this.broadcast();
  }

  private async upsert(record: DownloadRecord): Promise<void> {
    await this.store.update((current) => ({
      records: current.records.map((r) => (r.id === record.id ? { ...record } : r)),
    }));
    this.broadcast();
  }

  private broadcast(): void {
    if (!this.window.isDestroyed()) {
      this.list().then((records) => {
        if (!this.window.isDestroyed()) {
          this.window.webContents.send('downloads:updated', records);
        }
      });
    }
  }
}
