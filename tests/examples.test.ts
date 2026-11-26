import { describe, expect, it } from 'vitest';
import { scanExample, selectorsFor } from './helpers.js';

describe('example: plain HTML and CSS', async () => {
  const result = await scanExample('html-site');

  it('detects the html adapter and scans embedded styles', () => {
    expect(result.meta.frameworks).toContain('html');
    expect(result.stylesheets.map((s) => s.file)).toEqual(expect.arrayContaining(['css/base.css', 'css/components.css', 'index.html#style-1']));
  });

  it('reports exactly the unused selectors', () => {
    expect(selectorsFor(result, 'unused-selector')).toEqual(['.btn-secondary', '.legacy-banner', 'table']);
  });

  it('does not report classes toggled by inline scripts', () => {
    expect(selectorsFor(result, 'unused-selector')).not.toContain('.menu-open .nav');
  });

  it('reports duplicates including the inline <style> block with host line numbers', () => {
    const dupes = result.findings.filter((f) => f.rule === 'duplicate-declaration');
    expect(dupes.map((d) => `${d.file}:${d.line}:${d.selector}`).sort()).toEqual(['css/components.css:4:.card', 'index.html#style-1:10:.hero']);
  });

  it('reports the media query declared before its base rule', () => {
    const overridden = result.findings.filter((f) => f.rule === 'overridden-declaration');
    expect(overridden.map((f) => `${f.file}:${f.line}:${f.property}`)).toContain('css/base.css:7:padding');
  });

  it('reports the high-specificity selector', () => {
    expect(selectorsFor(result, 'high-specificity')).toEqual(['#site-header .nav .nav-link.is-active']);
  });
});

describe('example: React with CSS Modules', async () => {
  const result = await scanExample('react-app');

  it('detects React and CSS Modules', () => {
    expect(result.meta.frameworks).toEqual(expect.arrayContaining(['react', 'css-modules']));
  });

  it('treats template-literal prefixes and clsx objects as references', () => {
    const unused = selectorsFor(result, 'unused-selector');
    expect(unused).not.toContain('.alert-info');
    expect(unused).not.toContain('.app--compact');
  });

  it('reports unused module classes and unused global classes only', () => {
    const unused = result.findings.filter((f) => f.rule === 'unused-selector').map((f) => `${f.file}:${f.selector}`);
    expect(unused.sort()).toEqual(['src/components/Button.module.css:.ghost', 'src/styles/global.css:.sidebar']);
  });
});

describe('example: Next.js app router', async () => {
  const result = await scanExample('next-app');

  it('detects Next.js and orders global CSS by layout imports', () => {
    expect(result.meta.frameworks).toEqual(expect.arrayContaining(['next', 'react', 'css-modules']));
    const order = result.stylesheets.map((s) => s.file);
    expect(order.indexOf('app/globals.css')).toBeLessThan(order.indexOf('app/theme.css'));
  });

  it('reports unused selectors across global CSS and modules', () => {
    const unused = result.findings.filter((f) => f.rule === 'unused-selector').map((f) => `${f.file}:${f.selector}`);
    expect(unused.sort()).toEqual(['app/theme.css:.unused-theme-class', 'components/StatCard.module.css:.trend']);
  });

  it('treats next/link as an <a> element', () => {
    expect(selectorsFor(result, 'unused-selector')).not.toContain('a');
  });

  it('reports cross-file overrides using import order with reduced confidence', () => {
    const f = result.findings.find((x) => x.rule === 'overridden-declaration' && x.selector === '.link');
    expect(f).toBeDefined();
    expect(f!.file).toBe('app/globals.css');
    expect(f!.approximate).toBe(true);
    expect(f!.confidence).toBe('medium');
  });

  it('reports cross-file duplicates', () => {
    expect(selectorsFor(result, 'duplicate-declaration')).toContain('.page');
  });
});

describe('example: Tailwind CSS', async () => {
  const result = await scanExample('tailwind-app');

  it('detects Tailwind', () => {
    expect(result.meta.frameworks).toContain('tailwind');
  });

  it('counts @apply, config safelist and markup utilities as references', () => {
    expect(selectorsFor(result, 'unused-selector')).toEqual([]);
  });
});
