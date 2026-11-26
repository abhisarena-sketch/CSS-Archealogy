import { describe, expect, it } from 'vitest';
import { byRule, scan } from './helpers.js';
import { parseColor } from '../src/index.js';

describe('media-queries analyzer', () => {
  it('reports duplicate media queries in one file', async () => {
    const css = '@media (min-width:768px) { .a { color: red } }\n.b{}\n@media (min-width: 768px) { .c { color: red } }';
    const [f] = byRule((await scan({ 'a.css': css })).findings, 'duplicate-media-query');
    expect(f).toMatchObject({ line: 3, title: '@media (min-width: 768px) appears 2 times' });
  });

  it('does not merge identical queries nested in different parents', async () => {
    const css = '@supports (display:grid) { @media (min-width:768px) { .a{color:red} } }\n@media (min-width:768px) { .b{color:red} }';
    expect(byRule((await scan({ 'a.css': css })).findings, 'duplicate-media-query')).toHaveLength(0);
  });

  it('reports inconsistent breakpoints but accepts min/max pairs', async () => {
    const css = '@media (min-width: 768px) {.a{color:red}}\n@media (max-width: 767px) {.a{color:blue}}\n@media (min-width: 760px) {.b{color:red}}\n@media (min-width: 48em) {.c{color:red}}';
    const [f] = byRule((await scan({ 'a.css': css })).findings, 'inconsistent-breakpoint');
    expect(f!.description).toContain('760px');
    const ok = await scan({ 'a.css': '@media (min-width: 768px) {.a{color:red}}\n@media (max-width: 767.98px) {.a{color:blue}}' });
    expect(byRule(ok.findings, 'inconsistent-breakpoint')).toHaveLength(0);
  });

  it('reports redundant responsive declarations', async () => {
    const css = '.a { display: flex; color: red }\n@media (min-width: 600px) { .a { display: flex; color: blue } }';
    const found = byRule((await scan({ 'a.css': css })).findings, 'redundant-media-declaration');
    expect(found.map((f) => f.property)).toEqual(['display']);
  });

  it('does not treat a reset after another breakpoint as redundant', async () => {
    const css = '.a { color: red }\n@media (min-width: 600px) { .a { color: blue } }\n@media (min-width: 900px) { .a { color: red } }';
    expect(byRule((await scan({ 'a.css': css })).findings, 'redundant-media-declaration')).toHaveLength(0);
  });

  it('reports values repeated across breakpoints', async () => {
    const css = '@media (min-width: 600px) { .a { gap: 2rem } }\n@media (min-width: 900px) { .a { gap: 2rem } }';
    expect(byRule((await scan({ 'a.css': css })).findings, 'repeated-across-breakpoints')).toHaveLength(1);
  });
});

describe('design-tokens analyzer', () => {
  it('groups repeated colours, spacing, radii, shadows and typography', async () => {
    const css = `.a { color: #0047AB; padding: 12px; border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,.2); font-size: 14px }
.b { background: #0047ab; margin: 12px; border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,.2); font-size: 14px }
.c { border: 1px solid #0047ab; gap: 12px; border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,.2); font-size: 14px }`;
    const result = await scan({ 'a.css': css });
    const titles = byRule(result.findings, 'repeated-value').map((f) => f.title).sort();
    expect(titles).toEqual([
      'Repeated border radius 6px (3 uses)',
      'Repeated colour #0047ab (3 uses)',
      'Repeated colour rgba(0, 0, 0, .2) (3 uses)',
      'Repeated shadow 0 1px 2px rgba(0, 0, 0, .2) (3 uses)',
      'Repeated spacing value 12px (3 uses)',
      'Repeated typography value 14px (3 uses)',
    ]);
    const color = result.tokens.find((t) => t.category === 'color' && t.value === '#0047ab');
    expect(color!.count).toBe(3);
  });

  it('ignores var() references and reports literals that duplicate a defined variable', async () => {
    const css = ':root { --brand: #0047ab; }\n.a { color: var(--brand) }\n.b { color: #0047AB }';
    const result = await scan({ 'a.css': css });
    const [f] = byRule(result.findings, 'hardcoded-token-value');
    expect(f!.title).toBe('#0047ab is hard-coded but defined as --brand');
    expect(f!.line).toBe(3);
  });

  it('reports near-duplicate colours', async () => {
    const css = '.a{color:#333333}.b{color:#333333}.c{color:#343434}';
    const [f] = byRule((await scan({ 'a.css': css })).findings, 'near-duplicate-color');
    expect(f!.title).toBe('#343434 is nearly identical to #333333');
  });

  it('parses colours', () => {
    expect(parseColor('#0047ab')).toEqual([0, 71, 171]);
    expect(parseColor('rgb(1, 2, 3)')).toEqual([1, 2, 3]);
    expect(parseColor('red')).toBeNull();
  });
});

describe('complexity analyzer', () => {
  it('reports oversized stylesheets with measured values', async () => {
    const css = Array.from({ length: 30 }, (_, i) => `.r${i} { color: red }`).join('\n');
    const result = await scan({ 'a.css': css }, { rules: { 'oversized-stylesheet': { options: { maxRules: 20 } } } });
    const [f] = byRule(result.findings, 'oversized-stylesheet');
    expect(f!.description).toContain('30 rules (limit 20)');
  });

  it('reports deep nesting', async () => {
    const css = '.a { .b { .c { .d { .e { color: red } } } } }';
    const found = byRule((await scan({ 'a.css': css })).findings, 'deep-nesting');
    expect(found.map((f) => f.selector)).toEqual(['.a .b .c .d .e']);
  });

  it('computes metrics', async () => {
    const result = await scan({ 'a.css': '.a{color:red}\n.a{color:red}\n@media (min-width:1px){.b .c .d{color:red !important}}', 'b.css': '' });
    expect(result.metrics).toMatchObject({ stylesheets: 2, totalRules: 3, totalSelectors: 3, uniqueSelectors: 2, totalDeclarations: 3, importantDeclarations: 1, mediaQueries: 1, repeatedDeclarations: 2 });
    expect(result.metrics.mostComplexSelectors[0]!.selector).toBe('.b .c .d');
    expect(result.metrics.sizeDistribution[0]!.count).toBe(2);
  });
});

describe('confidence scoring', () => {
  it('keeps severity and confidence independent and exposes factors', async () => {
    const result = await scan({ 'a.css': '.a { color: red }', 'b.css': '.a { color: blue }' });
    const [f] = byRule(result.findings, 'overridden-declaration');
    expect(f!.severity).toBe('medium');
    expect(f!.confidence).toBe('low');
    expect(f!.confidenceFactors.map((x) => x.factor)).toContain('cross-file-path-order');
    expect(f!.confidenceScore).toBeLessThan(0.45);
  });
});
