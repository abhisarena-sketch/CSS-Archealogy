import { unzipSync, type UnzipFileInfo } from 'fflate';

export interface ProjectFile {
  path: string;
  content: string;
}

export const LIMITS = {
  /** Size of the uploaded archive. */
  maxArchiveBytes: 25 * 1024 * 1024,
  maxEntries: 20_000,
  /** Uncompressed size of one file. */
  maxFileBytes: 2 * 1024 * 1024,
  /** Uncompressed size of all extracted files. */
  maxTotalBytes: 100 * 1024 * 1024,
  /** Compression ratio above which an entry is treated as a zip bomb. */
  maxRatio: 200,
};
export type Limits = typeof LIMITS;

export const ANALYSABLE_EXTENSIONS = new Set([
  'css', 'scss', 'pcss', 'postcss', 'html', 'htm', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts',
  'vue', 'svelte', 'astro', 'php', 'erb', 'hbs', 'handlebars', 'twig', 'njk', 'liquid', 'md', 'mdx', 'ejs', 'pug',
]);
const IGNORED_DIRECTORIES = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', 'coverage', '.css-archaeology', '__MACOSX']);

export class ArchiveError extends Error {}

/**
 * Validate an archive entry name. Rejects absolute paths, drive letters, `..`
 * segments, NUL bytes and backslash tricks, so nothing can escape the virtual root.
 * Files are only ever held in memory, but the check keeps paths in reports honest.
 */
export function safeEntryPath(name: string): { ok: true; path: string } | { ok: false; reason: string } {
  if (name.includes('\0')) return { ok: false, reason: 'contains a NUL byte' };
  const normalised = name.replace(/\\/g, '/');
  if (normalised.startsWith('/') || /^[a-zA-Z]:/.test(normalised)) return { ok: false, reason: 'absolute path' };
  const segments = normalised.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.some((s) => s === '..')) return { ok: false, reason: 'path traversal (..)' };
  if (segments.length === 0) return { ok: false, reason: 'empty path' };
  return { ok: true, path: segments.join('/') };
}

function wanted(path: string): string | null {
  const segments = path.split('/');
  if (segments.some((s) => IGNORED_DIRECTORIES.has(s))) return 'ignored directory';
  const base = segments[segments.length - 1]!;
  if (base === 'package.json' || /^tailwind\.config\.(js|cjs|mjs|ts)$/.test(base)) return null;
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || !ANALYSABLE_EXTENSIONS.has(base.slice(dot + 1).toLowerCase())) return 'not an analysable file type';
  return null;
}

/** Strip a single shared top-level folder, as produced by "Download ZIP" on most hosts. */
export function stripCommonRoot(files: ProjectFile[]): ProjectFile[] {
  if (files.length === 0) return files;
  const first = files[0]!.path.split('/')[0]!;
  if (!files.every((f) => f.path.startsWith(`${first}/`))) return files;
  return files.map((f) => ({ ...f, path: f.path.slice(first.length + 1) }));
}

const decoder = new TextDecoder('utf-8', { fatal: false });

function decode(bytes: Uint8Array): string | null {
  const head = bytes.subarray(0, Math.min(bytes.length, 4096));
  for (const b of head) if (b === 0) return null;
  return decoder.decode(bytes);
}

export interface ExtractResult {
  files: ProjectFile[];
  skipped: { file: string; reason: string }[];
  totalBytes: number;
}

/** Extract a ZIP archive in memory with size, ratio, entry-count and path checks. */
export function extractZip(data: Uint8Array, limits: Limits = LIMITS): ExtractResult {
  if (data.byteLength > limits.maxArchiveBytes) {
    throw new ArchiveError(`Archive is ${(data.byteLength / 1024 / 1024).toFixed(1)} MB; the limit is ${limits.maxArchiveBytes / 1024 / 1024} MB. Use the CLI for larger projects.`);
  }
  const skipped: ExtractResult['skipped'] = [];
  let entries = 0;
  let declaredTotal = 0;
  const accepted = new Map<string, string>();
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(data, {
      filter(file: UnzipFileInfo) {
        entries++;
        if (entries > limits.maxEntries) throw new ArchiveError(`Archive has more than ${limits.maxEntries} entries.`);
        if (file.name.endsWith('/')) return false;
        const safe = safeEntryPath(file.name);
        if (!safe.ok) {
          skipped.push({ file: file.name, reason: `rejected: ${safe.reason}` });
          return false;
        }
        const reason = wanted(safe.path);
        if (reason) return false;
        if (file.originalSize > limits.maxFileBytes) {
          skipped.push({ file: safe.path, reason: `larger than ${limits.maxFileBytes / 1024 / 1024} MB` });
          return false;
        }
        if (file.size > 0 && file.originalSize / file.size > limits.maxRatio) {
          skipped.push({ file: safe.path, reason: 'suspicious compression ratio' });
          return false;
        }
        declaredTotal += file.originalSize;
        if (declaredTotal > limits.maxTotalBytes) throw new ArchiveError(`Archive expands to more than ${limits.maxTotalBytes / 1024 / 1024} MB.`);
        accepted.set(file.name, safe.path);
        return true;
      },
    });
  } catch (error) {
    if (error instanceof ArchiveError) throw error;
    throw new ArchiveError(`Could not read the ZIP archive: ${(error as Error).message}`);
  }
  const files: ProjectFile[] = [];
  let totalBytes = 0;
  for (const [name, bytes] of Object.entries(raw)) {
    const path = accepted.get(name);
    if (!path) continue;
    // Declared sizes can lie: check the real decompressed size too.
    if (bytes.byteLength > limits.maxFileBytes) {
      skipped.push({ file: path, reason: 'decompressed size exceeds the per-file limit' });
      continue;
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > limits.maxTotalBytes) throw new ArchiveError('Archive expands beyond the total size limit.');
    const content = decode(bytes);
    if (content === null) {
      skipped.push({ file: path, reason: 'binary content' });
      continue;
    }
    files.push({ path, content });
  }
  return { files: stripCommonRoot(files).sort((a, b) => a.path.localeCompare(b.path)), skipped, totalBytes };
}

/** Read files chosen with a directory picker (webkitdirectory), applying the same checks. */
export async function readFileList(list: ArrayLike<File & { webkitRelativePath?: string }>, limits: Limits = LIMITS): Promise<ExtractResult> {
  const files: ProjectFile[] = [];
  const skipped: ExtractResult['skipped'] = [];
  let totalBytes = 0;
  if (list.length > limits.maxEntries) throw new ArchiveError(`Folder has more than ${limits.maxEntries} files.`);
  for (let i = 0; i < list.length; i++) {
    const file = list[i]!;
    const safe = safeEntryPath(file.webkitRelativePath || file.name);
    if (!safe.ok || wanted(safe.path)) continue;
    if (file.size > limits.maxFileBytes) {
      skipped.push({ file: safe.path, reason: 'larger than the per-file limit' });
      continue;
    }
    totalBytes += file.size;
    if (totalBytes > limits.maxTotalBytes) throw new ArchiveError('Folder exceeds the total size limit. Use the CLI for larger projects.');
    const content = decode(new Uint8Array(await file.arrayBuffer()));
    if (content === null) skipped.push({ file: safe.path, reason: 'binary content' });
    else files.push({ path: safe.path, content });
  }
  return { files: stripCommonRoot(files).sort((a, b) => a.path.localeCompare(b.path)), skipped, totalBytes };
}
