import {
  compareSpecificity,
  factor,
  formatSpecificity,
  type Analyzer,
  type CssRule,
  type Evidence,
  type FindingDraft,
  type SelectorPart,
  type Specificity,
} from '@css-archaeology/core';
import { z } from 'zod';
import { canInteract, cascadeCompare, compoundKey, contextCovers, sameContext, snippetOf, type CascadeEntry } from './cascade.js';

const specificitySchema = z.tuple([z.number().int().min(0), z.number().int().min(0), z.number().int().min(0)]);
const highOptions = z.object({ max: specificitySchema.default([0, 4, 4]) }).strict();
const complexOptions = z.object({ maxCompounds: z.number().int().min(1).default(4), maxSimpleSelectors: z.number().int().min(1).default(8) }).strict();
const escalationOptions = z.object({ minLevels: z.number().int().min(2).default(3) }).strict();
const importantOptions = z.object({ maxRatio: z.number().min(0).max(1).default(0.1), minCount: z.number().int().min(1).default(5) }).strict();

type HighOptions = z.infer<typeof highOptions>;
type ComplexOptions = z.infer<typeof complexOptions>;

function selectorLocation(rule: CssRule) {
  return { file: rule.file, line: rule.line, column: rule.column };
}

function hasRepeatedSimple(part: SelectorPart): string | null {
  // `.btn.btn` or `#a#a`: the same simple selector repeated in one compound only raises specificity.
  for (const compound of part.text.split(/\s+[>+~]\s+|\s+/)) {
    const simples = compound.match(/[.#][\w-]+|\[[^\]]+\]/g) ?? [];
    const seen = new Set<string>();
    for (const s of simples) {
      if (seen.has(s)) return s;
      seen.add(s);
    }
  }
  return null;
}

function overqualification(part: SelectorPart): string | null {
  // `div#main`, `ul.nav`: an element type qualifying an id or class in the same compound.
  for (const compound of part.text.split(/\s+[>+~]\s+|\s+/)) {
    const m = /^([a-z][a-z0-9]*)([#.][\w-]+)/i.exec(compound);
    if (m && !['html', 'body'].includes(m[1]!.toLowerCase())) return compound;
  }
  return null;
}

export const specificityAnalyzer: Analyzer = {
  id: 'specificity',
  configKey: 'specificityConflicts',
  title: 'Specificity and conflicts',
  description: 'Measures selector specificity and complexity, and finds conflicting or colliding declarations.',
  rules: [
    {
      id: 'high-specificity',
      title: 'Excessively specific selector',
      description: 'The selector specificity exceeds the configured maximum, making it hard to override.',
      defaultSeverity: 'low',
      optionsSchema: highOptions,
      rationale: 'Specificity is shown as (ids, classes/attributes/pseudo-classes, elements). Selectors above the threshold (default (0,4,4); any id exceeds it) force later overrides to escalate specificity or use !important.',
    },
    {
      id: 'complex-selector',
      title: 'Unnecessarily complex selector',
      description: 'The selector chains more compounds or simple selectors than the configured maximum.',
      defaultSeverity: 'low',
      optionsSchema: complexOptions,
      rationale: 'Long descendant chains couple styles to markup structure, are slower to match and are hard to reuse.',
    },
    {
      id: 'overqualified-selector',
      title: 'Overqualified selector',
      description: 'An element type qualifies a class or id in the same compound (for example div.card).',
      defaultSeverity: 'info',
      rationale: 'Qualifying a class or id with an element type adds specificity and ties the style to one element type, usually without need.',
    },
    {
      id: 'specificity-hack',
      title: 'Specificity hack',
      description: 'A simple selector is repeated in one compound (for example .btn.btn) only to raise specificity.',
      defaultSeverity: 'low',
      rationale: 'Repeating a class or id has no effect on matching and exists only to win the cascade; it signals a specificity war.',
    },
    {
      id: 'specificity-escalation',
      title: 'Repeated specificity escalation',
      description: 'The same target is styled at several increasing specificity levels that set the same properties.',
      defaultSeverity: 'medium',
      optionsSchema: escalationOptions,
      rationale: 'When one element is styled through an escalating series of selectors that set the same properties, each new override has to out-rank the last. This is a common source of fragile CSS.',
    },
    {
      id: 'important-overuse',
      title: '!important overuse',
      description: 'A stylesheet uses !important on a large share of its declarations.',
      defaultSeverity: 'low',
      optionsSchema: importantOptions,
      rationale: '!important bypasses specificity and source order. Heavy use makes the cascade unpredictable and leads to !important battles.',
    },
    {
      id: 'conflicting-declaration',
      title: 'Conflicting declarations',
      description: 'The same selector sets a property to different values under the same conditions, and the winner depends on stylesheet load order or competing !important flags.',
      defaultSeverity: 'medium',
      rationale:
        'Reported only when the outcome is fragile: identical selectors with different values in different stylesheets whose load order is not known, or several !important declarations for the same target. Values that differ by media query, supports condition or state (for example :hover) are intentional variations and are not reported.',
    },
    {
      id: 'specificity-conflict',
      title: 'Specificity collision',
      description: 'A later rule for the same target loses to an earlier, much more specific rule.',
      defaultSeverity: 'low',
      rationale:
        'The later rule targets the same key selector and sets a different value, but an earlier rule wins for elements matched by both because it is more specific by at least an id or two classes. If the later rule was meant to override, it will not. Contextual styling (an earlier, deliberately more specific rule) can be intentional, so confidence is medium.',
    },
  ],
  run(ctx) {
    const { project } = ctx;
    const findings: FindingDraft[] = [];
    const high = ctx.rule<HighOptions>('high-specificity').options;
    const complex = ctx.rule<ComplexOptions>('complex-selector').options;
    const escalation = ctx.rule<z.infer<typeof escalationOptions>>('specificity-escalation').options;
    const importantOpts = ctx.rule<z.infer<typeof importantOptions>>('important-overuse').options;
    const max = high.max as Specificity;

    for (const rule of project.rules) {
      for (const part of rule.selectors) {
        if (part.unparseable) continue;
        const loc = selectorLocation(rule);
        if (compareSpecificity(part.specificity, max) > 0) {
          findings.push({
            rule: 'high-specificity',
            severity: part.specificity[0] >= 2 ? 'medium' : 'low',
            baseConfidence: 0.95,
            title: `High specificity ${formatSpecificity(part.specificity)}`,
            description: `${part.text} has specificity ${formatSpecificity(part.specificity)}, above the configured maximum ${formatSpecificity(max)}.${part.ids.length ? ' Id selectors are especially hard to override.' : ''}`,
            ...loc,
            selector: part.text,
            evidence: [
              { kind: 'selector', message: `Specificity ${formatSpecificity(part.specificity)}`, ...loc, snippet: part.text },
              { kind: 'metric', message: `ids=${part.specificity[0]}, classes/attributes/pseudo-classes=${part.specificity[1]}, elements/pseudo-elements=${part.specificity[2]}` },
            ],
            suggestion: part.ids.length ? 'Replace id selectors with classes, or wrap them in :where() to keep specificity low.' : 'Reduce qualifiers or use :where() so the selector is easier to override.',
            data: { specificity: part.specificity },
          });
        }
        if (part.compounds > complex.maxCompounds || part.simpleSelectors > complex.maxSimpleSelectors) {
          findings.push({
            rule: 'complex-selector',
            severity: 'low',
            baseConfidence: 0.95,
            title: `Complex selector with ${part.compounds} compounds`,
            description: `${part.text} chains ${part.compounds} compound selectors and ${part.simpleSelectors} simple selectors (limits ${complex.maxCompounds} and ${complex.maxSimpleSelectors}).`,
            ...loc,
            selector: part.text,
            evidence: [{ kind: 'selector', message: 'Selector', ...loc, snippet: part.text }],
            suggestion: 'Give the target element its own class instead of describing its position in the markup.',
            data: { compounds: part.compounds, simpleSelectors: part.simpleSelectors },
          });
        }
        const repeated = hasRepeatedSimple(part);
        if (repeated) {
          findings.push({
            rule: 'specificity-hack',
            severity: 'low',
            baseConfidence: 0.9,
            title: `Repeated ${repeated} used to raise specificity`,
            description: `${part.text} repeats ${repeated} in one compound. This does not change what matches; it only raises specificity to ${formatSpecificity(part.specificity)}.`,
            ...loc,
            selector: part.text,
            evidence: [{ kind: 'selector', message: 'Selector', ...loc, snippet: part.text }],
            suggestion: 'Resolve the conflict this selector is fighting (ordering, layers or lower base specificity) instead of stacking selectors.',
          });
        }
        const over = overqualification(part);
        if (over) {
          findings.push({
            rule: 'overqualified-selector',
            severity: 'info',
            baseConfidence: 0.8,
            title: `Overqualified selector ${over}`,
            description: `${over} in ${part.text} qualifies a class or id with an element type, adding specificity and coupling the style to one element.`,
            ...loc,
            selector: part.text,
            evidence: [{ kind: 'selector', message: 'Selector', ...loc, snippet: part.text }],
            suggestion: 'Drop the element type unless the style must only apply to that element.',
          });
        }
      }
    }

    /* !important density -------------------------------------------------- */
    for (const sheet of project.stylesheets) {
      if (sheet.declarationCount === 0) continue;
      const ratio = sheet.importantCount / sheet.declarationCount;
      if (sheet.importantCount >= importantOpts.minCount && ratio > importantOpts.maxRatio) {
        findings.push({
          rule: 'important-overuse',
          severity: 'low',
          baseConfidence: 0.95,
          title: `${sheet.importantCount} !important declarations`,
          description: `${sheet.file} uses !important on ${sheet.importantCount} of ${sheet.declarationCount} declarations (${Math.round(ratio * 100)}%).`,
          file: sheet.file,
          line: 1,
          column: 1,
          evidence: [{ kind: 'metric', message: `!important ratio ${(ratio * 100).toFixed(1)}% (threshold ${(importantOpts.maxRatio * 100).toFixed(0)}%)` }],
          suggestion: 'Use cascade layers or lower base specificity so overrides do not need !important.',
          data: { ratio, count: sheet.importantCount },
        });
      }
    }

    /* Conflicts and collisions --------------------------------------------- */
    const byKey = new Map<string, CascadeEntry[]>();
    for (const rule of project.rules) {
      for (const part of rule.selectors) {
        if (part.unparseable || part.keySimple.length === 0) continue;
        for (const i of rule.declarationIndexes) {
          const decl = project.declarations[i]!;
          if (decl.custom) continue;
          // Group by property and the key compound ignoring state pseudo-classes.
          const key = `${decl.prop}\u0000${compoundKey(part.keySimple)}\u0000${part.pseudoElements.join()}`;
          const list = byKey.get(key);
          if (list) list.push({ decl, rule, part });
          else byKey.set(key, [{ decl, rule, part }]);
        }
      }
    }
    const conflictSeen = new Set<string>();
    const collisionSeen = new Set<number>();
    for (const entries of byKey.values()) {
      if (entries.length < 2) continue;
      entries.sort((a, b) => a.decl.order - b.decl.order);
      for (let i = 0; i < entries.length; i++) {
        const a = entries[i]!;
        for (let j = i + 1; j < entries.length; j++) {
          const b = entries[j]!;
          if (a.decl.value === b.decl.value) continue;
          if (!canInteract(a.rule, b.rule, a.part, b.part)) continue;
          const samePseudoState = a.part.pseudoClasses.join() === b.part.pseudoClasses.join();
          // 1. Identical selector, same context, different stylesheets with unknown order, or competing !important.
          if (a.part.text === b.part.text && sameContext(a.rule.context, b.rule.context) && a.rule.index !== b.rule.index) {
            const crossFile = a.decl.file !== b.decl.file;
            const orderUnknown = crossFile && (project.orderSource.get(a.decl.file) !== 'import-graph' || project.orderSource.get(b.decl.file) !== 'import-graph');
            const bothImportant = a.decl.important && b.decl.important;
            if (orderUnknown || bothImportant) {
              const key = [a.part.text, a.decl.prop, a.rule.contextKey].join('\u0000');
              if (conflictSeen.has(key)) continue;
              conflictSeen.add(key);
              const winner = cascadeCompare(project, a, b).result > 0 ? a : b;
              const evidence: Evidence[] = [a, b].map((e) => ({
                kind: 'declaration' as const,
                message: `${e.part.text} in ${e.decl.file}`,
                file: e.decl.file,
                line: e.decl.line,
                column: e.decl.column,
                snippet: snippetOf(e.decl),
              }));
              evidence.push({
                kind: 'note',
                message: bothImportant
                  ? 'Both declarations use !important, so the result is decided by source order alone.'
                  : `Stylesheet load order is not known; assuming path order, ${winner.decl.file}:${winner.decl.line} wins.`,
              });
              findings.push({
                rule: 'conflicting-declaration',
                severity: 'medium',
                baseConfidence: 0.8,
                confidenceFactors: orderUnknown ? [factor('load-order-unknown', -0.15, 'The winner depends on the order stylesheets are loaded in.')] : [],
                title: `Conflicting ${a.decl.prop} values for ${a.part.text}`,
                description: `${a.part.text} sets ${a.decl.prop} to \`${a.decl.value}\` and \`${b.decl.value}\` under the same conditions${bothImportant ? ', both with !important' : ' in different stylesheets'}. Which value applies depends on ${bothImportant ? 'source order' : 'stylesheet load order'}.`,
                file: b.decl.file,
                line: b.decl.line,
                column: b.decl.column,
                selector: a.part.text,
                property: a.decl.prop,
                value: b.decl.value,
                evidence,
                suggestion: 'Keep one value for this selector and property, or make the intended winner explicit with a layer or a more specific selector.',
                approximate: orderUnknown,
              });
            }
            continue;
          }
          // 2. Later, less specific rule for the same target that loses to an earlier rule.
          if (!samePseudoState || a.decl.important !== b.decl.important || a.rule.context.layer !== b.rule.context.layer) continue;
          if (!contextCovers(b.rule.context, a.rule.context) && !contextCovers(a.rule.context, b.rule.context)) continue;
          if (collisionSeen.has(b.decl.index)) continue;
          // Only when every element the earlier selector matches can also match the later one.
          const within = (xs: string[], ys: string[]) => xs.every((x) => ys.includes(x));
          if (!within(b.part.classes, a.part.classes) || !within(b.part.ids, a.part.ids) || !within(b.part.elements, a.part.elements)) continue;
          const [da, db] = [a.part.specificity, b.part.specificity];
          const gap = da[0] > db[0] || (da[0] === db[0] && da[1] - db[1] >= 2);
          if (!gap || compareSpecificity(da, db) <= 0) continue;
          collisionSeen.add(b.decl.index);
          findings.push({
            rule: 'specificity-conflict',
            severity: 'low',
            baseConfidence: 0.6,
            confidenceFactors: a.decl.file !== b.decl.file ? [factor('cross-file', -0.05, 'The rules are in different stylesheets.')] : [],
            title: `Later ${b.decl.prop} on ${b.part.text} loses to ${a.part.text}`,
            description: `\`${snippetOf(b.decl)}\` on ${b.part.text} comes later than \`${snippetOf(a.decl)}\` on ${a.part.text}, but for elements matched by both, the earlier rule wins because it is more specific ${formatSpecificity(da)} > ${formatSpecificity(db)}.`,
            file: b.decl.file,
            line: b.decl.line,
            column: b.decl.column,
            selector: b.part.text,
            property: b.decl.prop,
            value: b.decl.value,
            evidence: [
              { kind: 'declaration', message: `Earlier, more specific ${formatSpecificity(da)}`, file: a.decl.file, line: a.decl.line, column: a.decl.column, snippet: `${a.part.text} { ${snippetOf(a.decl)} }` },
              { kind: 'declaration', message: `Later, less specific ${formatSpecificity(db)}`, file: b.decl.file, line: b.decl.line, column: b.decl.column, snippet: `${b.part.text} { ${snippetOf(b.decl)} }` },
            ],
            suggestion: 'If the later rule is meant to override, lower the specificity of the earlier rule (for example with :where()) rather than escalating the later one.',
            approximate: true,
          });
        }
      }
    }

    /* Escalation chains ---------------------------------------------------- */
    const chains = new Map<string, { part: SelectorPart; rule: CssRule; props: Set<string> }[]>();
    for (const rule of project.rules) {
      for (const part of rule.selectors) {
        if (part.unparseable || part.keySimple.length === 0 || part.pseudoClasses.length > 0 || part.pseudoElements.length > 0) continue;
        const key = `${rule.isModule ? rule.file : ''}\u0000${compoundKey(part.keySimple)}`;
        const list = chains.get(key) ?? [];
        list.push({ part, rule, props: new Set(rule.declarationIndexes.map((i) => project.declarations[i]!.prop)) });
        chains.set(key, list);
      }
    }
    for (const list of chains.values()) {
      const levels = new Map<string, (typeof list)[number]>();
      for (const item of list) {
        const k = formatSpecificity(item.part.specificity);
        if (!levels.has(k)) levels.set(k, item);
      }
      if (levels.size < escalation.minLevels) continue;
      const sorted = [...levels.values()].sort((a, b) => compareSpecificity(a.part.specificity, b.part.specificity));
      // Require a property that every level sets: otherwise the selectors style different aspects.
      const shared = [...sorted[0]!.props].filter((p) => sorted.every((s) => s.props.has(p)));
      if (shared.length === 0) continue;
      const top = sorted[sorted.length - 1]!;
      findings.push({
        rule: 'specificity-escalation',
        severity: 'medium',
        baseConfidence: 0.7,
        title: `Specificity escalation for ${top.part.keyCompound}`,
        description: `${top.part.keyCompound} is styled at ${sorted.length} specificity levels, from ${formatSpecificity(sorted[0]!.part.specificity)} to ${formatSpecificity(top.part.specificity)}, each setting ${shared.slice(0, 3).join(', ')}.`,
        file: top.rule.file,
        line: top.rule.line,
        column: top.rule.column,
        selector: top.part.text,
        evidence: sorted.map((s) => ({
          kind: 'selector' as const,
          message: `${formatSpecificity(s.part.specificity)} ${s.part.text}`,
          file: s.rule.file,
          line: s.rule.line,
          column: s.rule.column,
        })),
        suggestion: 'Flatten the chain: give variants their own modifier classes at the same specificity, or order overrides with cascade layers.',
        data: { levels: sorted.map((s) => ({ selector: s.part.text, specificity: s.part.specificity })), sharedProperties: shared },
      });
    }
    return findings;
  },
};
