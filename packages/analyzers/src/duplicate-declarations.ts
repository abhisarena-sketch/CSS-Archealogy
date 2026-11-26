import { factor, type Analyzer, type CssDeclaration, type CssRule, type Evidence, type FindingDraft, type ProjectModel } from '@css-archaeology/core';
import { z } from 'zod';
import { canInteract, orderFactors, resetsProperty, shorthandsOf, snippetOf } from './cascade.js';

const blockOptions = z
  .object({
    minDeclarations: z.number().int().min(2).default(3),
    minOccurrences: z.number().int().min(2).default(2),
  })
  .strict();

interface SafetyVerdict {
  safe: boolean;
  reason: string;
  blocker?: CssDeclaration;
}

/**
 * Is it safe to drop the earlier duplicates and keep only the last one? Not when a
 * declaration of the same property with a different value sits between them on a
 * selector that may match the same elements; the duplicate may be re-asserting a value.
 */
function consolidationSafety(project: ProjectModel, byProp: Map<string, CssDeclaration[]>, group: CssDeclaration[]): SafetyVerdict {
  const first = group[0]!;
  const last = group[group.length - 1]!;
  const rule = project.rules[first.ruleIndex]!;
  const lastRule = project.rules[last.ruleIndex]!;
  const keyClasses = new Set(rule.selectors.flatMap((s) => [...s.classes, ...s.ids.map((i) => `#${i}`), ...s.keySimple]));
  const candidates = [first.prop, ...shorthandsOf(first.prop)].flatMap((p) => byProp.get(p) ?? []);
  for (const other of candidates) {
    if (other.order <= first.order || other.order >= last.order) continue;
    if (!resetsProperty(other.prop, first.prop) || other.value === first.value) continue;
    const otherRule = project.rules[other.ruleIndex]!;
    if (!canInteract(otherRule, rule, otherRule.selectors[0]!, rule.selectors[0]!)) continue;
    const overlaps = otherRule.selectors.some(
      (s) => s.text === rule.selectors[0]!.text || [...s.classes, ...s.ids.map((i) => `#${i}`), ...s.keySimple].some((x) => keyClasses.has(x)),
    );
    if (overlaps) {
      return {
        safe: false,
        reason: `\`${snippetOf(other)}\` on ${otherRule.selectorText} (${other.file}:${other.line}) sits between the duplicates; the later duplicate may be re-asserting the value.`,
        blocker: other,
      };
    }
  }
  if (first.important !== last.important) {
    return { safe: false, reason: 'The duplicates differ in !important, so removing one changes the cascade.' };
  }
  if (rule.file !== lastRule.file) {
    return { safe: true, reason: 'No conflicting declaration was found between the duplicates, but they live in different stylesheets; confirm both are always loaded together.' };
  }
  return { safe: true, reason: 'No declaration of the same property with a different value appears between the duplicates.' };
}

function selectorScope(rule: CssRule): string {
  // CSS Module class names are file-scoped, so identical selectors in different modules are different classes.
  return rule.isModule ? `${rule.file}::${rule.selectorText}` : rule.selectorText;
}

export const duplicateDeclarationsAnalyzer: Analyzer = {
  id: 'duplicate-declarations',
  configKey: 'duplicateDeclarations',
  title: 'Duplicate declarations',
  description: 'Finds identical declarations repeated for the same selector and context, and repeated declaration blocks.',
  rules: [
    {
      id: 'duplicate-declaration',
      title: 'Duplicate declaration',
      description: 'The same property and value is declared more than once for the same selector under the same at-rule conditions.',
      defaultSeverity: 'medium',
      rationale:
        'Duplicates are grouped by selector, property, value and full at-rule context (media, supports, container, layer, scope). Declarations under different media queries are never treated as duplicates. Consolidation is reported as safe only when no declaration of the same property with a different value appears between the duplicates on an overlapping selector.',
    },
    {
      id: 'repeated-declaration-block',
      title: 'Repeated declaration block',
      description: 'Several rules with different selectors share an identical set of declarations.',
      defaultSeverity: 'low',
      optionsSchema: blockOptions,
      rationale:
        'Identical declaration blocks repeated across selectors are a repeated styling pattern. They can often be expressed once with a shared class, a selector list or a design token. This is a maintainability hint, not a bug.',
    },
  ],
  run(ctx) {
    const { project } = ctx;
    const findings: FindingDraft[] = [];

    /* Within a single block ------------------------------------------------ */
    for (const rule of project.rules) {
      const seen = new Map<string, CssDeclaration>();
      for (const i of rule.declarationIndexes) {
        const d = project.declarations[i]!;
        const key = `${d.prop}\u0000${d.value}\u0000${d.important}`;
        const prev = seen.get(key);
        if (!prev) {
          seen.set(key, d);
          continue;
        }
        findings.push({
          rule: 'duplicate-declaration',
          severity: 'medium',
          baseConfidence: 0.95,
          title: `Duplicate ${d.prop} declaration`,
          description: `\`${snippetOf(d)}\` is declared twice in the same ${rule.selectorText} block.`,
          file: d.file,
          line: d.line,
          column: d.column,
          selector: rule.selectorText,
          property: d.prop,
          value: d.value,
          evidence: [
            { kind: 'occurrence', message: 'First occurrence', file: prev.file, line: prev.line, column: prev.column, snippet: snippetOf(prev) },
            { kind: 'occurrence', message: 'Repeated in the same block', file: d.file, line: d.line, column: d.column, snippet: snippetOf(d) },
          ],
          suggestion: 'Remove one of the two identical declarations. Consolidation appears safe because both are in the same block.',
          data: { safeToConsolidate: true, scope: 'block', occurrences: [prev, d].map((x) => ({ file: x.file, line: x.line })) },
        });
      }
    }

    /* Across rules with the same selector and context ---------------------- */
    const byProp = new Map<string, CssDeclaration[]>();
    for (const d of project.declarations) {
      const list = byProp.get(d.prop);
      if (list) list.push(d);
      else byProp.set(d.prop, [d]);
    }
    const groups = new Map<string, CssDeclaration[]>();
    for (const rule of project.rules) {
      if (rule.selectors.some((s) => s.unparseable)) continue;
      const seenInRule = new Set<string>();
      for (const i of rule.declarationIndexes) {
        const d = project.declarations[i]!;
        const key = [selectorScope(rule), rule.contextKey, d.prop, d.value, d.important].join('\u0000');
        if (seenInRule.has(key)) continue;
        seenInRule.add(key);
        const list = groups.get(key);
        if (list) list.push(d);
        else groups.set(key, [d]);
      }
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      group.sort((a, b) => a.order - b.order);
      const first = group[0]!;
      const second = group[1]!;
      const rule = project.rules[first.ruleIndex]!;
      const verdict = consolidationSafety(project, byProp, group);
      const order = orderFactors(project, first, group[group.length - 1]!, 'order');
      const factors = [...order.factors.filter((f) => f.factor !== 'same-file')];
      if (!verdict.safe) factors.push(factor('intervening-declaration', -0.1, 'A different value is declared between the duplicates.'));
      const crossFile = new Set(group.map((d) => d.file)).size > 1;
      const evidence: Evidence[] = group.map((d, i) => ({
        kind: 'occurrence',
        message: i === 0 ? 'First occurrence' : `Occurrence ${i + 1}`,
        file: d.file,
        line: d.line,
        column: d.column,
        snippet: `${project.rules[d.ruleIndex]!.selectorText} { ${snippetOf(d)} }`,
      }));
      if (rule.contextKey) evidence.push({ kind: 'context', message: `All occurrences are under ${rule.contextKey}` });
      evidence.push({ kind: 'note', message: verdict.reason, ...(verdict.blocker ? { file: verdict.blocker.file, line: verdict.blocker.line } : {}) });
      findings.push({
        rule: 'duplicate-declaration',
        severity: 'medium',
        baseConfidence: 0.9,
        confidenceFactors: factors,
        title: `Duplicate ${first.prop} declaration`,
        description: `The same ${first.prop} declaration (\`${snippetOf(first)}\`) appears ${group.length} times for ${rule.selectorText}${rule.contextKey ? ` under ${rule.contextKey}` : ''}${crossFile ? ' across stylesheets' : ''}.`,
        file: second.file,
        line: second.line,
        column: second.column,
        selector: rule.selectorText,
        property: first.prop,
        value: first.value,
        evidence,
        suggestion: verdict.safe
          ? 'Review whether the duplicate declaration can be consolidated; keeping only the last occurrence appears safe.'
          : 'Review the duplicates before consolidating: an intervening declaration may make the repetition intentional.',
        approximate: crossFile,
        data: {
          safeToConsolidate: verdict.safe,
          scope: crossFile ? 'project' : 'file',
          occurrences: group.map((d) => ({ file: d.file, line: d.line, column: d.column })),
        },
      });
    }

    /* Repeated declaration blocks ------------------------------------------ */
    const { options } = ctx.rule<z.infer<typeof blockOptions>>('repeated-declaration-block');
    const blocks = new Map<string, CssRule[]>();
    for (const rule of project.rules) {
      if (rule.declarationIndexes.length < options.minDeclarations) continue;
      const signature = rule.declarationIndexes
        .map((i) => snippetOf(project.declarations[i]!))
        .sort()
        .join('; ');
      const key = `${rule.contextKey}\u0000${signature}`;
      const list = blocks.get(key);
      if (list) list.push(rule);
      else blocks.set(key, [rule]);
    }
    for (const rules of blocks.values()) {
      const distinct = rules.filter((r, i) => rules.findIndex((x) => x.selectorText === r.selectorText) === i);
      if (distinct.length < options.minOccurrences) continue;
      const first = distinct[0]!;
      const count = first.declarationIndexes.length;
      findings.push({
        rule: 'repeated-declaration-block',
        severity: 'low',
        baseConfidence: 0.9,
        title: `Repeated block of ${count} declarations`,
        description: `${distinct.length} rules with different selectors declare the same ${count} declarations${first.contextKey ? ` under ${first.contextKey}` : ''}.`,
        file: distinct[1]!.file,
        line: distinct[1]!.line,
        column: distinct[1]!.column,
        selector: distinct.map((r) => r.selectorText).join(', '),
        evidence: [
          { kind: 'note', message: `Shared declarations: ${first.declarationIndexes.map((i) => snippetOf(project.declarations[i]!)).join('; ')}` },
          ...distinct.map((r): Evidence => ({ kind: 'occurrence', message: `Block on ${r.selectorText}`, file: r.file, line: r.line, column: r.column })),
        ],
        suggestion: 'Consider a shared class, a selector list or design tokens for this repeated pattern. Merge only if the rules are meant to stay identical.',
        data: { selectors: distinct.map((r) => r.selectorText) },
      });
    }
    return findings;
  },
};
