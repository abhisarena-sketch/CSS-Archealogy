import type { Analyzer, FindingDraft } from '@css-archaeology/core';
import { z } from 'zod';

const sizeOptions = z
  .object({
    maxBytes: z.number().int().positive().default(150_000),
    maxLines: z.number().int().positive().default(4_000),
    maxRules: z.number().int().positive().default(1_500),
  })
  .strict();
const nestingOptions = z.object({ maxDepth: z.number().int().min(1).default(3) }).strict();

export const complexityAnalyzer: Analyzer = {
  id: 'complexity',
  configKey: 'complexity',
  title: 'Stylesheet complexity',
  description: 'Flags oversized stylesheets and deeply nested rules. Measurements for every stylesheet are in the report metrics.',
  rules: [
    {
      id: 'oversized-stylesheet',
      title: 'Oversized stylesheet',
      description: 'A stylesheet exceeds the configured size, line or rule limits.',
      defaultSeverity: 'medium',
      optionsSchema: sizeOptions,
      rationale: 'Very large stylesheets are hard to navigate and usually mix unrelated concerns. Limits default to 150 KB, 4,000 lines or 1,500 rules and are measured from the source files.',
    },
    {
      id: 'deep-nesting',
      title: 'Deeply nested rule',
      description: 'A nested rule is deeper than the configured maximum.',
      defaultSeverity: 'low',
      optionsSchema: nestingOptions,
      rationale: 'Deep nesting (CSS nesting or SCSS) produces long, highly specific selectors and couples styles to markup structure.',
    },
  ],
  run(ctx) {
    const findings: FindingDraft[] = [];
    const size = ctx.rule<z.infer<typeof sizeOptions>>('oversized-stylesheet').options;
    for (const sheet of ctx.project.stylesheets) {
      const over: string[] = [];
      if (sheet.bytes > size.maxBytes) over.push(`${(sheet.bytes / 1024).toFixed(1)} KB (limit ${(size.maxBytes / 1024).toFixed(0)} KB)`);
      if (sheet.lines > size.maxLines) over.push(`${sheet.lines} lines (limit ${size.maxLines})`);
      if (sheet.ruleCount > size.maxRules) over.push(`${sheet.ruleCount} rules (limit ${size.maxRules})`);
      if (!over.length) continue;
      findings.push({
        rule: 'oversized-stylesheet',
        severity: 'medium',
        baseConfidence: 0.98,
        title: `Oversized stylesheet ${sheet.file}`,
        description: `${sheet.file} has ${over.join(', ')}.`,
        file: sheet.file,
        line: 1,
        column: 1,
        evidence: [
          { kind: 'metric', message: `${sheet.bytes} bytes, ${sheet.lines} lines, ${sheet.ruleCount} rules, ${sheet.selectorCount} selectors, ${sheet.declarationCount} declarations` },
        ],
        suggestion: 'Split the stylesheet by component or concern, and remove unused rules first.',
        data: { bytes: sheet.bytes, lines: sheet.lines, rules: sheet.ruleCount },
      });
    }
    const { maxDepth } = ctx.rule<z.infer<typeof nestingOptions>>('deep-nesting').options;
    for (const rule of ctx.project.rules) {
      if (rule.nestingDepth <= maxDepth || rule.rawSelector === '&') continue;
      findings.push({
        rule: 'deep-nesting',
        severity: 'low',
        baseConfidence: 0.95,
        title: `Rule nested ${rule.nestingDepth} levels deep`,
        description: `${rule.selectorText} is nested ${rule.nestingDepth} levels deep (limit ${maxDepth}).`,
        file: rule.file,
        line: rule.line,
        column: rule.column,
        selector: rule.selectorText,
        evidence: [{ kind: 'selector', message: `Written as "${rule.rawSelector}"`, file: rule.file, line: rule.line, snippet: rule.selectorText }],
        suggestion: 'Flatten the nesting; give deeply nested elements their own class.',
      });
    }
    return findings;
  },
};
