import { collectTokenOccurrences, customPropertyValues, type Analyzer, type Evidence, type FindingDraft, type TokenCategory, type TokenOccurrence } from '@css-archaeology/core';
import { z } from 'zod';

const repeatedOptions = z
  .object({
    minOccurrences: z.number().int().min(2).default(3),
    categories: z.array(z.enum(['color', 'spacing', 'typography', 'radius', 'shadow', 'breakpoint'])).default(['color', 'spacing', 'typography', 'radius', 'shadow', 'breakpoint']),
    /** Values that are too generic to be worth a token. */
    ignore: z.array(z.string()).default(['1px', '100%', '50%', '#ffffff', '#000000', 'white', 'black', 'inherit']),
  })
  .strict();
const nearOptions = z.object({ maxDistance: z.number().min(0).default(8) }).strict();

const LABELS: Record<TokenCategory, string> = {
  color: 'colour',
  spacing: 'spacing value',
  typography: 'typography value',
  radius: 'border radius',
  shadow: 'shadow',
  breakpoint: 'breakpoint',
};

export function parseColor(value: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(value);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /^rgba?\((\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)(?:[,\s/]+[\d.%]+)?\)$/.exec(value.replace(/\s+/g, ' '));
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

function evidenceFor(list: TokenOccurrence[], max = 8): Evidence[] {
  const ev: Evidence[] = list.slice(0, max).map((o) => ({ kind: 'occurrence', message: `${o.prop}`, file: o.location.file, line: o.location.line, column: o.location.column, snippet: o.value }));
  if (list.length > max) ev.push({ kind: 'note', message: `${list.length - max} more occurrence(s)` });
  return ev;
}

export const designTokensAnalyzer: Analyzer = {
  id: 'design-tokens',
  configKey: 'designTokens',
  title: 'Design tokens',
  description: 'Groups repeated colours, spacing, typography, radii, shadows and breakpoints that could become shared CSS variables.',
  rules: [
    {
      id: 'repeated-value',
      title: 'Repeated value (design token candidate)',
      description: 'A literal value is repeated often enough that it could become a shared CSS custom property.',
      defaultSeverity: 'info',
      optionsSchema: repeatedOptions,
      rationale: 'Counts literal values per category across all declarations (var() references are excluded). CSS Archaeology never introduces or replaces variables; it only shows where a shared token could help.',
    },
    {
      id: 'hardcoded-token-value',
      title: 'Hard-coded token value',
      description: 'A literal value is used even though a custom property with exactly that value is defined.',
      defaultSeverity: 'low',
      rationale: 'When --brand: #0047ab exists, writing #0047ab directly means the two can drift apart. Matching is exact on the normalised value; the variable may still be intentionally separate.',
    },
    {
      id: 'near-duplicate-color',
      title: 'Near-duplicate colours',
      description: 'Two colours are almost, but not exactly, the same.',
      defaultSeverity: 'low',
      optionsSchema: nearOptions,
      rationale: 'Colours within a small RGB distance (default 8) are rarely intentional and usually indicate drifting design tokens.',
    },
  ],
  run(ctx) {
    const findings: FindingDraft[] = [];
    const occurrences = collectTokenOccurrences(ctx.project);
    const defined = customPropertyValues(ctx.project);
    const opts = ctx.rule<z.infer<typeof repeatedOptions>>('repeated-value').options;
    const groups = new Map<string, TokenOccurrence[]>();
    for (const o of occurrences) {
      const key = `${o.category}\u0000${o.value}`;
      const list = groups.get(key) ?? [];
      list.push(o);
      groups.set(key, list);
    }
    for (const list of groups.values()) {
      const { category, value } = list[0]!;
      const definedAs = [...(defined.get(value.toLowerCase()) ?? [])];
      const first = list[0]!;
      if (definedAs.length > 0 && category !== 'breakpoint') {
        findings.push({
          rule: 'hardcoded-token-value',
          severity: 'low',
          baseConfidence: 0.75,
          title: `${value} is hard-coded but defined as ${definedAs[0]}`,
          description: `The ${LABELS[category]} ${value} is written literally ${list.length} time(s) although ${definedAs.join(', ')} ${definedAs.length > 1 ? 'are' : 'is'} defined with the same value.`,
          file: first.location.file,
          line: first.location.line,
          column: first.location.column,
          value,
          evidence: evidenceFor(list),
          suggestion: `Review whether these should use var(${definedAs[0]}).`,
          data: { category, count: list.length, definedAs },
        });
        continue;
      }
      if (!opts.categories.includes(category) || list.length < opts.minOccurrences || opts.ignore.includes(value)) continue;
      const files = new Set(list.map((o) => o.location.file));
      findings.push({
        rule: 'repeated-value',
        severity: 'info',
        baseConfidence: 0.9,
        title: `Repeated ${LABELS[category]} ${value} (${list.length} uses)`,
        description: `${value} is used ${list.length} times in ${files.size} file(s) for ${[...new Set(list.map((o) => o.prop))].slice(0, 4).join(', ')}.`,
        file: first.location.file,
        line: first.location.line,
        column: first.location.column,
        value,
        evidence: evidenceFor(list),
        suggestion: 'Consider a shared CSS custom property for this value. CSS Archaeology does not change your code.',
        data: { category, count: list.length, files: files.size },
      });
    }

    /* Near-duplicate colours ---------------------------------------------- */
    const { maxDistance } = ctx.rule<z.infer<typeof nearOptions>>('near-duplicate-color').options;
    const colors = [...groups.values()]
      .filter((l) => l[0]!.category === 'color')
      .map((l) => ({ value: l[0]!.value, rgb: parseColor(l[0]!.value), list: l }))
      .filter((c): c is { value: string; rgb: [number, number, number]; list: TokenOccurrence[] } => c.rgb !== null);
    const reported = new Set<string>();
    for (let i = 0; i < colors.length; i++) {
      for (let j = i + 1; j < colors.length; j++) {
        const a = colors[i]!;
        const b = colors[j]!;
        const d = Math.hypot(a.rgb[0] - b.rgb[0], a.rgb[1] - b.rgb[1], a.rgb[2] - b.rgb[2]);
        if (d === 0 || d > maxDistance) continue;
        const [major, minor] = a.list.length >= b.list.length ? [a, b] : [b, a];
        if (reported.has(minor.value)) continue;
        reported.add(minor.value);
        const at = minor.list[0]!.location;
        findings.push({
          rule: 'near-duplicate-color',
          severity: 'low',
          baseConfidence: 0.65,
          title: `${minor.value} is nearly identical to ${major.value}`,
          description: `${minor.value} (${minor.list.length}×) differs from ${major.value} (${major.list.length}×) by an RGB distance of ${d.toFixed(1)}.`,
          file: at.file,
          line: at.line,
          column: at.column,
          value: minor.value,
          evidence: [...evidenceFor(minor.list, 4), ...evidenceFor(major.list, 2)],
          suggestion: `Check whether ${minor.value} should be ${major.value}, and consider a shared token for it.`,
          data: { distance: d, colors: [major.value, minor.value] },
        });
      }
    }
    return findings;
  },
};
