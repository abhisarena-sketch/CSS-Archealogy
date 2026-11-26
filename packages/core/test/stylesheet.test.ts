import { describe, expect, it } from 'vitest';
import { parseStylesheet, normaliseValue, countLines } from '../src/stylesheet.js';
import { buildProjectModel } from '../src/project.js';

describe('parseStylesheet', () => {
  it('extracts rules, declarations and source positions', () => {
    const model = parseStylesheet('a.css', '.card {\n  padding: 16px;\n  color: #FFF;\n}\n\n.title { font-weight: 700 !important; }\n');
    expect(model.rules).toHaveLength(2);
    const [card, title] = model.rules;
    expect(card!.line).toBe(1);
    expect(card!.declarations.map((d) => [d.prop, d.value, d.line])).toEqual([
      ['padding', '16px', 2],
      ['color', '#fff', 3],
    ]);
    expect(title!.declarations[0]!.important).toBe(true);
    expect(model.record.declarationCount).toBe(3);
    expect(model.record.importantCount).toBe(1);
    expect(model.record.lines).toBe(6);
  });

  it('tracks media, supports, layer and container context', () => {
    const css = `@layer base { @media (min-width:768px) { @supports (display:grid) { .a { display: grid } } } }
@container card (min-width: 400px) { .b { color: red } }`;
    const model = parseStylesheet('a.css', css);
    const [a, b] = model.rules;
    expect(a!.context).toEqual({ media: ['(min-width: 768px)'], supports: ['(display: grid)'], container: [], layer: 'base', scope: [] });
    expect(a!.contextKey).toBe('@media (min-width: 768px) | @supports (display: grid) | @layer base');
    expect(b!.context.container).toEqual(['card (min-width: 400px)']);
    expect(model.layers).toEqual(['base']);
  });

  it('records layer order statements and nested layers', () => {
    const model = parseStylesheet('a.css', '@layer reset, components;\n@layer components { @layer buttons { .btn { color: red } } }');
    expect(model.layers).toEqual(['reset', 'components', 'components.buttons']);
    expect(model.rules[0]!.context.layer).toBe('components.buttons');
  });

  it('resolves native CSS nesting including nested at-rules', () => {
    const css = `.card { color: black; &:hover { color: blue } .title { font-size: 2rem } @media (min-width: 600px) { padding: 2rem } }`;
    const model = parseStylesheet('a.css', css);
    expect(model.rules.map((r) => [r.selectorText, r.contextKey, r.nestingDepth])).toEqual([
      ['.card', '', 0],
      ['.card:hover', '', 1],
      ['.card .title', '', 1],
      ['.card', '@media (min-width: 600px)', 1],
    ]);
    expect(model.record.maxNestingDepth).toBe(1);
  });

  it('parses SCSS with BEM suffix nesting and @extend references', () => {
    const scss = `$gap: 4px;\n.btn { padding: $gap; &--primary { color: red; } &__icon { width: 1em } }\n.link { @extend .btn; }\n// comment`;
    const model = parseStylesheet('a.scss', scss);
    expect(model.record.syntax).toBe('scss');
    expect(model.rules.map((r) => r.selectorText)).toEqual(['.btn', '.btn--primary', '.btn__icon', '.link']);
    expect(model.cssReferences).toContainEqual(expect.objectContaining({ name: 'btn', via: 'extend' }));
  });

  it('skips keyframe selectors and font-face blocks', () => {
    const model = parseStylesheet('a.css', '@keyframes spin { from { transform: rotate(0) } to { transform: rotate(1turn) } }\n@font-face { font-family: X; src: url(x.woff2) }\n.a{animation: spin 1s}');
    expect(model.rules.map((r) => r.selectorText)).toEqual(['.a']);
    expect(model.atRules.map((a) => a.name)).toEqual(['keyframes', 'font-face']);
  });

  it('recovers from invalid CSS and records the issue', () => {
    const model = parseStylesheet('bad.css', '.a { color: red;\n.b { color: blue }\n.c { width: 10px');
    expect(model.record.parseIssues).toHaveLength(1);
    expect(model.record.parseIssues[0]!.kind).toBe('recovered');
    expect(model.rules.length).toBeGreaterThan(0);
  });

  it('collects Tailwind directives, @apply tokens and composes references', () => {
    const model = parseStylesheet('x.module.css', '@import "tailwindcss";\n.btn { @apply px-4 hover:bg-blue-500 card; }\n.primary { composes: btn; composes: base from "./base.module.css"; }');
    expect(model.record.isModule).toBe(true);
    expect(model.record.tailwindDirectives).toEqual(expect.arrayContaining(['@import "tailwindcss"', '@apply']));
    expect(model.applyTokens).toEqual(['px-4', 'hover:bg-blue-500', 'card']);
    expect(model.cssReferences.filter((r) => r.via === 'apply').map((r) => r.name)).toEqual(['px-4', 'bg-blue-500', 'card']);
    expect(model.cssReferences.filter((r) => r.via === 'composes')).toEqual([
      expect.objectContaining({ name: 'btn' }),
      expect.objectContaining({ name: 'base', from: './base.module.css' }),
    ]);
  });

  it('applies line offsets for embedded stylesheets', () => {
    const model = parseStylesheet('index.html#style-1', '\n.a { color: red }', { lineOffset: 10, embeddedIn: 'index.html' });
    expect(model.rules[0]!.line).toBe(11);
    expect(model.record.embeddedIn).toBe('index.html');
  });

  it('normalises values', () => {
    expect(normaliseValue('  rgba( 0 ,0,  0 , .5 )  ')).toBe('rgba(0, 0, 0, .5)');
    expect(normaliseValue('#FFFFFF')).toBe('#ffffff');
    expect(countLines('a\nb\n')).toBe(2);
  });
});

describe('buildProjectModel', () => {
  it('orders imported stylesheets before others and assigns global order', () => {
    const a = parseStylesheet('styles/a.css', '.a { color: red }');
    const b = parseStylesheet('styles/b.css', '@import "./c.css";\n.b { color: red }');
    const c = parseStylesheet('styles/c.css', '.c { color: red }');
    const project = buildProjectModel([a, b, c], [{ importer: 'src/main.tsx', stylesheet: 'styles/b.css', line: 1, position: 0 }]);
    expect(project.stylesheets.map((s) => s.file)).toEqual(['styles/c.css', 'styles/b.css', 'styles/a.css']);
    expect(project.orderSource.get('styles/b.css')).toBe('import-graph');
    expect(project.orderSource.get('styles/c.css')).toBe('import-graph');
    expect(project.orderSource.get('styles/a.css')).toBe('path');
    const orders = project.rules.map((r) => r.order);
    expect([...orders].sort((x, y) => x - y)).toEqual(orders);
  });
});
