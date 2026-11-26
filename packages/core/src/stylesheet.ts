import postcss, { type AtRule, type ChildNode, type Container, type Declaration, type Root, type Rule } from 'postcss';
import safeParse from 'postcss-safe-parser';
import scssSyntax from 'postcss-scss';
import { analyzeSelector, resolveNestedSelector, splitSelectorList } from './selectors.js';
import type {
  AtRuleRecord,
  CssContext,
  ParseIssue,
  SelectorPart,
  StylesheetRecord,
  StylesheetSyntax,
} from './types.js';

/** Bump when the shape of {@link StylesheetModel} changes so caches are invalidated. */
export const STYLESHEET_MODEL_VERSION = 3;

export interface LocalDeclaration {
  line: number;
  column: number;
  prop: string;
  value: string;
  rawValue: string;
  important: boolean;
}

export interface LocalRule {
  line: number;
  column: number;
  endLine: number;
  rawSelector: string;
  selectorText: string;
  selectors: SelectorPart[];
  context: CssContext;
  contextKey: string;
  nestingDepth: number;
  declarations: LocalDeclaration[];
}

export interface CssSideReference {
  kind: 'class';
  name: string;
  line: number;
  column: number;
  via: 'composes' | 'apply' | 'extend';
  /** For `composes: x from './other.module.css'`, the module the class lives in. */
  from?: string;
}

/** File-local, serialisable model of one stylesheet. */
export interface StylesheetModel {
  version: number;
  record: Omit<StylesheetRecord, 'orderIndex'>;
  rules: LocalRule[];
  atRules: AtRuleRecord[];
  /** Cascade layer names in order of first appearance. */
  layers: string[];
  cssReferences: CssSideReference[];
  /** Raw tokens from `@apply` directives (Tailwind), including variants. */
  applyTokens: string[];
}

export interface ParseOptions {
  syntax?: StylesheetSyntax;
  /** 1-based line in the host file where this stylesheet starts. */
  lineOffset?: number;
  embeddedIn?: string;
}

const TAILWIND_AT_RULES = new Set([
  'tailwind',
  'apply',
  'theme',
  'config',
  'plugin',
  'source',
  'utility',
  'variant',
  'custom-variant',
  'reference',
  'screen',
  'layer-tailwind',
]);
const SKIP_CONTENT_AT_RULES = new Set([
  'font-face',
  'page',
  'property',
  'counter-style',
  'font-feature-values',
  'font-palette-values',
  'view-transition',
  'mixin',
  'function',
  'return',
  'charset',
  'namespace',
]);
const CONTEXT_AT_RULES = new Set(['media', 'supports', 'container', 'scope']);

export function detectSyntax(path: string): StylesheetSyntax {
  return /\.scss$/i.test(path) ? 'scss' : 'css';
}

export function isCssModulePath(path: string): boolean {
  return /\.module\.(css|scss|pcss)$/i.test(path);
}

export function emptyContext(): CssContext {
  return { media: [], supports: [], container: [], layer: null, scope: [] };
}

export function contextKey(ctx: CssContext): string {
  return [
    ctx.media.length ? `@media ${ctx.media.join(' and ')}` : '',
    ctx.supports.length ? `@supports ${ctx.supports.join(' and ')}` : '',
    ctx.container.length ? `@container ${ctx.container.join(' and ')}` : '',
    ctx.layer !== null ? `@layer ${ctx.layer}` : '',
    ctx.scope.length ? `@scope ${ctx.scope.join(' ')}` : '',
  ]
    .filter(Boolean)
    .join(' | ');
}

export function normaliseAtParams(params: string): string {
  return params
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\s*:\s*/g, ': ')
    .replace(/\s*,\s*/g, ', ')
    .trim()
    .toLowerCase();
}

/** Normalise a declaration value for equality comparisons. */
export function normaliseValue(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/#([0-9a-fA-F]{3,8})\b/g, (_m, hex: string) => `#${hex.toLowerCase()}`)
    .trim();
}

function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

export function countLines(text: string): number {
  if (text.length === 0) return 0;
  let lines = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
  if (text.endsWith('\n')) lines--;
  return lines;
}

function parseImportTarget(params: string): string | null {
  const m = /^\s*(?:url\(\s*)?["']?([^"')\s]+)["']?\s*\)?/.exec(params);
  return m?.[1] ?? null;
}

function layerFromImport(params: string): string | null {
  const m = /\blayer(?:\(([^)]*)\))?/.exec(params);
  if (!m) return null;
  return m[1]?.trim() || '<anonymous>';
}

export function parseStylesheet(file: string, content: string, options: ParseOptions = {}): StylesheetModel {
  const syntax = options.syntax ?? detectSyntax(file);
  const lineOffset = (options.lineOffset ?? 1) - 1;
  const isModule = isCssModulePath(file);
  const parseIssues: ParseIssue[] = [];
  let root: Root;
  try {
    root = syntax === 'scss' ? scssSyntax.parse(content, { from: file }) : postcss.parse(content, { from: file });
  } catch (error) {
    const err = error as { line?: number; column?: number; reason?: string; message?: string };
    parseIssues.push({
      file,
      line: (err.line ?? 1) + lineOffset,
      column: err.column ?? 1,
      message: err.reason ?? err.message ?? 'Unknown parse error',
      kind: 'recovered',
    });
    try {
      root = safeParse(content, { from: file }) as Root;
    } catch (fatal) {
      parseIssues[parseIssues.length - 1]!.kind = 'fatal';
      root = postcss.root();
      void fatal;
    }
  }

  const rules: LocalRule[] = [];
  const atRules: AtRuleRecord[] = [];
  const layers: string[] = [];
  const cssReferences: CssSideReference[] = [];
  const applyTokens: string[] = [];
  const tailwindDirectives = new Set<string>();
  const imports: string[] = [];
  const selectorCache = new Map<string, SelectorPart>();
  let maxNestingDepth = 0;
  let anonymousLayers = 0;

  const lineOf = (node: ChildNode) => (node.source?.start?.line ?? 1) + lineOffset;
  const columnOf = (node: ChildNode) => node.source?.start?.column ?? 1;
  const partFor = (text: string): SelectorPart => {
    let part = selectorCache.get(text);
    if (!part) {
      part = analyzeSelector(text);
      selectorCache.set(text, part);
    }
    return part;
  };
  const addLayer = (name: string) => {
    if (!layers.includes(name)) layers.push(name);
  };

  const toDeclaration = (decl: Declaration): LocalDeclaration => ({
    line: lineOf(decl),
    column: columnOf(decl),
    prop: decl.prop.startsWith('--') ? decl.prop : decl.prop.toLowerCase(),
    value: decl.prop.startsWith('--') ? decl.value.trim() : normaliseValue(decl.value),
    rawValue: decl.value,
    important: Boolean(decl.important),
  });

  const handleDeclarationReferences = (decl: Declaration) => {
    if (decl.prop.toLowerCase() !== 'composes') return;
    const m = /^(.*?)(?:\s+from\s+(?:["']([^"']+)["']|(global)))?\s*$/.exec(decl.value);
    if (!m) return;
    const names = (m[1] ?? '').split(/\s+/).filter(Boolean);
    const from = m[2] ?? (m[3] ? 'global' : undefined);
    for (const name of names) {
      const ref: CssSideReference = { kind: 'class', name, line: lineOf(decl), column: columnOf(decl), via: 'composes' };
      if (from) ref.from = from;
      cssReferences.push(ref);
    }
  };

  const pushRule = (
    rawSelector: string,
    selectors: string[],
    ctx: CssContext,
    depth: number,
    node: ChildNode,
    declarations: Declaration[],
  ) => {
    const parts = selectors.map(partFor);
    maxNestingDepth = Math.max(maxNestingDepth, depth);
    rules.push({
      line: lineOf(node),
      column: columnOf(node),
      endLine: (node.source?.end?.line ?? node.source?.start?.line ?? 1) + lineOffset,
      rawSelector,
      selectorText: parts.map((p) => p.text).join(', '),
      selectors: parts,
      context: ctx,
      contextKey: contextKey(ctx),
      nestingDepth: depth,
      declarations: declarations.map(toDeclaration),
    });
  };

  const walk = (container: Container, ctx: CssContext, parents: string[] | null, depth: number) => {
    const directDeclarations: Declaration[] = [];
    for (const node of container.nodes ?? []) {
      if (node.type === 'decl') {
        if (parents) {
          directDeclarations.push(node);
          handleDeclarationReferences(node);
        }
      } else if (node.type === 'rule') {
        visitRule(node, ctx, parents, depth);
      } else if (node.type === 'atrule') {
        visitAtRule(node, ctx, parents, depth);
      }
    }
    return directDeclarations;
  };

  const visitRule = (rule: Rule, ctx: CssContext, parents: string[] | null, depth: number) => {
    const raw = rule.selector;
    const resolved = parents ? resolveNestedSelector(parents, raw) : splitSelectorList(raw);
    const declarations = walk(rule, ctx, resolved, depth + 1);
    pushRule(raw, resolved, ctx, depth, rule, declarations);
  };

  const visitAtRule = (at: AtRule, ctx: CssContext, parents: string[] | null, depth: number) => {
    const name = at.name.toLowerCase();
    const params = at.params ?? '';
    const record = (context: CssContext) =>
      atRules.push({
        file,
        line: lineOf(at),
        column: columnOf(at),
        name,
        params: normaliseAtParams(params),
        childCount: at.nodes?.length ?? 0,
        context,
      });

    if (TAILWIND_AT_RULES.has(name)) {
      tailwindDirectives.add(`@${name}`);
      if (name === 'apply') {
        for (const token of params.split(/\s+/).filter(Boolean)) {
          applyTokens.push(token);
          const bare = token.replace(/^!/, '').replace(/!$/, '');
          const last = bare.split(':').pop() ?? bare;
          cssReferences.push({ kind: 'class', name: last, line: lineOf(at), column: columnOf(at), via: 'apply' });
        }
        return;
      }
      record(ctx);
      if (name === 'utility' || name === 'variant' || name === 'custom-variant' || name === 'theme' || name === 'config' || name === 'plugin' || name === 'source') return;
      if (at.nodes) walk(at, ctx, parents, depth);
      return;
    }
    if (name === 'import') {
      record(ctx);
      const target = parseImportTarget(params);
      if (target) {
        if (/^["']?tailwindcss/.test(params.trim()) || target === 'tailwindcss' || target.startsWith('tailwindcss/')) {
          tailwindDirectives.add('@import "tailwindcss"');
        } else imports.push(target);
      }
      const importLayer = layerFromImport(params);
      if (importLayer) addLayer(importLayer);
      return;
    }
    if (name === 'extend') {
      for (const sel of splitSelectorList(params.replace(/!optional/g, ''))) {
        const part = partFor(sel);
        for (const cls of part.classes) cssReferences.push({ kind: 'class', name: cls, line: lineOf(at), column: columnOf(at), via: 'extend' });
      }
      return;
    }
    if (name === 'layer') {
      if (!at.nodes) {
        for (const layer of params.split(',').map((s) => s.trim()).filter(Boolean)) {
          addLayer(ctx.layer ? `${ctx.layer}.${layer}` : layer);
        }
        record(ctx);
        return;
      }
      const own = params.trim() || `<anonymous-${++anonymousLayers}>`;
      const layer = ctx.layer ? `${ctx.layer}.${own}` : own;
      addLayer(layer);
      const next = { ...ctx, layer };
      record(next);
      const decls = walk(at, next, parents, depth);
      if (parents && decls.length) pushRule('&', parents, next, depth, at, decls);
      return;
    }
    if (/^(-\w+-)?keyframes$/.test(name)) {
      record(ctx);
      return;
    }
    if (SKIP_CONTENT_AT_RULES.has(name)) {
      record(ctx);
      return;
    }
    if (CONTEXT_AT_RULES.has(name)) {
      const normalised = normaliseAtParams(params);
      const next: CssContext = {
        media: name === 'media' ? [...ctx.media, normalised] : ctx.media,
        supports: name === 'supports' ? [...ctx.supports, normalised] : ctx.supports,
        container: name === 'container' ? [...ctx.container, normalised] : ctx.container,
        scope: name === 'scope' ? [...ctx.scope, normalised] : ctx.scope,
        layer: ctx.layer,
      };
      record(next);
      const decls = walk(at, next, parents, depth);
      if (parents && decls.length) pushRule('&', parents, next, depth, at, decls);
      return;
    }
    if (name === 'include' || name === 'use' || name === 'forward' || name === 'debug' || name === 'warn' || name === 'error') {
      return;
    }
    // Unknown or control-flow at-rules (@if, @each, @starting-style, ...): analyse contents in place.
    record(ctx);
    if (at.nodes) {
      const decls = walk(at, ctx, parents, depth);
      if (parents && decls.length) pushRule('&', parents, ctx, depth, at, decls);
    }
  };

  walk(root, emptyContext(), null, 0);
  // Keep source order: rules were pushed after their nested children, so sort by position.
  rules.sort((a, b) => a.line - b.line || a.column - b.column);

  let selectorCount = 0;
  let declarationCount = 0;
  let importantCount = 0;
  for (const rule of rules) {
    selectorCount += rule.selectors.length;
    declarationCount += rule.declarations.length;
    for (const d of rule.declarations) if (d.important) importantCount++;
  }

  return {
    version: STYLESHEET_MODEL_VERSION,
    record: {
      file,
      syntax,
      bytes: utf8Length(content),
      lines: countLines(content),
      ruleCount: rules.length,
      selectorCount,
      declarationCount,
      importantCount,
      maxNestingDepth,
      isModule,
      tailwindDirectives: [...tailwindDirectives],
      imports,
      ...(options.embeddedIn ? { embeddedIn: options.embeddedIn } : {}),
      parseIssues,
    },
    rules,
    atRules,
    layers,
    cssReferences,
    applyTokens,
  };
}
