import { describe, expect, it } from 'vitest';
import { byRule, scan } from './helpers.js';

describe('specificity analyzer', () => {
  it('reports selectors above the specificity threshold', async () => {
    const result = await scan({ 'a.css': '#app .nav a { color: red }\n.a .b .c .d .e { color: red }\n.ok { color: red }' });
    const found = byRule(result.findings, 'high-specificity');
    expect(found.map((f) => f.selector)).toEqual(['#app .nav a', '.a .b .c .d .e']);
    expect(found[0]!.title).toBe('High specificity (1,1,1)');
  });

  it('honours a configured threshold', async () => {
    const result = await scan({ 'a.css': '.a .b { color: red }' }, { rules: { 'high-specificity': { options: { max: [0, 1, 0] } } } });
    expect(byRule(result.findings, 'high-specificity')).toHaveLength(1);
  });

  it('reports complex, overqualified and hacked selectors', async () => {
    const result = await scan({ 'a.css': 'body main section article div p { color: red }\nul.nav { margin: 0 }\n.btn.btn { color: red }' });
    expect(byRule(result.findings, 'complex-selector').map((f) => f.selector)).toEqual(['body main section article div p']);
    expect(byRule(result.findings, 'overqualified-selector').map((f) => f.selector)).toEqual(['ul.nav']);
    expect(byRule(result.findings, 'specificity-hack').map((f) => f.selector)).toEqual(['.btn.btn']);
  });

  it('reports !important overuse per stylesheet', async () => {
    const decls = Array.from({ length: 6 }, (_, i) => `.x${i} { color: red !important }`).join('\n');
    const result = await scan({ 'a.css': decls });
    expect(byRule(result.findings, 'important-overuse')).toHaveLength(1);
  });

  it('reports specificity escalation chains', async () => {
    const css = '.btn { color: red }\n.toolbar .btn { color: blue }\n#header .toolbar .btn { color: green }';
    const result = await scan({ 'a.css': css });
    const [f] = byRule(result.findings, 'specificity-escalation');
    expect(f!.evidence).toHaveLength(3);
  });

  it('reports competing !important declarations as conflicts', async () => {
    const result = await scan({ 'a.css': '.a { color: red !important }\n.a { color: blue !important }' });
    expect(byRule(result.findings, 'conflicting-declaration')).toHaveLength(1);
  });

  it('reports same-selector conflicts across stylesheets with unknown order', async () => {
    const result = await scan({ 'a.css': '.title { font-size: 2rem }', 'b.css': '.title { font-size: 3rem }' });
    const [f] = byRule(result.findings, 'conflicting-declaration');
    expect(f!.approximate).toBe(true);
  });

  it('does not report intentional variations (media queries, states, same-file overrides)', async () => {
    const css = '.a { color: red }\n.a:hover { color: blue }\n@media (min-width: 600px) { .a { color: green } }\n.b { color: red }\n.b { color: blue }';
    const result = await scan({ 'a.css': css });
    expect(byRule(result.findings, 'conflicting-declaration')).toHaveLength(0);
    expect(byRule(result.findings, 'specificity-conflict')).toHaveLength(0);
  });

  it('reports later rules that lose to much more specific earlier ones', async () => {
    const result = await scan({ 'a.css': '#sidebar .link { color: red }\n.link { color: blue }' });
    const [f] = byRule(result.findings, 'specificity-conflict');
    expect(f!.selector).toBe('.link');
    expect(f!.confidence).toBe('medium');
  });

  it('does not report collisions between unrelated contexts', async () => {
    const result = await scan({ 'a.css': '#header .title { color: red }\n.footer .title { color: blue }' });
    expect(byRule(result.findings, 'specificity-conflict')).toHaveLength(0);
  });
});
