import { describe, expect, it } from 'vitest';
import {
  analyzeSelector,
  calculateSpecificity,
  compareSpecificity,
  formatSpecificity,
  normaliseSelector,
  resolveNestedSelector,
  splitSelectorList,
} from '../src/selectors.js';

describe('specificity', () => {
  const cases: [string, [number, number, number]][] = [
    ['*', [0, 0, 0]],
    ['div', [0, 0, 1]],
    ['.card', [0, 1, 0]],
    ['#main', [1, 0, 0]],
    ['ul li a', [0, 0, 3]],
    ['.nav > .item:hover', [0, 3, 0]],
    ['a::before', [0, 0, 2]],
    ['a:before', [0, 0, 2]],
    ['[data-state="open"]', [0, 1, 0]],
    ['#app .nav .link.active', [1, 3, 0]],
    [':is(#a, .b) span', [1, 0, 1]],
    [':where(#a, .b) span', [0, 0, 1]],
    [':not(.x, #y)', [1, 0, 0]],
    [':has(> img)', [0, 0, 1]],
    ['li:nth-child(2n+1)', [0, 1, 1]],
    ['li:nth-child(2n+1 of .important)', [0, 2, 1]],
    [':global(.foo) .bar', [0, 2, 0]],
    ['.a:hover::after', [0, 2, 1]],
  ];
  it.each(cases)('%s', (selector, expected) => {
    expect(calculateSpecificity(selector)).toEqual(expected);
  });

  it('compares and formats', () => {
    expect(compareSpecificity([1, 0, 0], [0, 9, 9])).toBeGreaterThan(0);
    expect(compareSpecificity([0, 1, 2], [0, 1, 2])).toBe(0);
    expect(formatSpecificity([0, 2, 1])).toBe('(0,2,1)');
  });
});

describe('selector analysis', () => {
  it('extracts classes, ids, elements and attributes', () => {
    const part = analyzeSelector('#app  nav.menu > a[href^="http"]:hover::after');
    expect(part.ids).toEqual(['app']);
    expect(part.classes).toEqual(['menu']);
    expect(part.elements).toEqual(['nav', 'a']);
    expect(part.attributes).toEqual(['href']);
    expect(part.pseudoClasses).toEqual([':hover']);
    expect(part.pseudoElements).toEqual(['::after']);
    expect(part.compounds).toBe(3);
    expect(part.text).toBe('#app nav.menu > a[href^="http"]:hover::after');
    expect(part.keySimple).toEqual(['[href^="http"]', 'a']);
  });

  it('treats :not() contents as non-requirements and :is() as alternatives', () => {
    const part = analyzeSelector('.list :is(.a, .b):not(.hidden)');
    expect(part.requirements.classes).toEqual(['list']);
    expect(part.requirements.alternatives).toHaveLength(1);
    expect(part.requirements.alternatives[0]!.map((r) => r.classes)).toEqual([['a'], ['b']]);
    expect(part.classes).toContain('hidden');
  });

  it('unescapes Tailwind style class names', () => {
    const part = analyzeSelector('.md\\:hover\\:bg-blue-500:hover');
    expect(part.classes).toEqual(['md:hover:bg-blue-500']);
    const arbitrary = analyzeSelector('.w-\\[32px\\]');
    expect(arbitrary.classes).toEqual(['w-[32px]']);
  });

  it('detects :global() and does not require html/body elements', () => {
    const part = analyzeSelector('html body :global(.theme-dark) .x');
    expect(part.hasGlobal).toBe(true);
    expect(part.requirements.elements).toEqual([]);
    expect(part.requirements.classes).toEqual(['theme-dark', 'x']);
  });

  it('marks interpolated selectors as unparseable', () => {
    expect(analyzeSelector('.btn-#{$size}').unparseable).toBe(true);
  });

  it('normalises whitespace and combinators', () => {
    expect(normaliseSelector('.a>.b   +  .c,.d')).toBe('.a > .b + .c, .d');
  });
});

describe('selector lists and nesting', () => {
  it('splits on top-level commas only', () => {
    expect(splitSelectorList('.a, :is(.b, .c), [data-x="1,2"]')).toEqual(['.a', ':is(.b, .c)', '[data-x="1,2"]']);
  });

  it('resolves native and SCSS nesting', () => {
    expect(resolveNestedSelector(['.card'], '.title')).toEqual(['.card .title']);
    expect(resolveNestedSelector(['.card'], '&:hover')).toEqual(['.card:hover']);
    expect(resolveNestedSelector(['.card'], '> .body')).toEqual(['.card > .body']);
    expect(resolveNestedSelector(['.btn'], '&-primary, &.is-active')).toEqual(['.btn-primary', '.btn.is-active']);
    expect(resolveNestedSelector(['.a', '.b'], '.c')).toEqual(['.a .c', '.b .c']);
    expect(resolveNestedSelector(['.a'], '.theme-dark &')).toEqual(['.theme-dark .a']);
  });
});
