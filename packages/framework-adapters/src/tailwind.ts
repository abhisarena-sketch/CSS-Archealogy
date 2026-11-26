import ts from 'typescript';
import type { FrameworkAdapter } from '@css-archaeology/core';

/** Expand one level of `{a,b}` braces and `{1..3}` ranges, as used by `@source inline()`. */
export function expandBraces(input: string): string[] {
  const m = /\{([^{}]*)\}/.exec(input);
  if (!m) return [input];
  const body = m[1]!;
  let options: string[];
  const range = /^(-?\d+)\.\.(-?\d+)(?:\.\.(\d+))?$/.exec(body);
  if (range) {
    const [from, to, step] = [Number(range[1]), Number(range[2]), Number(range[3] ?? 1)];
    options = [];
    for (let i = from; from <= to ? i <= to : i >= to; i += from <= to ? step : -step) {
      options.push(String(i));
      if (options.length > 500) break;
    }
  } else {
    options = body.split(',');
  }
  const before = input.slice(0, m.index);
  const after = input.slice(m.index + m[0].length);
  return options.flatMap((o) => expandBraces(`${before}${o}${after}`)).slice(0, 2000);
}

/** Read `safelist` entries from a Tailwind config file using the TypeScript parser (no execution). */
export function readTailwindSafelist(content: string, path: string): { classes: string[]; patterns: string[] } {
  const sf = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
  const classes: string[] = [];
  const patterns: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && node.name.text === 'safelist' && ts.isArrayLiteralExpression(node.initializer)) {
      for (const el of node.initializer.elements) {
        if (ts.isStringLiteral(el) || ts.isNoSubstitutionTemplateLiteral(el)) classes.push(el.text);
        else if (ts.isObjectLiteralExpression(el)) {
          for (const p of el.properties) {
            if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'pattern' && ts.isRegularExpressionLiteral(p.initializer)) {
              // Keep the literal prefix of the regex (e.g. /^bg-(red|blue)-500$/ -> "bg-"); the regex itself is not compiled.
              const source = p.initializer.text.slice(1, p.initializer.text.lastIndexOf('/')).replace(/^\^/, '');
              const prefix = /^[\w-]*/.exec(source)?.[0] ?? '';
              if (prefix.length >= 2) patterns.push(prefix);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { classes, patterns };
}

/**
 * Tailwind CSS adapter. Utility classes in markup are recognised as class tokens by the
 * markup adapters; this adapter adds Tailwind-specific references: `@apply` (handled by
 * the core parser), `safelist` in tailwind.config.*, and `@source inline()` in CSS.
 */
export const tailwindAdapter: FrameworkAdapter = {
  id: 'tailwind',
  title: 'Tailwind CSS',
  version: 1,
  extensions: [],
  priority: 0,
  detect(input) {
    if (input.dependencies.has('tailwindcss')) return { detected: true, reason: 'tailwindcss dependency in package.json' };
    const config = input.paths.find((p) => /(^|\/)tailwind\.config\.(js|cjs|mjs|ts)$/.test(p));
    if (config) return { detected: true, reason: `${config} found` };
    if (input.tailwindDirectives.size > 0) return { detected: true, reason: `Tailwind directives in CSS (${[...input.tailwindDirectives].join(', ')})` };
    return { detected: false, reason: 'no Tailwind dependency, config or directives' };
  },
  projectHook(ctx) {
    let safelisted = 0;
    for (const file of ctx.files) {
      if (!/(^|\/)tailwind\.config\.(js|cjs|mjs|ts)$/.test(file.path)) continue;
      const { classes, patterns } = readTailwindSafelist(file.content, file.path);
      for (const c of classes) {
        const list = ctx.references.classes.get(c) ?? [];
        list.push({ file: file.path, line: 1, column: 1, via: 'tailwind-safelist' });
        ctx.references.classes.set(c, list);
        safelisted++;
      }
      for (const prefix of patterns) {
        ctx.references.dynamicPatterns.push({ kind: 'class', prefix, suffix: '', file: file.path, line: 1, column: 1, via: 'tailwind-safelist-pattern' });
      }
    }
    for (const at of ctx.project.atRules) {
      if (at.name !== 'source') continue;
      const m = /inline\(\s*["']([^"']*)["']\s*\)/.exec(at.params);
      if (!m) continue;
      for (const raw of m[1]!.split(/\s+/).filter(Boolean)) {
        for (const c of expandBraces(raw)) {
          const list = ctx.references.classes.get(c) ?? [];
          list.push({ file: at.file, line: at.line, column: at.column, via: 'tailwind-source-inline' });
          ctx.references.classes.set(c, list);
          safelisted++;
        }
      }
    }
    const directives = ctx.project.stylesheets.filter((s) => s.tailwindDirectives.length);
    ctx.note(
      `Tailwind CSS: ${directives.length} stylesheet(s) with Tailwind directives; generated utilities are not part of the source CSS, so only custom CSS is analysed${safelisted ? `; ${safelisted} safelisted class(es) read statically` : ''}.`,
    );
  },
};
