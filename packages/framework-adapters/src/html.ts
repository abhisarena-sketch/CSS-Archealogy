import { Parser } from 'htmlparser2';
import {
  addReference,
  emptyFileReferences,
  tokenize,
  type AdapterContext,
  type FileReferences,
  type FrameworkAdapter,
  type SourceFile,
} from '@css-archaeology/core';
import { extractFromScript, resolveHref } from './js-extractor.js';

const TEMPLATE_MARKERS = /\{\{|\{%|\$\{|<%|\[\[|@\{/;
/** Template expressions embedded in attribute values (Handlebars, Jinja, ERB, JS templates). */
const TEMPLATE_EXPRESSION = /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|<%[\s\S]*?%>|\$\{[^}]*\}|\[\[[\s\S]*?\]\]/g;
const CLASS_BINDING_ATTR = /^(:class|v-bind:class|x-bind:class|\[class\]|\[ngclass\]|ng-class|\[class\..+\]|class:.+|x-bind:class)$/;

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function positionOf(starts: number[], index: number): { line: number; column: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= index) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: index - starts[lo]! + 1 };
}

function mergeInto(target: FileReferences, source: FileReferences): void {
  for (const bucket of ['classes', 'ids', 'elements', 'attributes'] as const) {
    for (const [name, list] of Object.entries(source[bucket])) for (const o of list) addReference(target[bucket], name, o);
  }
  target.dynamicPatterns.push(...source.dynamicPatterns);
  target.unresolved.push(...source.unresolved);
  target.cssModules.push(...source.cssModules);
  target.notes.push(...source.notes);
}

/** Extract references from an HTML document. Scripts are parsed, never run. */
export function extractFromHtml(file: SourceFile, context: AdapterContext, adapter = 'html'): FileReferences {
  const refs = emptyFileReferences(file.path, adapter);
  const tokens = new Set<string>();
  const starts = lineStarts(file.content);
  let styleCount = 0;
  let scriptCount = 0;
  let linkPosition = 0;
  let inStyle: { start: number } | null = null;
  let inScript: { start: number; type: string } | null = null;
  let buffer = '';

  const parser = new Parser(
    {
      onopentag(name, attribs) {
        const pos = positionOf(starts, parser.startIndex);
        const occ = { file: file.path, line: pos.line, column: pos.column, via: 'html' };
        addReference(refs.elements, name.toLowerCase(), { ...occ, via: 'html-element' });
        for (const [rawAttr, value] of Object.entries(attribs)) {
          const attr = rawAttr.toLowerCase();
          addReference(refs.attributes, attr, { ...occ, via: 'html-attribute' });
          if (attr === 'class') {
            const masked = value.replace(TEMPLATE_EXPRESSION, '\u0000');
            for (const token of masked.split(/\s+/).filter(Boolean)) {
              const markerIndex = token.indexOf('\u0000');
              if (markerIndex >= 0) {
                if (token === '\u0000') {
                  refs.unresolved.push({ file: file.path, line: pos.line, column: pos.column, via: 'html-template', snippet: value.slice(0, 80) });
                  continue;
                }
                const prefix = token.slice(0, markerIndex);
                if (prefix.length >= 2) refs.dynamicPatterns.push({ kind: 'class', prefix, suffix: '', file: file.path, line: pos.line, column: pos.column, via: 'html-template' });
                else refs.unresolved.push({ file: file.path, line: pos.line, column: pos.column, via: 'html-template', snippet: token.slice(0, 80) });
              } else addReference(refs.classes, token, { ...occ, via: 'html-class' });
            }
          } else if (attr === 'id') {
            if (TEMPLATE_MARKERS.test(value)) {
              const prefix = value.slice(0, TEMPLATE_MARKERS.exec(value)!.index);
              if (prefix) refs.dynamicPatterns.push({ kind: 'id', prefix, suffix: '', file: file.path, line: pos.line, column: pos.column, via: 'html-template' });
            } else if (value.trim()) addReference(refs.ids, value.trim(), { ...occ, via: 'html-id' });
          } else if (CLASS_BINDING_ATTR.test(attr) || attr.includes('class')) {
            // Framework class bindings (Vue, Alpine, Angular): keep every token as weak evidence.
            tokenize(value, tokens);
            const bound = /^\[class\.(.+)\]$|^class:(.+)$/.exec(attr);
            if (bound) addReference(refs.classes, bound[1] ?? bound[2]!, { ...occ, via: 'html-class-binding' });
          } else {
            tokenize(value, tokens);
          }
        }
        if (name === 'link' && /(^|\s)stylesheet(\s|$)/i.test(attribs.rel ?? '') && attribs.href) {
          const resolved = resolveHref(file.path, attribs.href);
          const candidates = resolved ? [resolved, `public/${resolved}`] : [];
          const found = candidates.find((c) => context.fileExists(c));
          if (found) refs.stylesheetImports.push({ importer: file.path, stylesheet: found, line: pos.line, position: linkPosition++ });
        }
        if (name === 'style') {
          inStyle = { start: parser.endIndex + 1 };
          buffer = '';
        }
        if (name === 'script') {
          const type = (attribs.type ?? '').toLowerCase();
          inScript = { start: parser.endIndex + 1, type };
          buffer = '';
        }
      },
      ontext(text) {
        // Visible text is content, not class names, so it is ignored.
        if (inStyle || inScript) buffer += text;
      },
      onclosetag(name) {
        if (name === 'style' && inStyle) {
          const pos = positionOf(starts, inStyle.start);
          styleCount++;
          refs.embeddedStylesheets.push({ path: `${file.path}#style-${styleCount}`, content: buffer, lineOffset: pos.line });
          inStyle = null;
        }
        if (name === 'script' && inScript) {
          const { type } = inScript;
          if (!type || /javascript|module|babel|jsx/.test(type)) {
            scriptCount++;
            const pos = positionOf(starts, inScript.start);
            const virtual = { path: `${file.path}#script-${scriptCount}.js`, content: '\n'.repeat(Math.max(0, pos.line - 1)) + buffer };
            const scriptRefs = extractFromScript(virtual, context, { adapter });
            for (const bucket of ['classes', 'ids', 'elements', 'attributes'] as const) {
              for (const list of Object.values(scriptRefs[bucket])) for (const o of list) o.file = file.path;
            }
            for (const p of scriptRefs.dynamicPatterns) p.file = file.path;
            for (const u of scriptRefs.unresolved) u.file = file.path;
            mergeInto(refs, scriptRefs);
            for (const t of scriptRefs.tokens) tokens.add(t);
          } else {
            tokenize(buffer, tokens);
          }
          inScript = null;
        }
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: false, recognizeSelfClosing: true },
  );
  parser.write(file.content);
  parser.end();
  refs.tokens = [...tokens];
  return refs;
}

export const htmlAdapter: FrameworkAdapter = {
  id: 'html',
  title: 'HTML',
  version: 2,
  extensions: ['html', 'htm'],
  priority: 10,
  detect(input) {
    const html = input.paths.filter((p) => /\.html?$/i.test(p));
    return { detected: html.length > 0, reason: `${html.length} HTML file(s) found` };
  },
  extract(file, context) {
    return extractFromHtml(file, context);
  },
};
