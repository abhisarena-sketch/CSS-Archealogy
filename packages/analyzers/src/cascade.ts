import {
  compareSpecificity,
  formatSpecificity,
  type CssContext,
  type CssDeclaration,
  type CssRule,
  type ConfidenceFactor,
  type ProjectModel,
  type SelectorPart,
  factor,
} from '@css-archaeology/core';

/** Shorthand properties and the longhands they reset. */
export const SHORTHANDS: Record<string, string[]> = {
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'margin-block', 'margin-inline', 'margin-block-start', 'margin-block-end', 'margin-inline-start', 'margin-inline-end'],
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'padding-block', 'padding-inline', 'padding-block-start', 'padding-block-end', 'padding-inline-start', 'padding-inline-end'],
  inset: ['top', 'right', 'bottom', 'left', 'inset-block', 'inset-inline'],
  border: [
    'border-width', 'border-style', 'border-color',
    'border-top', 'border-right', 'border-bottom', 'border-left',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  ],
  'border-width': ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'],
  'border-style': ['border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style'],
  'border-color': ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'],
  'border-top': ['border-top-width', 'border-top-style', 'border-top-color'],
  'border-right': ['border-right-width', 'border-right-style', 'border-right-color'],
  'border-bottom': ['border-bottom-width', 'border-bottom-style', 'border-bottom-color'],
  'border-left': ['border-left-width', 'border-left-style', 'border-left-color'],
  'border-radius': ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'],
  background: ['background-color', 'background-image', 'background-position', 'background-size', 'background-repeat', 'background-attachment', 'background-origin', 'background-clip'],
  font: ['font-family', 'font-size', 'font-weight', 'font-style', 'font-variant', 'line-height', 'font-stretch'],
  flex: ['flex-grow', 'flex-shrink', 'flex-basis'],
  'flex-flow': ['flex-direction', 'flex-wrap'],
  gap: ['row-gap', 'column-gap'],
  overflow: ['overflow-x', 'overflow-y'],
  outline: ['outline-width', 'outline-style', 'outline-color'],
  transition: ['transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay'],
  animation: ['animation-name', 'animation-duration', 'animation-timing-function', 'animation-delay', 'animation-iteration-count', 'animation-direction', 'animation-fill-mode', 'animation-play-state'],
  'list-style': ['list-style-type', 'list-style-position', 'list-style-image'],
  'text-decoration': ['text-decoration-line', 'text-decoration-color', 'text-decoration-style', 'text-decoration-thickness'],
  'grid-template': ['grid-template-rows', 'grid-template-columns', 'grid-template-areas'],
  'grid-area': ['grid-row-start', 'grid-column-start', 'grid-row-end', 'grid-column-end'],
  'grid-row': ['grid-row-start', 'grid-row-end'],
  'grid-column': ['grid-column-start', 'grid-column-end'],
  'place-items': ['align-items', 'justify-items'],
  'place-content': ['align-content', 'justify-content'],
  'place-self': ['align-self', 'justify-self'],
  columns: ['column-width', 'column-count'],
};

/** Properties whose declared value is reset by a later declaration of `prop`. */
export function resetsProperty(later: string, earlier: string): boolean {
  if (later === earlier) return true;
  const longhands = SHORTHANDS[later];
  if (!longhands) return false;
  if (longhands.includes(earlier)) return true;
  // border resets border-top-width via border-top, and so on.
  return longhands.some((l) => SHORTHANDS[l]?.includes(earlier));
}

/** Shorthands (transitively) that can reset `prop`. */
export function shorthandsOf(prop: string): string[] {
  return Object.keys(SHORTHANDS).filter((s) => s !== prop && resetsProperty(s, prop));
}

function isSubset(small: string[], big: string[]): boolean {
  return small.every((item) => big.includes(item));
}

/**
 * True when every condition of `outer` is also a condition of `inner`, so `outer` applies
 * whenever `inner` does. Cascade layers are not conditions; they are compared by
 * {@link cascadeCompare}.
 */
export function contextCovers(outer: CssContext, inner: CssContext): boolean {
  return (
    isSubset(outer.media, inner.media) &&
    isSubset(outer.supports, inner.supports) &&
    isSubset(outer.container, inner.container) &&
    isSubset(outer.scope, inner.scope)
  );
}

/** Contexts that can be active at the same time (approximation: no conflicting media evaluation). */
export function sameContext(a: CssContext, b: CssContext): boolean {
  return a.layer === b.layer && contextCovers(a, b) && contextCovers(b, a);
}

/**
 * True when selector `outer` matches every element `inner` matches: identical text, or
 * `outer` is a single compound whose simple selectors all appear in `inner`'s key compound.
 */
export function selectorCovers(outer: SelectorPart, inner: SelectorPart): boolean {
  if (outer.unparseable || inner.unparseable) return false;
  if (outer.text === inner.text) return true;
  // A pseudo-element is a different box: `.a` does not style `.a::before`.
  if (outer.pseudoElements.join() !== inner.pseudoElements.join()) return false;
  if (outer.compounds !== 1 || outer.keyAll.length === 0) return false;
  if (outer.keyAll.some((s) => s === '*')) return false;
  return isSubset(outer.keyAll, inner.keyAll);
}

export function compoundKey(simples: string[]): string {
  return [...simples].sort().join('');
}

export interface CascadeEntry {
  decl: CssDeclaration;
  rule: CssRule;
  part: SelectorPart;
}

function layerRank(project: ProjectModel, layer: string | null): number {
  if (layer === null) return Number.POSITIVE_INFINITY;
  const i = project.layerOrder.indexOf(layer);
  return i < 0 ? project.layerOrder.length : i;
}

export type CascadeReason = 'importance' | 'layer' | 'specificity' | 'order';

/** Compare two declarations for an element both apply to. Positive when `a` wins. */
export function cascadeCompare(project: ProjectModel, a: CascadeEntry, b: CascadeEntry): { result: number; reason: CascadeReason } {
  if (a.decl.important !== b.decl.important) return { result: a.decl.important ? 1 : -1, reason: 'importance' };
  const la = layerRank(project, a.rule.context.layer);
  const lb = layerRank(project, b.rule.context.layer);
  if (la !== lb) {
    const normal = la > lb ? 1 : -1;
    return { result: a.decl.important ? -normal : normal, reason: 'layer' };
  }
  const spec = compareSpecificity(a.part.specificity, b.part.specificity);
  if (spec !== 0) return { result: spec, reason: 'specificity' };
  return { result: a.decl.order - b.decl.order, reason: 'order' };
}

export function describeWin(reason: CascadeReason, winner: CascadeEntry, loser: CascadeEntry): string {
  switch (reason) {
    case 'importance':
      return 'it is declared with !important';
    case 'layer':
      return `its cascade layer (${winner.rule.context.layer ?? 'unlayered'}) takes precedence over ${loser.rule.context.layer ?? 'unlayered styles'}`;
    case 'specificity':
      return `its selector is more specific ${formatSpecificity(winner.part.specificity)} > ${formatSpecificity(loser.part.specificity)}`;
    case 'order':
      return winner.decl.file === loser.decl.file ? 'it appears later in the same stylesheet' : 'its stylesheet is loaded later';
  }
}

/** Confidence factors describing how reliable the relative order of two declarations is. */
export function orderFactors(project: ProjectModel, a: CssDeclaration, b: CssDeclaration, reason: CascadeReason): { factors: ConfidenceFactor[]; approximate: boolean } {
  if (a.file === b.file) return { factors: [factor('same-file', 0.05, 'Both declarations are in the same stylesheet.')], approximate: false };
  if (reason !== 'order') {
    return { factors: [factor('cross-file', -0.05, 'Declarations are in different stylesheets, but the outcome does not depend on load order.')], approximate: false };
  }
  const known = project.orderSource.get(a.file) === 'import-graph' && project.orderSource.get(b.file) === 'import-graph';
  if (known) {
    return { factors: [factor('cross-file-import-order', -0.2, 'Stylesheet order was derived from import statements, which bundlers may reorder.')], approximate: true };
  }
  return { factors: [factor('cross-file-path-order', -0.4, 'Stylesheet load order is unknown; files were ordered by path.')], approximate: true };
}

/** Rules in CSS Modules are file-scoped: class selectors in different module files never match the same element. */
export function canInteract(a: CssRule, b: CssRule, partA: SelectorPart, partB: SelectorPart): boolean {
  if (a.file === b.file) return true;
  const scopedA = a.isModule && !partA.hasGlobal && partA.classes.length > 0;
  const scopedB = b.isModule && !partB.hasGlobal && partB.classes.length > 0;
  return !scopedA && !scopedB;
}

/**
 * Heuristic for intentional fallbacks inside one block, e.g.
 * `display: -webkit-box; display: flex` or `width: 100px; width: calc(100% - 1rem)`.
 */
export function isFallbackPair(earlier: string, later: string): boolean {
  const features = (v: string) => {
    const set = new Set<string>();
    for (const m of v.matchAll(/([a-z-]+)\(/gi)) set.add(`fn:${m[1]!.toLowerCase()}`);
    for (const m of v.matchAll(/-(webkit|moz|ms|o)-/gi)) set.add(`prefix:${m[1]!.toLowerCase()}`);
    for (const m of v.matchAll(/\d(dvh|svh|lvh|dvw|svw|lvw|cqw|cqh|cqi|cqb|vi|vb|lh|rlh)\b/gi)) set.add(`unit:${m[1]!.toLowerCase()}`);
    return set;
  };
  const a = features(earlier);
  const b = features(later);
  for (const f of b) if (!a.has(f)) return true;
  for (const f of a) if (f.startsWith('prefix:') && !b.has(f)) return true;
  return false;
}

export function snippetOf(decl: CssDeclaration): string {
  return `${decl.prop}: ${decl.value}${decl.important ? ' !important' : ''}`;
}

export function contextLabel(rule: CssRule): string {
  return rule.contextKey || 'no at-rule conditions';
}
