import { describe, expect, it } from 'vitest';
import { byRule, scan } from './helpers.js';

const html = '<div class="card active" id="main"><p class="title">Hi</p><input type="text" data-state="open"></div>';

describe('unused-selector', () => {
  it('reports selectors whose classes are not referenced', async () => {
    const result = await scan({ 'index.html': html, 'a.css': '.card { color: red }\n.ghost { color: red }\n.card .title { margin: 0 }' });
    const found = byRule(result.findings, 'unused-selector');
    expect(found.map((f) => f.selector)).toEqual(['.ghost']);
    expect(found[0]!.title).toBe('Potentially unused selector .ghost');
    expect(found[0]!.confidence).toBe('high');
    expect(found[0]!.evidence.some((e) => e.kind === 'search')).toBe(true);
  });

  it('handles ids, elements, attributes, pseudo-classes and pseudo-elements', async () => {
    const css = '#main{}\n#missing{}\np::first-line{}\ntable{}\n[data-state]{}\n[data-missing]{}\n.card:hover::after{}';
    const result = await scan({ 'index.html': html, 'a.css': css });
    const found = byRule(result.findings, 'unused-selector');
    expect(found.map((f) => f.selector)).toEqual(['#missing', 'table', '[data-missing]']);
    expect(found.find((f) => f.selector === 'table')!.severity).toBe('info');
    expect(found.find((f) => f.selector === 'table')!.confidence).not.toBe('high');
  });

  it('treats :is() as alternatives and ignores :not() arguments', async () => {
    const css = ':is(.card, .ghost) {}\n:is(.ghost, .phantom) {}\n.card:not(.ghost) {}';
    const result = await scan({ 'index.html': html, 'a.css': css });
    expect(byRule(result.findings, 'unused-selector').map((f) => f.selector)).toEqual([':is(.ghost, .phantom)']);
  });

  it('resolves nested selectors before checking', async () => {
    const css = '.card { color: red; & .title { color: blue } & .ghost { color: green } }';
    const result = await scan({ 'index.html': html, 'a.css': css });
    expect(byRule(result.findings, 'unused-selector').map((f) => f.selector)).toEqual(['.card .ghost']);
  });

  it('never reports universal, :root, html or body selectors', async () => {
    const result = await scan({ 'index.html': html, 'a.css': '*{}\n:root{--x:1}\nhtml{}\nbody{}\n::selection{}' });
    expect(byRule(result.findings, 'unused-selector')).toHaveLength(0);
  });

  it('supports safelists by class, selector and regex', async () => {
    const css = '.ghost{}\n.js-toggle{}\n.modal-open .x{}\n.keep-me{}';
    const result = await scan({ 'index.html': html, 'a.css': css }, { safelist: ['ghost', '/^js-/', '.modal-open .x', '.keep-me'] });
    expect(byRule(result.findings, 'unused-selector')).toHaveLength(0);
  });

  it('is skipped (with a note) when no source files were scanned', async () => {
    const result = await scan({ 'a.css': '.ghost{}' });
    expect(byRule(result.findings, 'unused-selector')).toHaveLength(0);
    expect(result.meta.notes.join('\n')).toMatch(/Unused selector analysis skipped/);
  });

  it('lowers confidence for runtime state class names', async () => {
    const result = await scan({ 'index.html': html, 'a.css': '.is-open{}' });
    const [f] = byRule(result.findings, 'unused-selector');
    expect(f!.confidence).toBe('medium');
    expect(f!.confidenceFactors.map((x) => x.factor)).toContain('runtime-state-name');
  });

  it('counts classes referenced from CSS (@apply, @extend) as used', async () => {
    const result = await scan({ 'index.html': html, 'a.css': '.base { color: red }\n.card { @apply base; }' });
    expect(byRule(result.findings, 'unused-selector')).toHaveLength(0);
  });

  it('can be disabled with the analysis toggle or rule setting', async () => {
    const files = { 'index.html': html, 'a.css': '.ghost{}' };
    expect(byRule((await scan(files, { analysis: { unusedSelectors: false } })).findings, 'unused-selector')).toHaveLength(0);
    expect(byRule((await scan(files, { rules: { 'unused-selector': 'off' } })).findings, 'unused-selector')).toHaveLength(0);
  });

  it('filters by minimum confidence', async () => {
    const result = await scan({ 'index.html': html, 'a.css': 'table{}\n.ghost{}' }, { minConfidence: 'high' });
    expect(byRule(result.findings, 'unused-selector').map((f) => f.selector)).toEqual(['.ghost']);
  });
});
