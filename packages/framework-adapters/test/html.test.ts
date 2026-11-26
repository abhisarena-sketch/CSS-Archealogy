import { describe, expect, it } from 'vitest';
import { resolveConfig, type AdapterContext } from '@css-archaeology/core';
import { extractFromHtml } from '../src/html.js';

const ctx = (paths: string[] = []): AdapterContext => ({ config: resolveConfig({}), fileExists: (p) => paths.includes(p), paths });

describe('HTML adapter', () => {
  const html = `<!doctype html>
<html>
<head>
  <link rel="stylesheet" href="css/site.css">
  <link rel="stylesheet" href="https://cdn.example.com/x.css">
  <style>
    .inline { color: red }
  </style>
</head>
<body class="home page">
  <nav id="main-nav" data-open="false"><a class="nav-link active" href="#">Home</a></nav>
  <div class="card card-{{ variant }}"></div>
  <div :class="{ 'is-shown': shown }"></div>
  <script>
    document.querySelector('.card').classList.add('is-ready');
  </script>
  <script type="application/json">{"cls": "json-token"}</script>
</body>
</html>`;
  const refs = extractFromHtml({ path: 'index.html', content: html }, ctx(['css/site.css']));

  it('collects classes, ids, elements and attributes with line numbers', () => {
    expect(Object.keys(refs.classes).sort()).toEqual(['active', 'card', 'home', 'is-ready', 'nav-link', 'page']);
    expect(refs.classes['nav-link']![0]!.line).toBe(11);
    expect(Object.keys(refs.ids)).toEqual(['main-nav']);
    expect(Object.keys(refs.elements)).toEqual(expect.arrayContaining(['html', 'nav', 'a', 'div', 'script', 'link']));
    expect(Object.keys(refs.attributes)).toEqual(expect.arrayContaining(['data-open', 'href', 'rel']));
  });

  it('turns template expressions in class attributes into dynamic patterns', () => {
    expect(refs.dynamicPatterns.map((p) => p.prefix)).toContain('card-');
  });

  it('keeps framework class bindings and JSON script content as weak tokens', () => {
    expect(refs.tokens).toEqual(expect.arrayContaining(['is-shown', 'json-token']));
  });

  it('extracts <style> blocks as embedded stylesheets with line offsets', () => {
    expect(refs.embeddedStylesheets).toHaveLength(1);
    expect(refs.embeddedStylesheets[0]!.path).toBe('index.html#style-1');
    expect(refs.embeddedStylesheets[0]!.lineOffset).toBe(6);
  });

  it('records local stylesheet links in order and ignores remote ones', () => {
    expect(refs.stylesheetImports.map((i) => i.stylesheet)).toEqual(['css/site.css']);
  });
});
