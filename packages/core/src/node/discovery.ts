import { open, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import type { CssArchaeologyConfig } from '../config.js';
import { STYLESHEET_EXTENSIONS, UNSUPPORTED_STYLESHEET_EXTENSIONS } from '../engine.js';
import type { SourceFile } from '../types.js';

export const DEFAULT_SOURCE_EXTENSIONS = ['html', 'htm', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts'];

export interface DiscoveryOptions {
  root: string;
  config: CssArchaeologyConfig;
  /** Source extensions handled by adapters (without dots). */
  extensions?: string[];
  /** Hard cap on the number of files read. */
  maxFiles?: number;
}

export interface DiscoveryResult {
  files: SourceFile[];
  discovered: number;
  skipped: { file: string; reason: string }[];
}

const GLOB_CHARS = /[*?[\]{}!]/;

/** Turn configuration exclude entries into fast-glob ignore patterns. */
export function toIgnorePatterns(excludes: string[]): string[] {
  const out = new Set<string>(['**/node_modules/**', '**/.git/**']);
  for (const raw of excludes) {
    const entry = raw.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
    if (!entry) continue;
    if (GLOB_CHARS.test(entry)) {
      out.add(entry);
      if (!entry.startsWith('**/') && !entry.startsWith('/')) out.add(`**/${entry}`);
    } else {
      out.add(`${entry}/**`);
      out.add(entry);
      out.add(`**/${entry}/**`);
      out.add(`**/${entry}`);
    }
  }
  return [...out];
}

async function isBinary(file: string): Promise<boolean> {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    for (let i = 0; i < bytesRead; i++) if (buffer[i] === 0) return true;
    return false;
  } finally {
    await handle.close();
  }
}

/** Run `fn` over `items` with at most `limit` promises in flight. */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Discover and read project files. Never follows symbolic links out of the root,
 * never executes anything, and skips binary or oversized files.
 */
export async function discoverFiles(options: DiscoveryOptions): Promise<DiscoveryResult> {
  const { config } = options;
  const root = path.resolve(options.root);
  const extensions = new Set(
    [
      ...STYLESHEET_EXTENSIONS,
      ...UNSUPPORTED_STYLESHEET_EXTENSIONS,
      ...(options.extensions ?? DEFAULT_SOURCE_EXTENSIONS),
      ...config.tokenScanExtensions,
    ].map((e) => e.toLowerCase()),
  );
  const entries = await fg(config.include, {
    cwd: root,
    ignore: toIgnorePatterns(config.exclude),
    onlyFiles: true,
    dot: true,
    followSymbolicLinks: false,
    unique: true,
    caseSensitiveMatch: true,
    suppressErrors: true,
  });
  const relevant = entries
    .filter((entry) => {
      const base = entry.split('/').pop() ?? entry;
      if (base === 'package.json' || /^tailwind\.config\.(js|cjs|mjs|ts)$/.test(base)) return true;
      const dot = base.lastIndexOf('.');
      return dot > 0 && extensions.has(base.slice(dot + 1).toLowerCase());
    })
    .sort();
  const maxFiles = options.maxFiles ?? 100_000;
  const skipped: { file: string; reason: string }[] = [];
  const selected = relevant.slice(0, maxFiles);
  for (const file of relevant.slice(maxFiles)) skipped.push({ file, reason: `file limit of ${maxFiles} reached` });

  const read = await mapWithConcurrency(selected, config.concurrency, async (relative) => {
    const absolute = path.join(root, relative);
    // Defence in depth: refuse anything that resolves outside the root.
    if (!absolute.startsWith(root + path.sep)) {
      skipped.push({ file: relative, reason: 'outside the project root' });
      return null;
    }
    try {
      const info = await stat(absolute);
      if (info.size > config.maxFileSize) {
        skipped.push({ file: relative, reason: `larger than maxFileSize (${info.size} > ${config.maxFileSize} bytes)` });
        return null;
      }
      if (await isBinary(absolute)) {
        skipped.push({ file: relative, reason: 'binary content' });
        return null;
      }
      const content = await readFile(absolute, 'utf8');
      return { path: relative.split(path.sep).join('/'), content } satisfies SourceFile;
    } catch (error) {
      skipped.push({ file: relative, reason: `could not be read: ${(error as Error).message}` });
      return null;
    }
  });
  return { files: read.filter((f): f is SourceFile => f !== null), discovered: entries.length, skipped };
}
