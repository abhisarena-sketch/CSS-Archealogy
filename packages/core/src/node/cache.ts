import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AnalysisCache } from '../plugins.js';
import { VERSION } from '../version.js';

interface CacheFile {
  version: string;
  entries: Record<string, unknown>;
}

/**
 * JSON file cache for incremental scans. Entries that were not used during a scan
 * are dropped on save so the cache does not grow without bound.
 */
export class FileCache implements AnalysisCache {
  private entries = new Map<string, unknown>();
  private used = new Set<string>();
  private dirty = false;

  constructor(private readonly file: string) {}

  static async load(file: string): Promise<FileCache> {
    const cache = new FileCache(file);
    try {
      const data = JSON.parse(await readFile(file, 'utf8')) as CacheFile;
      if (data.version === VERSION && data.entries && typeof data.entries === 'object') {
        for (const [k, v] of Object.entries(data.entries)) cache.entries.set(k, v);
      }
    } catch {
      // Missing or corrupt cache: start empty.
    }
    return cache;
  }

  get(key: string): unknown {
    const value = this.entries.get(key);
    if (value !== undefined) this.used.add(key);
    return value;
  }

  set(key: string, value: unknown): void {
    this.entries.set(key, value);
    this.used.add(key);
    this.dirty = true;
  }

  get size(): number {
    return this.entries.size;
  }

  async save(): Promise<void> {
    const pruned = [...this.entries.keys()].some((k) => !this.used.has(k));
    if (!this.dirty && !pruned) return;
    const entries: Record<string, unknown> = {};
    for (const key of this.used) entries[key] = this.entries.get(key);
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify({ version: VERSION, entries } satisfies CacheFile));
    await rename(tmp, this.file);
  }
}
