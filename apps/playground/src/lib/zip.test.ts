import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { ArchiveError, LIMITS, extractZip, safeEntryPath, stripCommonRoot } from './zip';

describe('safeEntryPath', () => {
  it.each([
    ['../evil.css', 'path traversal (..)'],
    ['src/../../evil.css', 'path traversal (..)'],
    ['..\\evil.css', 'path traversal (..)'],
    ['/etc/passwd', 'absolute path'],
    ['C:/Windows/x.css', 'absolute path'],
    ['\\\\server\\share\\x.css', 'absolute path'],
    ['a\0b.css', 'contains a NUL byte'],
    ['./', 'empty path'],
  ])('rejects %j', (name, reason) => {
    expect(safeEntryPath(name)).toEqual({ ok: false, reason });
  });

  it('normalises harmless segments', () => {
    expect(safeEntryPath('./src//styles/./a.css')).toEqual({ ok: true, path: 'src/styles/a.css' });
  });
});

describe('stripCommonRoot', () => {
  it('strips one shared top-level folder only', () => {
    expect(stripCommonRoot([{ path: 'repo/a.css', content: '' }, { path: 'repo/src/b.tsx', content: '' }]).map((f) => f.path)).toEqual(['a.css', 'src/b.tsx']);
    expect(stripCommonRoot([{ path: 'a/x.css', content: '' }, { path: 'b/y.css', content: '' }]).map((f) => f.path)).toEqual(['a/x.css', 'b/y.css']);
  });
});

describe('extractZip', () => {
  const zip = (entries: Record<string, string | Uint8Array>) =>
    zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v])));

  it('extracts analysable files, strips the root and ignores the rest', () => {
    const result = extractZip(
      zip({
        'project/src/app.css': '.a { color: red }',
        'project/index.html': '<div class="a"></div>',
        'project/logo.png': new Uint8Array([137, 80, 78, 71]),
        'project/node_modules/lib/x.css': '.x {}',
      }),
    );
    expect(result.files.map((f) => f.path)).toEqual(['index.html', 'src/app.css']);
  });

  it('rejects traversal entries and reports them', () => {
    const result = extractZip(zip({ 'ok.css': '.a{}', '../evil.css': '.evil{}' }));
    expect(result.files.map((f) => f.path)).toEqual(['ok.css']);
    expect(result.skipped).toContainEqual({ file: '../evil.css', reason: 'rejected: path traversal (..)' });
  });

  it('skips binary content with a text extension', () => {
    const result = extractZip(zip({ 'a.css': new Uint8Array([46, 97, 0, 0, 1]) }));
    expect(result.files).toEqual([]);
    expect(result.skipped[0]?.reason).toBe('binary content');
  });

  it('enforces the per-file, ratio, entry and archive limits', () => {
    const big = 'a'.repeat(5000);
    const limits = { ...LIMITS, maxFileBytes: 1000 };
    expect(extractZip(zip({ 'big.css': big }), limits).skipped[0]?.reason).toMatch(/larger than/);

    const ratio = extractZip(zip({ 'bomb.css': 'a'.repeat(500_000) }));
    expect(ratio.skipped[0]?.reason).toBe('suspicious compression ratio');

    const many = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`f${i}.css`, '.a{}']));
    expect(() => extractZip(zip(many), { ...LIMITS, maxEntries: 5 })).toThrow(ArchiveError);

    expect(() => extractZip(new Uint8Array(2000), { ...LIMITS, maxArchiveBytes: 1000 })).toThrow(/limit/);
  });

  it('reports a corrupt archive as an ArchiveError', () => {
    expect(() => extractZip(strToU8('not a zip at all'))).toThrow(ArchiveError);
  });
});
