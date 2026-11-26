import selectorParser from 'postcss-selector-parser';
import type { SelectorPart, SelectorRequirements, Specificity } from './types.js';

type Node = selectorParser.Node;
type Selector = selectorParser.Selector;

const LEGACY_PSEUDO_ELEMENTS = new Set([':before', ':after', ':first-line', ':first-letter']);
/** Pseudo-classes whose argument list contributes the max specificity of its arguments. */
const MAX_ARG_PSEUDOS = new Set([':is', ':not', ':has', ':matches', ':-webkit-any', ':-moz-any']);
const ZERO_PSEUDOS = new Set([':where']);
const NTH_OF_PSEUDOS = new Set([':nth-child', ':nth-last-child']);
const TRANSPARENT_PSEUDOS = new Set([':global', ':local']);
/** Elements that always exist in a rendered document. */
const IMPLICIT_ELEMENTS = new Set(['html', 'body', 'head']);

export function emptyRequirements(): SelectorRequirements {
  return { classes: [], ids: [], elements: [], attributes: [], alternatives: [] };
}

export function compareSpecificity(a: Specificity, b: Specificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export function addSpecificity(a: Specificity, b: Specificity): Specificity {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function maxSpecificity(list: Specificity[]): Specificity {
  let max: Specificity = [0, 0, 0];
  for (const s of list) if (compareSpecificity(s, max) > 0) max = s;
  return max;
}

export function formatSpecificity(s: Specificity): string {
  return `(${s[0]},${s[1]},${s[2]})`;
}

/**
 * Split a selector list on top-level commas. Works on raw text so it also handles
 * SCSS-only constructs (such as `&-suffix`) that a CSS selector parser rejects.
 */
export function splitSelectorList(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      current += ch;
      if (ch === '\\' && i + 1 < text.length) {
        current += text[++i];
      } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\\' && i + 1 < text.length) {
      current += ch + text[++i];
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      if (current.trim()) out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function containsNesting(text: string): boolean {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '&') return true;
  }
  return false;
}

function replaceNesting(text: string, parent: string): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      out += ch;
      if (ch === '\\' && i + 1 < text.length) out += text[++i];
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\\' && i + 1 < text.length) {
      out += ch + text[++i];
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    if (ch === '&') {
      out += parent;
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Resolve a nested rule's selector against its parent selectors.
 *
 * Native CSS nesting and SCSS both replace `&` with the parent selector; selectors
 * without `&` become descendants of the parent. For selector lists the result is
 * the cartesian product, which matches SCSS output and approximates the `:is()`
 * semantics of native nesting (specificity may differ when parents differ).
 */
export function resolveNestedSelector(parents: string[], child: string): string[] {
  const children = splitSelectorList(child);
  if (parents.length === 0) return children;
  const out: string[] = [];
  for (const parent of parents) {
    for (const c of children) {
      if (containsNesting(c)) out.push(replaceNesting(c, parent));
      else if (/^[>+~]/.test(c)) out.push(`${parent} ${c}`);
      else out.push(`${parent} ${c}`);
    }
  }
  return out;
}

const parserInstance = selectorParser();

function normaliseNode(root: selectorParser.Root): void {
  root.walk((node) => {
    if (node.type === 'combinator') {
      const value = node.value.trim();
      node.value = value === '' ? ' ' : ` ${value} `;
      node.spaces.before = '';
      node.spaces.after = '';
      if (node.raws) delete (node.raws as { spaces?: unknown }).spaces;
    } else if (node.type !== 'selector') {
      node.spaces.before = '';
      node.spaces.after = '';
    } else {
      // Selector lists inside pseudo-classes read as `:is(.a, .b)`.
      const inPseudo = node.parent?.type === 'pseudo' && node.parent.index(node) > 0;
      node.spaces.before = inPseudo ? ' ' : '';
      node.spaces.after = '';
    }
  });
}

export function normaliseSelector(text: string): string {
  try {
    const root = parserInstance.astSync(text);
    normaliseNode(root);
    return root
      .toString()
      .replace(/\s*,\s*/g, ', ')
      .trim();
  } catch {
    return text.replace(/\s+/g, ' ').trim();
  }
}

interface WalkState {
  classes: Set<string>;
  ids: Set<string>;
  elements: Set<string>;
  attributes: Set<string>;
  pseudoClasses: Set<string>;
  pseudoElements: Set<string>;
  hasGlobal: boolean;
}

function selectorSpecificity(selector: Selector): Specificity {
  let s: Specificity = [0, 0, 0];
  for (const node of selector.nodes) s = addSpecificity(s, nodeSpecificity(node));
  return s;
}

function nodeSpecificity(node: Node): Specificity {
  switch (node.type) {
    case 'id':
      return [1, 0, 0];
    case 'class':
    case 'attribute':
      return [0, 1, 0];
    case 'tag':
      return [0, 0, 1];
    case 'pseudo': {
      const name = node.value.toLowerCase();
      const args = (node.nodes ?? []) as Selector[];
      if (TRANSPARENT_PSEUDOS.has(name)) return maxSpecificity(args.map(selectorSpecificity));
      if (ZERO_PSEUDOS.has(name)) return [0, 0, 0];
      if (MAX_ARG_PSEUDOS.has(name)) return maxSpecificity(args.map(selectorSpecificity));
      if (NTH_OF_PSEUDOS.has(name)) {
        // :nth-child(2n+1 of .foo) adds the most specific argument selector.
        return addSpecificity([0, 1, 0], nthOfSpecificity(args));
      }
      if (name.startsWith('::') || LEGACY_PSEUDO_ELEMENTS.has(name)) {
        // ::slotted(x) / ::part(x): the pseudo-element plus its argument.
        if (name === '::slotted') return addSpecificity([0, 0, 1], maxSpecificity(args.map(selectorSpecificity)));
        return [0, 0, 1];
      }
      if (name === ':host' || name === ':host-context') return addSpecificity([0, 1, 0], maxSpecificity(args.map(selectorSpecificity)));
      return [0, 1, 0];
    }
    default:
      return [0, 0, 0];
  }
}

/** Specificity of the `of S` part of `:nth-child(An+B of S)`; zero when absent. */
function nthOfSpecificity(args: Selector[]): Specificity {
  const first = args[0];
  if (!first) return [0, 0, 0];
  const ofIndex = first.nodes.findIndex((n) => n.type === 'tag' && n.value.toLowerCase() === 'of');
  if (ofIndex < 0) return [0, 0, 0];
  const list: Specificity[] = [];
  let s: Specificity = [0, 0, 0];
  for (const node of first.nodes.slice(ofIndex + 1)) s = addSpecificity(s, nodeSpecificity(node));
  list.push(s);
  for (const arg of args.slice(1)) list.push(selectorSpecificity(arg));
  return maxSpecificity(list);
}

export function calculateSpecificity(selector: string): Specificity {
  try {
    const root = parserInstance.astSync(selector);
    return maxSpecificity(root.nodes.map(selectorSpecificity));
  } catch {
    return [0, 0, 0];
  }
}

function collectRequirements(selector: Selector, state: WalkState, insideNegation: boolean): SelectorRequirements {
  const req = emptyRequirements();
  for (const node of selector.nodes) {
    switch (node.type) {
      case 'class':
        state.classes.add(node.value);
        if (!insideNegation) req.classes.push(node.value);
        break;
      case 'id':
        state.ids.add(node.value);
        if (!insideNegation) req.ids.push(node.value);
        break;
      case 'tag': {
        const tag = node.value.toLowerCase();
        state.elements.add(tag);
        if (!insideNegation && !IMPLICIT_ELEMENTS.has(tag)) req.elements.push(tag);
        break;
      }
      case 'attribute':
        state.attributes.add(node.attribute.toLowerCase());
        if (!insideNegation) req.attributes.push(node.attribute.toLowerCase());
        break;
      case 'pseudo': {
        const name = node.value.toLowerCase();
        const args = (node.nodes ?? []) as Selector[];
        if (name.startsWith('::') || LEGACY_PSEUDO_ELEMENTS.has(name)) state.pseudoElements.add(name);
        else state.pseudoClasses.add(name);
        if (TRANSPARENT_PSEUDOS.has(name)) {
          state.hasGlobal ||= name === ':global';
          for (const arg of args) mergeRequirements(req, collectRequirements(arg, state, insideNegation));
        } else if (name === ':not') {
          for (const arg of args) collectRequirements(arg, state, true);
        } else if (MAX_ARG_PSEUDOS.has(name) || ZERO_PSEUDOS.has(name) || name === ':host' || name === ':host-context' || name === '::slotted') {
          const alternatives = args.map((arg) => collectRequirements(arg, state, insideNegation));
          if (!insideNegation && alternatives.length > 0) {
            if (alternatives.length === 1) mergeRequirements(req, alternatives[0]!);
            else req.alternatives.push(alternatives);
          }
        }
        // Other functional pseudo-classes (:nth-child(), :lang(), :dir(), ...) take
        // arguments that are not element requirements.
        break;
      }
      default:
        break;
    }
  }
  return req;
}

function mergeRequirements(target: SelectorRequirements, source: SelectorRequirements): void {
  target.classes.push(...source.classes);
  target.ids.push(...source.ids);
  target.elements.push(...source.elements);
  target.attributes.push(...source.attributes);
  target.alternatives.push(...source.alternatives);
}

function splitCompounds(selector: Selector): Node[][] {
  const compounds: Node[][] = [[]];
  for (const node of selector.nodes) {
    if (node.type === 'combinator') compounds.push([]);
    else if (node.type !== 'comment') compounds[compounds.length - 1]!.push(node);
  }
  return compounds.filter((c) => c.length > 0);
}

function countSimple(selector: Selector): number {
  let count = 0;
  selector.walk((node) => {
    if (node.type !== 'selector' && node.type !== 'combinator' && node.type !== 'comment' && node.type !== 'nesting') count++;
  });
  return count;
}

const STATE_PSEUDO = /^:(hover|focus|focus-visible|focus-within|active|visited|link|checked|disabled|enabled|invalid|valid|required|optional|placeholder-shown|target|empty|first-child|last-child|only-child|first-of-type|last-of-type|nth-child|nth-of-type|nth-last-child|nth-last-of-type|read-only|read-write|indeterminate|default|open|popover-open|modal|autofill|user-invalid|user-valid)$/;

/** Parse one (complex) selector into the structure used by analyzers. */
export function analyzeSelector(text: string): SelectorPart {
  const unparseableResult = (): SelectorPart => ({
    text: text.replace(/\s+/g, ' ').trim(),
    specificity: [0, 0, 0],
    classes: [],
    ids: [],
    elements: [],
    attributes: [],
    pseudoClasses: [],
    pseudoElements: [],
    compounds: 1,
    simpleSelectors: 0,
    keyCompound: text.trim(),
    keySimple: [],
    keyAll: [],
    hasGlobal: false,
    unparseable: true,
    requirements: emptyRequirements(),
  });
  if (/#\{|@\{|\$\{/.test(text)) return unparseableResult();
  let root: selectorParser.Root;
  try {
    root = parserInstance.astSync(text);
  } catch {
    return unparseableResult();
  }
  const selector = root.nodes[0];
  if (!selector) return unparseableResult();
  normaliseNode(root);
  const state: WalkState = {
    classes: new Set(),
    ids: new Set(),
    elements: new Set(),
    attributes: new Set(),
    pseudoClasses: new Set(),
    pseudoElements: new Set(),
    hasGlobal: false,
  };
  const requirements = collectRequirements(selector, state, false);
  const compounds = splitCompounds(selector);
  const key = compounds[compounds.length - 1] ?? [];
  const keySimple = key
    .filter((n) => !(n.type === 'pseudo' && (STATE_PSEUDO.test(n.value.toLowerCase()) || n.value.startsWith('::'))))
    .map((n) => n.toString())
    .sort();
  let nesting = false;
  selector.walkNesting(() => {
    nesting = true;
  });
  return {
    text: selector.toString().trim(),
    specificity: selectorSpecificity(selector),
    classes: [...state.classes],
    ids: [...state.ids],
    elements: [...state.elements],
    attributes: [...state.attributes],
    pseudoClasses: [...state.pseudoClasses],
    pseudoElements: [...state.pseudoElements],
    compounds: compounds.length,
    simpleSelectors: countSimple(selector),
    keyCompound: key.map((n) => n.toString()).join(''),
    keySimple,
    keyAll: key.map((n) => n.toString()).sort(),
    hasGlobal: state.hasGlobal,
    unparseable: nesting,
    requirements,
  };
}

/** Score used to rank "most complex" selectors. */
export function selectorComplexityScore(part: SelectorPart): number {
  const [a, b, c] = part.specificity;
  return part.compounds * 2 + part.simpleSelectors + a * 10 + b + c * 0.5 + part.pseudoClasses.length;
}

/** Pseudo-classes that represent element state rather than a different element. */
export function isStatePseudo(name: string): boolean {
  return STATE_PSEUDO.test(name);
}
