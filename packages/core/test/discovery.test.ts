import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config.js';
import { discoverFiles, toIgnorePatterns, mapWithConcurrency } from '../src/node/discovery.js';
import { loadConfig, ConfigFileError } from '../src/node/config-file.js';
import { FileCache } from '../src/node/cache.js';

let root: string;
let outside: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'cssa-disc-'));
  outside = await mkdtemp(path.join(tmpdir(), 'cssa-outside-'));
  const files: Record<string, string> = {
    'src/app.css': '.a{color:red}',
    'src/App.tsx': 'export const A = () => <div className="a" />;',
    'src/legacy/old.css': '.old{}',
    'src/theme.less': '@a: 1;',
    'node_modules/lib/x.css': '.x{}',
    'dist/out.css': '.y{}',
    'src/image.png': 'not really',
    'big.css': '.b{}'.repeat(500),
    'package.json': '{"dependencies":{"react":"18"}}',
  };
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await writeFile(path.join(root, rel), content);
  }
  await writeFile(path.join(root, 'src/bin.css'), Buffer.from([0x2e, 0x61, 0x00, 0x7b]));
  await writeFile(path.join(outside, 'secret.css'), '.secret{}');
  await symlink(outside, path.join(root, 'src/linked'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe('discoverFiles', () => {
  it('honours include/exclude, size limits, binary detection and symlinks', async () => {
    const config = resolveConfig({ exclude: ['node_modules', 'dist', 'src/legacy/**'], maxFileSize: 1000 });
    const result = await discoverFiles({ root, config });
    const paths = result.files.map((f) => f.path).sort();
    expect(paths).toEqual(['package.json', 'src/App.tsx', 'src/app.css', 'src/theme.less']);
    const reasons = Object.fromEntries(result.skipped.map((s) => [s.file, s.reason]));
    expect(reasons['big.css']).toMatch(/maxFileSize/);
    expect(reasons['src/bin.css']).toBe('binary content');
    expect(paths.some((p) => p.includes('secret'))).toBe(false);
  });

  it('restricts to include patterns', async () => {
    const config = resolveConfig({ include: ['src/**/*.css'] });
    const result = await discoverFiles({ root, config });
    expect(result.files.map((f) => f.path).sort()).toEqual(['src/app.css', 'src/legacy/old.css']);
  });

  it('builds ignore patterns for bare names and globs', () => {
    expect(toIgnorePatterns(['.next', 'src/*.gen.css'])).toEqual(
      expect.arrayContaining(['**/.next/**', '**/node_modules/**', 'src/*.gen.css', '**/src/*.gen.css']),
    );
  });

  it('limits concurrency', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency([...Array(20).keys()], 3, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
    });
    expect(peak).toBe(3);
  });
});

describe('loadConfig', () => {
  it('uses defaults when no file exists and validates JSON files', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cssa-cfg-'));
    expect((await loadConfig(dir)).path).toBeNull();
    await writeFile(path.join(dir, 'css-archaeology.config.json'), '{"framework":"react","safelist":["keep"]}');
    const loaded = await loadConfig(dir);
    expect(loaded.config.framework).toBe('react');
    await writeFile(path.join(dir, 'css-archaeology.config.json'), '{"framework":"vue"}');
    await expect(loadConfig(dir)).rejects.toBeInstanceOf(ConfigFileError);
    await writeFile(path.join(dir, 'css-archaeology.config.json'), '{ not json');
    await expect(loadConfig(dir)).rejects.toThrow(/not valid JSON/);
    await expect(loadConfig(dir, 'cssa.config.js')).rejects.toThrow(/would execute code/);
    await rm(dir, { recursive: true, force: true });
  });
});

describe('FileCache', () => {
  it('persists used entries and prunes unused ones', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cssa-cache-'));
    const file = path.join(dir, 'cache.json');
    const a = await FileCache.load(file);
    a.set('one', { v: 1 });
    a.set('two', { v: 2 });
    await a.save();
    const b = await FileCache.load(file);
    expect(b.get('one')).toEqual({ v: 1 });
    await b.save();
    const c = await FileCache.load(file);
    expect(c.size).toBe(1);
    expect(c.get('two')).toBeUndefined();
    await rm(dir, { recursive: true, force: true });
  });
});
