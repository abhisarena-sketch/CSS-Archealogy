import { factor, formatSpecificity, type Analyzer, type FindingDraft, type CssDeclaration, type Evidence } from '@css-archaeology/core';
import {
  canInteract,
  cascadeCompare,
  compoundKey,
  contextCovers,
  describeWin,
  isFallbackPair,
  orderFactors,
  resetsProperty,
  selectorCovers,
  shorthandsOf,
  snippetOf,
  type CascadeEntry,
} from './cascade.js';

const MAX_SUBSET_SIZE = 6;

function subsets(items: string[]): string[] {
  const sorted = [...items].sort().slice(0, MAX_SUBSET_SIZE);
  const out: string[] = [];
  for (let mask = 1; mask < 1 << sorted.length; mask++) {
    const pick: string[] = [];
    for (let i = 0; i < sorted.length; i++) if (mask & (1 << i)) pick.push(sorted[i]!);
    out.push(pick.join(''));
  }
  return out;
}

export const overriddenDeclarationsAnalyzer: Analyzer = {
  id: 'overridden-declarations',
  configKey: 'overriddenDeclarations',
  title: 'Overridden declarations',
  description: 'Finds declarations that can never take effect because a later or stronger declaration always wins.',
  rules: [
    {
      id: 'overridden-declaration',
      title: 'Overridden declaration',
      description: 'A declaration is always overridden by another declaration that applies to the same elements under the same or broader conditions.',
      defaultSeverity: 'medium',
      rationale:
        'For every element the selector matches, another declaration of the same property (or a shorthand that resets it) applies under the same or broader at-rule conditions and wins the cascade by importance, layer, specificity or source order. The overridden declaration is dead code. Cascade evaluation is approximate: selectors are compared structurally, media queries are compared as written, and cross-file order depends on how stylesheets are loaded. Inherited values never override declared values, so inheritance is not treated as an override.',
    },
  ],
  run(ctx) {
    const { project } = ctx;
    const findings: FindingDraft[] = [];
    // Index: prop -> (selector text | single-compound key) -> entries
    const byText = new Map<string, Map<string, CascadeEntry[]>>();
    const byCompound = new Map<string, Map<string, CascadeEntry[]>>();
    // CSS Module classes are file-scoped, so they live in their own bucket per file.
    // This keeps lookups linear for projects with thousands of modules sharing class names.
    const scopeKey = (rule: CascadeEntry['rule'], part: CascadeEntry['part'], key: string) =>
      rule.isModule && !part.hasGlobal && part.classes.length > 0 ? `${rule.file}\u0000${key}` : key;
    const lookup = (index: Map<string, Map<string, CascadeEntry[]>>, prop: string, file: string, key: string): CascadeEntry[] => {
      const m = index.get(prop);
      if (!m) return [];
      const shared = m.get(key) ?? [];
      const local = m.get(`${file}\u0000${key}`);
      return local ? [...shared, ...local] : shared;
    };
    const push = (index: Map<string, Map<string, CascadeEntry[]>>, prop: string, key: string, entry: CascadeEntry) => {
      let m = index.get(prop);
      if (!m) index.set(prop, (m = new Map()));
      const list = m.get(key);
      if (list) list.push(entry);
      else m.set(key, [entry]);
    };
    for (const rule of project.rules) {
      for (const part of rule.selectors) {
        if (part.unparseable) continue;
        for (const i of rule.declarationIndexes) {
          const decl = project.declarations[i]!;
          if (decl.custom) continue;
          const entry = { decl, rule, part };
          push(byText, decl.prop, scopeKey(rule, part, part.text), entry);
          if (part.compounds === 1 && part.keyAll.length) push(byCompound, decl.prop, scopeKey(rule, part, compoundKey(part.keyAll)), entry);
        }
      }
    }

    const reported = new Set<number>();
    for (const rule of project.rules) {
      for (const i of rule.declarationIndexes) {
        const decl = project.declarations[i]!;
        if (decl.custom || reported.has(decl.index)) continue;
        const overriders: { winner: CascadeEntry; loser: CascadeEntry; reason: ReturnType<typeof cascadeCompare>['reason'] }[] = [];
        let allParts = true;
        for (const part of rule.selectors) {
          if (part.unparseable) {
            allParts = false;
            break;
          }
          const self: CascadeEntry = { decl, rule, part };
          const props = [decl.prop, ...shorthandsOf(decl.prop)];
          const keySubsets = subsets(part.keyAll);
          let best: (typeof overriders)[number] | null = null;
          for (const prop of props) {
            const candidates = [
              ...lookup(byText, prop, rule.file, part.text),
              ...keySubsets.flatMap((key) => lookup(byCompound, prop, rule.file, key)),
            ];
            for (const other of candidates) {
              if (other.decl.index === decl.index) continue;
              if (!resetsProperty(other.decl.prop, decl.prop)) continue;
              if (other.decl.prop === decl.prop && other.decl.value === decl.value) continue; // duplicates are reported separately
              if (!selectorCovers(other.part, part)) continue;
              if (!contextCovers(other.rule.context, rule.context)) continue;
              if (!canInteract(other.rule, rule, other.part, part)) continue;
              if (other.rule.index === rule.index && other.decl.prop === decl.prop && isFallbackPair(decl.value, other.decl.value)) continue;
              const cmp = cascadeCompare(project, other, self);
              if (cmp.result <= 0) continue;
              if (!best || other.decl.order > best.winner.decl.order) best = { winner: other, loser: self, reason: cmp.reason };
            }
          }
          if (!best) {
            allParts = false;
            break;
          }
          overriders.push(best);
        }
        if (!allParts || overriders.length === 0) continue;
        reported.add(decl.index);
        const first = overriders[0]!;
        const winner = first.winner.decl;
        const order = orderFactors(project, decl, winner, first.reason);
        const factors = [...order.factors];
        if (winner.prop !== decl.prop) factors.push(factor('shorthand', -0.05, `Overridden through the ${winner.prop} shorthand.`));
        if (first.winner.part.text !== first.loser.part.text) {
          factors.push(factor('covering-selector', -0.05, `Overriding selector ${first.winner.part.text} matches a superset of ${first.loser.part.text}.`));
        }
        if (rule.context.media.length && !first.winner.rule.context.media.length) {
          factors.push(factor('media-before-base', 0.05, 'A base rule declared after the media query always wins, so the responsive value never applies.'));
        }
        const evidence: Evidence[] = [
          { kind: 'declaration', message: 'Overridden declaration', file: decl.file, line: decl.line, column: decl.column, snippet: snippetOf(decl) },
          ...overriders.map((o): Evidence => ({
            kind: 'declaration',
            message: `Overridden for ${o.loser.part.text} by ${o.winner.part.text} because ${describeWin(o.reason, o.winner, o.loser)}`,
            file: o.winner.decl.file,
            line: o.winner.decl.line,
            column: o.winner.decl.column,
            snippet: snippetOf(o.winner.decl),
          })),
        ];
        if (rule.contextKey) evidence.push({ kind: 'context', message: `Declared under ${rule.contextKey}` });
        findings.push({
          rule: 'overridden-declaration',
          severity: 'medium',
          baseConfidence: 0.82,
          confidenceFactors: factors,
          title: `Overridden ${decl.prop} declaration`,
          description: `\`${snippetOf(decl)}\` on ${rule.selectorText} never takes effect: ${winnerSummary(winner, first.reason, first)}.`,
          file: decl.file,
          line: decl.line,
          column: decl.column,
          selector: rule.selectorText,
          property: decl.prop,
          value: decl.value,
          evidence,
          suggestion:
            first.reason === 'order' && rule.context.media.length && !first.winner.rule.context.media.length
              ? 'Move the media query after the base rule, or remove the overridden declaration if it is no longer needed.'
              : 'Remove the overridden declaration, or adjust the cascade if it was meant to apply.',
          approximate: order.approximate || first.winner.part.text !== first.loser.part.text,
          data: {
            overriddenBy: overriders.map((o) => ({ file: o.winner.decl.file, line: o.winner.decl.line, selector: o.winner.part.text, reason: o.reason })),
          },
        });
      }
    }
    return findings;
  },
};

function winnerSummary(winner: CssDeclaration, reason: string, o: { winner: CascadeEntry; loser: CascadeEntry }): string {
  const where = `${winner.file}:${winner.line}`;
  const why =
    reason === 'specificity'
      ? `a more specific selector ${formatSpecificity(o.winner.part.specificity)}`
      : reason === 'importance'
        ? '!important'
        : reason === 'layer'
          ? 'cascade layer precedence'
          : 'source order';
  return `\`${snippetOf(winner)}\` at ${where} wins by ${why}`;
}
