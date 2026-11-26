import { describe, expect, it } from 'vitest';
import { byRule, scan } from './helpers.js';

describe('duplicate-declaration', () => {
  it('reports the documented .card example with locations and other occurrences', async () => {
    const result = await scan({ 'src/styles/components.css': '.card {\n  padding: 16px;\n}\n\n.card {\n  padding: 16px;\n}\n' });
    const [f, ...rest] = byRule(result.findings, 'duplicate-declaration');
    expect(rest).toHaveLength(0);
    expect(f).toMatchObject({
      rule: 'duplicate-declaration',
      severity: 'medium',
      confidence: 'high',
      title: 'Duplicate padding declaration',
      file: 'src/styles/components.css',
      line: 6,
      selector: '.card',
      property: 'padding',
      value: '16px',
    });
    expect(f!.evidence.filter((e) => e.kind === 'occurrence').map((e) => e.line)).toEqual([2, 6]);
    expect(f!.data).toMatchObject({ safeToConsolidate: true });
  });

  it('reports duplicates inside one block', async () => {
    const result = await scan({ 'a.css': '.a { color: red; margin: 0; color: red; }' });
    const found = byRule(result.findings, 'duplicate-declaration');
    expect(found).toHaveLength(1);
    expect(found[0]!.data).toMatchObject({ scope: 'block' });
  });

  it('does not treat declarations under different media queries as duplicates', async () => {
    const result = await scan({ 'a.css': '.a { padding: 4px }\n@media (min-width: 600px) { .a { padding: 4px } }' });
    expect(byRule(result.findings, 'duplicate-declaration')).toHaveLength(0);
  });

  it('flags consolidation as unsafe when a different value intervenes', async () => {
    const css = '.btn { color: red }\n.toolbar .btn { color: blue }\n.btn { color: red }';
    const result = await scan({ 'a.css': css });
    const [f] = byRule(result.findings, 'duplicate-declaration');
    expect(f!.data).toMatchObject({ safeToConsolidate: false });
    expect(f!.evidence.some((e) => e.message.includes('.toolbar .btn'))).toBe(true);
  });

  it('marks cross-file duplicates as approximate with lower confidence', async () => {
    const result = await scan({ 'a.css': '.a { color: red }', 'b.css': '.a { color: red }' });
    const [f] = byRule(result.findings, 'duplicate-declaration');
    expect(f!.approximate).toBe(true);
    expect(f!.confidence).not.toBe('high');
  });

  it('keeps CSS Module classes in different files apart', async () => {
    const result = await scan({ 'a.module.css': '.title { color: red }', 'b.module.css': '.title { color: red }' });
    expect(byRule(result.findings, 'duplicate-declaration')).toHaveLength(0);
  });

  it('does not treat !important and normal declarations as duplicates', async () => {
    const result = await scan({ 'a.css': '.a { color: red }\n.a { color: red !important }' });
    expect(byRule(result.findings, 'duplicate-declaration')).toHaveLength(0);
  });

  it('reports repeated declaration blocks across selectors', async () => {
    const block = '{ display: flex; align-items: center; gap: 8px; }';
    const result = await scan({ 'a.css': `.toolbar ${block}\n.menu ${block}\n.footer-links ${block}` });
    const [f] = byRule(result.findings, 'repeated-declaration-block');
    expect(f!.selector).toBe('.toolbar, .menu, .footer-links');
    expect(f!.severity).toBe('low');
  });
});
