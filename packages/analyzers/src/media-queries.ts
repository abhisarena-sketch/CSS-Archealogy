import { extractBreakpoints, factor, type Analyzer, type AtRuleRecord, type CssDeclaration, type CssRule, type Evidence, type FindingDraft } from '@css-archaeology/core';
import { z } from 'zod';
import { contextCovers, snippetOf } from './cascade.js';

const breakpointOptions = z.object({ tolerancePx: z.number().min(1).default(16) }).strict();
const repeatedOptions = z.object({ minBreakpoints: z.number().int().min(2).default(2) }).strict();

function parentContextKey(at: AtRuleRecord): string {
  // The record's context includes its own params; strip them to group siblings.
  const media = at.context.media.slice(0, -1);
  return [media.join(' and '), at.context.supports.join(' and '), at.context.layer ?? '', at.context.container.join(' and ')].join('|');
}

export const mediaQueriesAnalyzer: Analyzer = {
  id: 'media-queries',
  configKey: 'mediaQueries',
  title: 'Media queries',
  description: 'Finds duplicate media queries, inconsistent breakpoints and redundant responsive declarations.',
  rules: [
    {
      id: 'duplicate-media-query',
      title: 'Duplicate media query',
      description: 'The same media query appears in several blocks of one stylesheet.',
      defaultSeverity: 'low',
      rationale: 'Repeated @media blocks with identical conditions in one file can usually be merged. Merging changes source order, so check for rules in between that set the same properties.',
    },
    {
      id: 'inconsistent-breakpoint',
      title: 'Inconsistent breakpoints',
      description: 'Breakpoint values that are close to each other but not identical are used across the project.',
      defaultSeverity: 'low',
      optionsSchema: breakpointOptions,
      rationale: 'Values such as 760px, 768px and 770px usually describe the same breakpoint. A min-width/max-width pair one pixel apart (768px and 767px) is treated as consistent. Values in em/rem are converted at 16px.',
    },
    {
      id: 'redundant-media-declaration',
      title: 'Redundant responsive declaration',
      description: 'A declaration inside a media query repeats the value that already applies outside it.',
      defaultSeverity: 'low',
      rationale: 'The selector already has the same value from a rule that applies in a broader context, and nothing in between sets a different value, so the responsive declaration has no effect.',
    },
    {
      id: 'repeated-across-breakpoints',
      title: 'Declaration repeated across breakpoints',
      description: 'The same selector declares an identical value in several different media queries.',
      defaultSeverity: 'info',
      optionsSchema: repeatedOptions,
      rationale: 'Identical declarations under several breakpoints can often be expressed once with a single min-width query or moved to the base rule.',
    },
  ],
  run(ctx) {
    const { project } = ctx;
    const findings: FindingDraft[] = [];
    const media = project.atRules.filter((a) => a.name === 'media');

    /* Duplicate media queries per file ------------------------------------- */
    const groups = new Map<string, AtRuleRecord[]>();
    for (const at of media) {
      const key = `${at.file}\u0000${parentContextKey(at)}\u0000${at.params}`;
      const list = groups.get(key) ?? [];
      list.push(at);
      groups.set(key, list);
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const [first, second] = [list[0]!, list[1]!];
      findings.push({
        rule: 'duplicate-media-query',
        severity: 'low',
        baseConfidence: 0.9,
        title: `@media ${first.params} appears ${list.length} times`,
        description: `${first.file} contains ${list.length} separate @media ${first.params} blocks.`,
        file: second.file,
        line: second.line,
        column: second.column,
        evidence: list.map((a, i): Evidence => ({ kind: 'occurrence', message: i === 0 ? 'First block' : `Block ${i + 1}`, file: a.file, line: a.line, column: a.column, snippet: `@media ${a.params}` })),
        suggestion: 'Consider merging the blocks. Check that no rule between them sets the same properties, because merging changes source order.',
        data: { params: first.params, count: list.length },
      });
    }

    /* Inconsistent breakpoints --------------------------------------------- */
    const { tolerancePx } = ctx.rule<z.infer<typeof breakpointOptions>>('inconsistent-breakpoint').options;
    const values = new Map<number, { value: string; at: AtRuleRecord }[]>();
    for (const at of media) {
      for (const bp of extractBreakpoints(at.params)) {
        if (bp.px === null) continue;
        const list = values.get(bp.px) ?? [];
        list.push({ value: bp.value, at });
        values.set(bp.px, list);
      }
    }
    const sorted = [...values.keys()].sort((a, b) => a - b);
    const clusters: number[][] = [];
    for (const px of sorted) {
      const last = clusters[clusters.length - 1];
      if (last && px - last[last.length - 1]! <= tolerancePx) last.push(px);
      else clusters.push([px]);
    }
    for (const cluster of clusters) {
      // Collapse min/max pairs (768 and 767 or 767.98) into one value.
      const distinct = cluster.filter((px, i) => i === 0 || px - cluster[i - 1]! > 1);
      if (distinct.length < 2) continue;
      const counts = cluster.map((px) => ({ px, uses: values.get(px)!.length, label: values.get(px)![0]!.value }));
      const least = [...counts].sort((a, b) => a.uses - b.uses)[0]!;
      const at = values.get(least.px)![0]!.at;
      findings.push({
        rule: 'inconsistent-breakpoint',
        severity: 'low',
        baseConfidence: 0.65,
        confidenceFactors: [factor('heuristic-clustering', 0, `Values within ${tolerancePx}px are assumed to describe the same breakpoint.`)],
        title: `Inconsistent breakpoints near ${counts[0]!.label}`,
        description: `Breakpoints ${counts.map((c) => `${c.label} (${c.uses}×)`).join(', ')} are within ${tolerancePx}px of each other and may describe the same screen size.`,
        file: at.file,
        line: at.line,
        column: at.column,
        evidence: counts.flatMap((c) =>
          values
            .get(c.px)!
            .slice(0, 3)
            .map((v): Evidence => ({ kind: 'occurrence', message: `${v.value} (${c.px}px)`, file: v.at.file, line: v.at.line, column: v.at.column, snippet: `@media ${v.at.params}` })),
        ),
        suggestion: 'Standardise on one value per breakpoint, ideally defined once (for example with a shared custom media query or a design token).',
        data: { values: counts },
      });
    }

    /* Redundant and repeated responsive declarations ----------------------- */
    const bySelectorProp = new Map<string, { decl: CssDeclaration; rule: CssRule }[]>();
    for (const rule of project.rules) {
      for (const i of rule.declarationIndexes) {
        const decl = project.declarations[i]!;
        if (decl.custom) continue;
        const key = `${rule.isModule ? rule.file : ''}\u0000${rule.selectorText}\u0000${decl.prop}`;
        const list = bySelectorProp.get(key) ?? [];
        list.push({ decl, rule });
        bySelectorProp.set(key, list);
      }
    }
    const { minBreakpoints } = ctx.rule<z.infer<typeof repeatedOptions>>('repeated-across-breakpoints').options;
    for (const list of bySelectorProp.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => a.decl.order - b.decl.order);
      for (let i = 0; i < list.length; i++) {
        const cur = list[i]!;
        if (cur.rule.context.media.length === 0) continue;
        // Nearest earlier declaration that applies whenever this one does.
        let base: (typeof list)[number] | null = null;
        let blocked = false;
        for (let j = i - 1; j >= 0; j--) {
          const prev = list[j]!;
          if (prev.decl.value !== cur.decl.value || prev.decl.important !== cur.decl.important) {
            blocked = true;
            break;
          }
          if (contextCovers(prev.rule.context, cur.rule.context) && prev.rule.context.media.length < cur.rule.context.media.length && prev.rule.context.layer === cur.rule.context.layer) {
            base = prev;
            break;
          }
        }
        if (!base || blocked) continue;
        findings.push({
          rule: 'redundant-media-declaration',
          severity: 'low',
          baseConfidence: 0.8,
          confidenceFactors: cur.decl.file !== base.decl.file ? [factor('cross-file', -0.15, 'The base declaration is in another stylesheet.')] : [],
          title: `Redundant ${cur.decl.prop} in @media ${cur.rule.context.media.join(' and ')}`,
          description: `\`${snippetOf(cur.decl)}\` on ${cur.rule.selectorText} repeats the value that already applies from ${base.decl.file}:${base.decl.line}.`,
          file: cur.decl.file,
          line: cur.decl.line,
          column: cur.decl.column,
          selector: cur.rule.selectorText,
          property: cur.decl.prop,
          value: cur.decl.value,
          evidence: [
            { kind: 'declaration', message: `Already applies${base.rule.contextKey ? ` under ${base.rule.contextKey}` : ' without conditions'}`, file: base.decl.file, line: base.decl.line, column: base.decl.column, snippet: snippetOf(base.decl) },
            { kind: 'declaration', message: `Repeated under ${cur.rule.contextKey}`, file: cur.decl.file, line: cur.decl.line, column: cur.decl.column, snippet: snippetOf(cur.decl) },
          ],
          suggestion: 'Remove the responsive declaration unless it is meant to reset a value set by another breakpoint.',
          approximate: cur.decl.file !== base.decl.file,
        });
      }
      // Same value in several distinct media contexts with no matching base rule.
      const byValue = new Map<string, { decl: CssDeclaration; rule: CssRule }[]>();
      for (const e of list) {
        if (e.rule.context.media.length === 0) continue;
        const k = `${e.decl.value}\u0000${e.decl.important}`;
        byValue.set(k, [...(byValue.get(k) ?? []), e]);
      }
      for (const entries of byValue.values()) {
        const contexts = [...new Set(entries.map((e) => e.rule.contextKey))];
        if (contexts.length < minBreakpoints) continue;
        const hasBase = list.some((e) => e.rule.context.media.length === 0 && e.decl.value === entries[0]!.decl.value);
        if (hasBase) continue;
        const first = entries[0]!;
        findings.push({
          rule: 'repeated-across-breakpoints',
          severity: 'info',
          baseConfidence: 0.85,
          title: `${first.decl.prop} repeated in ${contexts.length} breakpoints`,
          description: `${first.rule.selectorText} declares \`${snippetOf(first.decl)}\` under ${contexts.length} different media queries.`,
          file: entries[1]!.decl.file,
          line: entries[1]!.decl.line,
          column: entries[1]!.decl.column,
          selector: first.rule.selectorText,
          property: first.decl.prop,
          value: first.decl.value,
          evidence: entries.map((e): Evidence => ({ kind: 'occurrence', message: e.rule.contextKey, file: e.decl.file, line: e.decl.line, column: e.decl.column, snippet: snippetOf(e.decl) })),
          suggestion: 'Consider declaring the value once, in the broadest query that covers all these breakpoints.',
        });
      }
    }
    return findings;
  },
};
