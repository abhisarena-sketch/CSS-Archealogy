import { describe, expect, it } from 'vitest';
import { byRule, scan } from './helpers.js';

describe('overridden-declaration', () => {
  it('detects declarations overridden by source order in the same file', async () => {
    const result = await scan({ 'a.css': '.a { color: red }\n.a { color: blue }' });
    const [f] = byRule(result.findings, 'overridden-declaration');
    expect(f).toMatchObject({ line: 1, property: 'color', value: 'red', confidence: 'high', approximate: false });
    expect(f!.evidence[1]!.line).toBe(2);
  });

  it('detects media queries placed before the base rule', async () => {
    const result = await scan({ 'a.css': '@media (min-width: 768px) { .a { color: red } }\n.a { color: blue }' });
    const [f] = byRule(result.findings, 'overridden-declaration');
    expect(f!.line).toBe(1);
    expect(f!.suggestion).toMatch(/media query after the base rule/);
  });

  it('does not report media overrides that come after the base rule', async () => {
    const result = await scan({ 'a.css': '.a { color: blue }\n@media (min-width: 768px) { .a { color: red } }' });
    expect(byRule(result.findings, 'overridden-declaration')).toHaveLength(0);
  });

  it('respects !important over later declarations', async () => {
    const result = await scan({ 'a.css': '.a { color: red !important }\n.a { color: blue }' });
    const [f] = byRule(result.findings, 'overridden-declaration');
    expect(f!.value).toBe('blue');
    expect(f!.evidence[1]!.message).toMatch(/!important/);
  });

  it('respects specificity', async () => {
    const result = await scan({ 'a.css': '.a.b { color: red }\n.a.b { color: green }\n.a { color: blue }' });
    const found = byRule(result.findings, 'overridden-declaration');
    expect(found.map((f) => f.value)).toEqual(['red']);
  });

  it('respects cascade layers: unlayered styles beat layered ones', async () => {
    const result = await scan({ 'a.css': '@layer base, components;\n.a { color: red }\n@layer components { .a { color: blue } }' });
    const [f] = byRule(result.findings, 'overridden-declaration');
    expect(f!.value).toBe('blue');
    expect(f!.evidence[1]!.message).toMatch(/layer/);
  });

  it('respects layer order', async () => {
    const result = await scan({ 'a.css': '@layer base, components;\n@layer components { .a { color: blue } }\n@layer base { .a { color: red } }' });
    const [f] = byRule(result.findings, 'overridden-declaration');
    expect(f!.value).toBe('red');
  });

  it('understands shorthands resetting longhands', async () => {
    const result = await scan({ 'a.css': '.a { margin-top: 4px }\n.a { margin: 0 }' });
    const [f] = byRule(result.findings, 'overridden-declaration');
    expect(f!.property).toBe('margin-top');
    const reverse = await scan({ 'a.css': '.a { margin: 0 }\n.a { margin-top: 4px }' });
    expect(byRule(reverse.findings, 'overridden-declaration')).toHaveLength(0);
  });

  it('ignores intentional fallbacks within a block', async () => {
    const result = await scan({ 'a.css': '.a { display: -webkit-box; display: flex; height: 100vh; height: 100dvh; width: 100px; width: calc(100% - 2rem) }' });
    expect(byRule(result.findings, 'overridden-declaration')).toHaveLength(0);
  });

  it('reports plain repeated properties in one block', async () => {
    const result = await scan({ 'a.css': '.a { padding: 10px; padding: 12px }' });
    expect(byRule(result.findings, 'overridden-declaration').map((f) => f.value)).toEqual(['10px']);
  });

  it('does not treat :hover or pseudo-elements as overriding the base element', async () => {
    const result = await scan({ 'a.css': '.a { color: red }\n.a:hover { color: blue }\n.a::before { color: green }' });
    expect(byRule(result.findings, 'overridden-declaration')).toHaveLength(0);
  });

  it('only reports selector lists when every selector is overridden', async () => {
    const partial = await scan({ 'a.css': '.a, .b { color: red }\n.a { color: blue }' });
    expect(byRule(partial.findings, 'overridden-declaration')).toHaveLength(0);
    const full = await scan({ 'a.css': '.a, .b { color: red }\n.a { color: blue }\n.b { color: blue }' });
    expect(byRule(full.findings, 'overridden-declaration')).toHaveLength(1);
  });

  it('uses covering single-compound selectors with !important', async () => {
    const result = await scan({ 'a.css': '.nav .link { color: red }\n.link { color: blue !important }' });
    const [f] = byRule(result.findings, 'overridden-declaration');
    expect(f!.selector).toBe('.nav .link');
    expect(f!.approximate).toBe(true);
  });

  it('lowers confidence across files with unknown load order', async () => {
    const result = await scan({ 'a.css': '.a { color: red }', 'b.css': '.a { color: blue }' });
    const [f] = byRule(result.findings, 'overridden-declaration');
    expect(f!.approximate).toBe(true);
    expect(f!.confidence).toBe('low');
  });

  it('does not report overrides across different @supports conditions', async () => {
    const result = await scan({ 'a.css': '.a { display: block }\n@supports (display: grid) { .a { display: grid } }' });
    expect(byRule(result.findings, 'overridden-declaration')).toHaveLength(0);
  });
});
