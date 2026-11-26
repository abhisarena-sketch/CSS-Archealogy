import type { Analyzer, RuleMeta } from '@css-archaeology/core';
import { CORE_RULES } from '@css-archaeology/core';
import { duplicateDeclarationsAnalyzer } from './duplicate-declarations.js';
import { overriddenDeclarationsAnalyzer } from './overridden-declarations.js';
import { specificityAnalyzer } from './specificity.js';
import { unusedSelectorsAnalyzer } from './unused-selectors.js';

export { duplicateDeclarationsAnalyzer, overriddenDeclarationsAnalyzer, specificityAnalyzer, unusedSelectorsAnalyzer };
export * from './cascade.js';
export { moduleExportNames } from './unused-selectors.js';

/** All built-in analyzers in execution order. */
export const defaultAnalyzers: Analyzer[] = [
  unusedSelectorsAnalyzer,
  duplicateDeclarationsAnalyzer,
  specificityAnalyzer,
  overriddenDeclarationsAnalyzer,
];

/** Metadata for every rule, including engine-level rules such as parse-error. */
export function allRules(analyzers: Analyzer[] = defaultAnalyzers): (RuleMeta & { analyzer: string })[] {
  return [
    ...analyzers.flatMap((a) => a.rules.map((r) => ({ ...r, analyzer: a.id }))),
    ...CORE_RULES.map((r) => ({ ...r, analyzer: 'parser' })),
  ];
}
