import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

// Atomic JSON file store. Writes go through a `<file>.tmp` rename to avoid torn files.
export class JsonStore<T> {
  private path: string;
  private fallback: T;
  private cache: T | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(path: string, fallback: T) {
    this.path = path;
    this.fallback = fallback;
  }

  async read(): Promise<T> {
    if (this.cache !== null) return this.cache;
    try {
      const raw = await fs.readFile(this.path, 'utf8');
      this.cache = JSON.parse(raw) as T;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') this.cache = this.fallback;
      else throw err;
    }
    return this.cache as T;
  }

  async write(value: T): Promise<void> {
    this.cache = value;
    // Serialize writes so concurrent updates don't race.
    this.writing = this.writing.then(async () => {
      await fs.mkdir(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
      await fs.rename(tmp, this.path);
    });
    return this.writing;
  }

  async update(fn: (current: T) => T): Promise<T> {
    const current = await this.read();
    const next = fn(current);
    await this.write(next);
    return next;
  }
}
