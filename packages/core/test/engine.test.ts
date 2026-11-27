import { describe, expect, it } from 'vitest';
import { analyzeProject, type Analyzer } from '../src/index.js';
import { parseJsonReport, toJsonReport } from '../src/report/json.js';
import { toHtmlReport } from '../src/report/html.js';
import { ConfigError } from '../src/config.js';
import { z } from 'zod';

const important: Analyzer = {
  id: 'test-important',
  configKey: 'complexity',
  title: 'Important',
  description: 'test analyzer',
  rules: [{ id: 'test-important', title: 'Important', description: 'x', defaultSeverity: 'low', optionsSchema: z.object({ max: z.number().default(0) }).strict() }],
  run(ctx) {
    const { options } = ctx.rule<{ max: number }>('test-important');
    return ctx.project.declarations
      .filter((d) => d.important)
      .slice(options.max)
      .map((d) => ({
        rule: 'test-important',
        severity: 'low' as const,
        baseConfidence: 0.9,
        title: `!important on ${d.prop}`,
        description: 'Uses !important.',
        file: d.file,
        line: d.line,
        column: d.column,
        selector: ctx.project.rules[d.ruleIndex]!.selectorText,
        property: d.prop,
        evidence: [{ kind: 'declaration' as const, message: 'declared here', file: d.file, line: d.line, snippet: `${d.prop}: ${d.value} !important` }],
        suggestion: 'Avoid !important.',
      }));
  },
};

const files = [
  { path: 'b.css', content: '.b { color: red !important; }\n' },
  { path: 'a.css', content: '.a { color: blue !important; }\n.c { color: <script> }\n' },
  { path: 'bad.css', content: '.x { color: red' },
];

describe('analyzeProject', () => {
  it('runs analyzers and assigns sorted ids and fingerprints', async () => {
    const result = await analyzeProject({ files, analyzers: [important], now: () => new Date('2026-01-01T00:00:00Z') });
    const own = result.findings.filter((f) => f.rule === 'test-important');
    expect(own.map((f) => [f.id, f.file])).toEqual([
      ['CSSA-0001', 'a.css'],
      ['CSSA-0002', 'b.css'],
    ]);
    expect(own[0]!.confidence).toBe('high');
    expect(new Set(result.findings.map((f) => f.fingerprint)).size).toBe(result.findings.length);
    expect(result.summary.stylesheets).toBe(3);
    expect(result.summary.byRule['parse-error']).toBe(1);
    expect(result.meta.generatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('applies severity overrides, rule toggles, options and analysis toggles', async () => {
    const r1 = await analyzeProject({ files, analyzers: [important], config: { rules: { 'test-important': 'high' } } });
    expect(r1.findings.filter((f) => f.rule === 'test-important').every((f) => f.severity === 'high')).toBe(true);
    const r2 = await analyzeProject({ files, analyzers: [important], config: { rules: { 'test-important': 'off', 'parse-error': 'off' } } });
    expect(r2.findings).toHaveLength(0);
    const r3 = await analyzeProject({ files, analyzers: [important], config: { analysis: { complexity: false } } });
    expect(r3.findings.filter((f) => f.rule === 'test-important')).toHaveLength(0);
    const r4 = await analyzeProject({ files, analyzers: [important], config: { rules: { 'test-important': { options: { max: 1 } } } } });
    expect(r4.findings.filter((f) => f.rule === 'test-important')).toHaveLength(1);
    await expect(
      analyzeProject({ files, analyzers: [important], config: { rules: { 'test-important': { options: { max: 'x' } } } } }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it('reuses cached models', async () => {
    const store = new Map<string, unknown>();
    const cache = { get: (k: string) => store.get(k), set: (k: string, v: unknown) => void store.set(k, v) };
    const first = await analyzeProject({ files, analyzers: [important], cache });
    expect(first.meta.cache).toEqual({ hits: 0, misses: 3 });
    const second = await analyzeProject({ files, analyzers: [important], cache });
    expect(second.meta.cache).toEqual({ hits: 3, misses: 0 });
    expect(second.findings).toEqual(first.findings);
  });

  it('produces valid JSON and escaped HTML reports', async () => {
    const result = await analyzeProject({ files, analyzers: [important] });
    const json = toJsonReport(result);
    const parsed = parseJsonReport(json);
    expect(parsed.ok).toBe(true);
    expect(parseJsonReport('{"meta":{}}').ok).toBe(false);
    const html = toHtmlReport(result);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toContain('<script> }');
    expect(html).toContain('CSSA-0001');
  });
});
