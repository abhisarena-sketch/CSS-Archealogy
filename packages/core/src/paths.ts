/** Browser-safe POSIX path helpers. Project paths are always relative and `/`-separated. */

export function toPosix(path: string): string {
  return path.replace(/\\/g, '/');
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}

export function extname(path: string): string {
  const base = basename(path);
  const i = base.lastIndexOf('.');
  return i <= 0 ? '' : base.slice(i).toLowerCase();
}

/** Normalise `a/./b/../c` to `a/c`. Returns null when the path escapes the root. */
export function normalisePath(path: string): string | null {
  const out: string[] = [];
  for (const segment of toPosix(path).split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join('/');
}

export function joinPath(...parts: string[]): string | null {
  return normalisePath(parts.filter(Boolean).join('/'));
}

/** Resolve an import specifier relative to the importing file. Bare specifiers return null. */
export function resolveRelative(fromFile: string, specifier: string): string | null {
  const clean = specifier.split(/[?#]/)[0] ?? specifier;
  if (clean.startsWith('/')) return normalisePath(clean.slice(1));
  if (!clean.startsWith('.')) return null;
  return joinPath(dirname(fromFile), clean);
}
