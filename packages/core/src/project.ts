import { resolveRelative } from './paths.js';
import type { CssSideReference, StylesheetModel } from './stylesheet.js';
import type {
  AtRuleRecord,
  CssDeclaration,
  CssRule,
  StylesheetImport,
  StylesheetRecord,
} from './types.js';

export type OrderSource = 'import-graph' | 'path';

export interface ProjectCssReference extends CssSideReference {
  file: string;
}

/** The merged, project-wide stylesheet model analyzers work with. */
export interface ProjectModel {
  stylesheets: StylesheetRecord[];
  rules: CssRule[];
  declarations: CssDeclaration[];
  atRules: AtRuleRecord[];
  /** Cascade layer names in precedence order (earlier = lower precedence). */
  layerOrder: string[];
  cssReferences: ProjectCssReference[];
  applyTokens: { file: string; token: string }[];
  /** How the relative order of each stylesheet was determined. */
  orderSource: Map<string, OrderSource>;
  rulesByFile: Map<string, number[]>;
}

const ENTRY_PATTERNS: RegExp[] = [
  /^(src\/)?app\/layout\.[jt]sx?$/,
  /^(src\/)?pages\/_app\.[jt]sx?$/,
  /^(src\/)?pages\/_document\.[jt]sx?$/,
  /^(src\/)?(main|index|app|App)\.[jt]sx?$/,
  /^index\.html?$/,
  /^(public|src)\/index\.html?$/,
];

function entryRank(file: string): number {
  const i = ENTRY_PATTERNS.findIndex((re) => re.test(file));
  return i < 0 ? ENTRY_PATTERNS.length : i;
}

/**
 * Approximate the order in which stylesheets reach the browser. Stylesheets imported
 * from known entry points (Next.js layouts, `_app`, `main.tsx`, `index.html`) come first
 * in import order, CSS `@import` targets precede their importer, and everything else
 * falls back to path order. Cross-file cascade results are therefore approximate.
 */
export function orderStylesheets(
  models: StylesheetModel[],
  sourceImports: StylesheetImport[],
): { order: string[]; source: Map<string, OrderSource> } {
  const known = new Set(models.map((m) => m.record.file));
  const cssImports = new Map<string, string[]>();
  for (const m of models) {
    const targets: string[] = [];
    for (const target of m.record.imports) {
      const resolved = resolveRelative(m.record.file, target) ?? resolveRelative(m.record.file, `./${target}`);
      if (resolved && known.has(resolved)) targets.push(resolved);
    }
    cssImports.set(m.record.file, targets);
  }
  const order: string[] = [];
  const source = new Map<string, OrderSource>();
  const visiting = new Set<string>();
  const visit = (file: string, how: OrderSource) => {
    if (source.has(file) || visiting.has(file)) return;
    visiting.add(file);
    for (const dep of cssImports.get(file) ?? []) visit(dep, how);
    visiting.delete(file);
    source.set(file, how);
    order.push(file);
  };

  const byImporter = new Map<string, StylesheetImport[]>();
  for (const imp of sourceImports) {
    if (!known.has(imp.stylesheet)) continue;
    const list = byImporter.get(imp.importer) ?? [];
    list.push(imp);
    byImporter.set(imp.importer, list);
  }
  const importers = [...byImporter.keys()].sort((a, b) => entryRank(a) - entryRank(b) || a.localeCompare(b));
  for (const importer of importers) {
    const list = byImporter.get(importer)!.sort((a, b) => a.position - b.position);
    for (const imp of list) visit(imp.stylesheet, 'import-graph');
  }
  const remaining = models.map((m) => m.record.file).sort((a, b) => a.localeCompare(b));
  for (const file of remaining) visit(file, 'path');
  return { order, source };
}

export function buildProjectModel(models: StylesheetModel[], sourceImports: StylesheetImport[]): ProjectModel {
  const { order, source } = orderStylesheets(models, sourceImports);
  const byFile = new Map(models.map((m) => [m.record.file, m]));
  const stylesheets: StylesheetRecord[] = [];
  const rules: CssRule[] = [];
  const declarations: CssDeclaration[] = [];
  const atRules: AtRuleRecord[] = [];
  const layerOrder: string[] = [];
  const cssReferences: ProjectCssReference[] = [];
  const applyTokens: { file: string; token: string }[] = [];
  const rulesByFile = new Map<string, number[]>();
  let orderCounter = 0;

  order.forEach((file, orderIndex) => {
    const model = byFile.get(file)!;
    stylesheets.push({ ...model.record, orderIndex });
    atRules.push(...model.atRules);
    for (const layer of model.layers) if (!layerOrder.includes(layer)) layerOrder.push(layer);
    for (const ref of model.cssReferences) cssReferences.push({ ...ref, file });
    for (const token of model.applyTokens) applyTokens.push({ file, token });
    const indexes: number[] = [];
    for (const local of model.rules) {
      const ruleIndex = rules.length;
      const declarationIndexes: number[] = [];
      const ruleOrder = orderCounter++;
      for (const d of local.declarations) {
        const index = declarations.length;
        declarations.push({
          index,
          ruleIndex,
          file,
          line: d.line,
          column: d.column,
          prop: d.prop,
          value: d.value,
          rawValue: d.rawValue,
          important: d.important,
          order: orderCounter++,
          custom: d.prop.startsWith('--'),
        });
        declarationIndexes.push(index);
      }
      rules.push({
        index: ruleIndex,
        file,
        line: local.line,
        column: local.column,
        endLine: local.endLine,
        rawSelector: local.rawSelector,
        selectorText: local.selectorText,
        selectors: local.selectors,
        context: local.context,
        contextKey: local.contextKey,
        declarationIndexes,
        order: ruleOrder,
        nestingDepth: local.nestingDepth,
        isModule: model.record.isModule,
      });
      indexes.push(ruleIndex);
    }
    rulesByFile.set(file, indexes);
  });

  return { stylesheets, rules, declarations, atRules, layerOrder, cssReferences, applyTokens, orderSource: source, rulesByFile };
}
