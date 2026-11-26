import { cp, mkdtemp, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseJsonReport } from '@css-archaeology/core';
import { run, EXIT } from '../packages/cli/src/cli.js';
import { examplesDir } from './helpers.js';

let dir: string;
let out: string[];
let err: string[];
const io = () => ({ stdout: (t: string) => void out.push(t), stderr: (t: string) => void err.push(t), cwd: dir });
const cli = (...args: string[]) => run(args, io());

async function hashTree(root: string, skip = '.css-archaeology'): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const walk = async (d: string) => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      if (entry.name === skip) continue;
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) await walk(p);
      else result[path.relative(root, p)] = createHash('sha256').update(await readFile(p)).digest('hex') + (await stat(p)).mtimeMs;
    }
  };
  await walk(root);
  return result;
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'cssa-cli-'));
  await cp(path.join(examplesDir, 'html-site'), dir, { recursive: true });
  out = [];
  err = [];
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('css-archaeology CLI', () => {
  it('prints help and version', async () => {
    expect(await cli('--help')).toBe(EXIT.ok);
    expect(out.join('')).toContain('css-archaeology scan');
    out = [];
    expect(await cli('--version')).toBe(EXIT.ok);
    expect(out.join('').trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('init writes a valid configuration and refuses to overwrite', async () => {
    expect(await cli('init', '--framework', 'html')).toBe(EXIT.ok);
    const config = JSON.parse(await readFile(path.join(dir, 'css-archaeology.config.json'), 'utf8'));
    expect(config.framework).toBe('html');
    expect(await cli('init')).toBe(EXIT.usage);
    expect(await cli('config', 'validate')).toBe(EXIT.ok);
  });

  it('config validate reports invalid configuration with exit code 2', async () => {
    await writeFile(path.join(dir, 'css-archaeology.config.json'), JSON.stringify({ framework: 'vue', rules: { 'complex-selector': { options: { maxCompounds: 'x' } } } }));
    expect(await cli('config', 'validate')).toBe(EXIT.usage);
    expect(err.join('')).toContain('framework');
    await writeFile(path.join(dir, 'css-archaeology.config.json'), JSON.stringify({ rules: { 'complex-selector': { options: { maxCompounds: 'x' } } } }));
    err = [];
    expect(await cli('config', 'validate')).toBe(EXIT.usage);
    expect(err.join('')).toContain('rules.complex-selector.options.maxCompounds');
  });

  it('scan writes JSON and HTML reports and never modifies source files', async () => {
    const before = await hashTree(dir);
    expect(await cli('scan', '--quiet')).toBe(EXIT.ok);
    expect(await hashTree(dir)).toEqual(before);
    const json = await readFile(path.join(dir, '.css-archaeology/report.json'), 'utf8');
    expect(parseJsonReport(json).ok).toBe(true);
    const html = await readFile(path.join(dir, '.css-archaeology/report.html'), 'utf8');
    expect(html).toContain('<!doctype html>');
    expect(out.join('')).toContain('Potentially unused selectors');
  });

  it('--format json prints a valid report to stdout', async () => {
    expect(await cli('scan', '--format', 'json', '--quiet')).toBe(EXIT.ok);
    const parsed = parseJsonReport(out.join(''));
    expect(parsed.ok).toBe(true);
  });

  it('filters by rule, severity and confidence', async () => {
    await cli('scan', '--format', 'json', '--rule', 'unused-selectors', '--quiet');
    const r1 = JSON.parse(out.join(''));
    expect(new Set(r1.findings.map((f: { rule: string }) => f.rule))).toEqual(new Set(['unused-selector']));
    expect(r1.meta.analyzers).toEqual(['unused-selectors']);
    out = [];
    await cli('scan', '--format', 'json', '--severity', 'medium', '--quiet');
    const r2 = JSON.parse(out.join(''));
    expect(r2.findings.length).toBeGreaterThan(0);
    expect(r2.findings.every((f: { severity: string }) => ['medium', 'high'].includes(f.severity))).toBe(true);
    out = [];
    await cli('scan', '--format', 'json', '--confidence', 'high', '--rule', 'unused-selector', '--quiet');
    const r3 = JSON.parse(out.join(''));
    expect(r3.findings.map((f: { selector: string }) => f.selector).sort()).toEqual(['.btn-secondary', '.legacy-banner']);
  });

  it('returns CI exit codes based on --fail-on', async () => {
    expect(await cli('scan', '--quiet', '--fail-on', 'medium')).toBe(EXIT.findings);
    expect(await cli('scan', '--quiet', '--fail-on', 'high')).toBe(EXIT.ok);
    expect(await cli('scan', '--quiet', '--fail-on', 'none')).toBe(EXIT.ok);
    expect(await cli('scan', '--quiet', '--severity', 'bogus')).toBe(EXIT.usage);
    expect(await cli('scan', '--quiet', '--rule', 'nope')).toBe(EXIT.usage);
    expect(await cli('frobnicate')).toBe(EXIT.usage);
  });

  it('supports exclusion patterns', async () => {
    await cli('scan', '--format', 'json', '--exclude', 'css/components.css', '--quiet');
    const r = JSON.parse(out.join(''));
    expect(r.stylesheets.map((s: { file: string }) => s.file)).not.toContain('css/components.css');
  });

  it('uses the incremental cache on the second scan', async () => {
    await cli('scan', '--format', 'json', '--quiet');
    const first = JSON.parse(out.join(''));
    out = [];
    await cli('scan', '--format', 'json', '--quiet');
    const second = JSON.parse(out.join(''));
    expect(first.meta.cache.hits).toBe(0);
    expect(second.meta.cache.misses).toBe(0);
    expect(second.findings).toEqual(first.findings);
  });

  it('explain shows evidence for a finding id and documentation for a rule', async () => {
    await cli('scan', '--quiet', '--format', 'json');
    const report = JSON.parse(out.join(''));
    const id = report.findings.find((f: { rule: string }) => f.rule === 'duplicate-declaration').id;
    out = [];
    expect(await cli('explain', id)).toBe(EXIT.ok);
    expect(out.join('')).toContain('Evidence');
    expect(out.join('')).toContain('duplicate-declaration');
    out = [];
    expect(await cli('explain', 'overridden-declaration')).toBe(EXIT.ok);
    expect(out.join('')).toContain('Inherited values never override');
    out = [];
    expect(await cli('explain', '--rules')).toBe(EXIT.ok);
    expect(out.join('')).toContain('specificity-escalation');
    expect(await cli('explain', 'CSSA-9999')).toBe(EXIT.usage);
  });

  it('report regenerates HTML and text from the saved JSON', async () => {
    await cli('scan', '--quiet', '--format', 'text');
    out = [];
    expect(await cli('report', '--format', 'html', '--output', 'out/r.html')).toBe(EXIT.ok);
    expect((await readFile(path.join(dir, 'out/r.html'), 'utf8')).startsWith('<!doctype html>')).toBe(true);
    out = [];
    expect(await cli('report', '--format', 'text')).toBe(EXIT.ok);
    expect(out.join('')).toContain('Findings:');
  });

  it('report fails cleanly without a previous scan', async () => {
    expect(await cli('report')).toBe(EXIT.usage);
    expect(err.join('')).toContain('Run `css-archaeology scan` first');
  });
});
