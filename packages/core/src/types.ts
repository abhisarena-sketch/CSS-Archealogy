/**
 * Shared data model for CSS Archaeology.
 *
 * Everything in this module is plain, serialisable data so that analysis results
 * can be cached, written to JSON and rendered in the browser playground.
 */

export const SEVERITIES = ['info', 'low', 'medium', 'high'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CONFIDENCES = ['low', 'medium', 'high'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

/** A file handed to the engine. Paths are POSIX-style and relative to the project root. */
export interface SourceFile {
  path: string;
  content: string;
}

export interface SourceLocation {
  file: string;
  line: number;
  column: number;
}

/** Specificity as (ids, classes/attributes/pseudo-classes, elements/pseudo-elements). */
export type Specificity = [number, number, number];

export type EvidenceKind =
  | 'declaration'
  | 'selector'
  | 'occurrence'
  | 'reference'
  | 'search'
  | 'context'
  | 'metric'
  | 'note';

export interface Evidence {
  kind: EvidenceKind;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  /** Short source excerpt (never more than a single line or declaration). */
  snippet?: string;
}

export interface ConfidenceFactor {
  /** Machine-readable factor identifier, e.g. `dynamic-class-expressions`. */
  factor: string;
  /** Positive values raise confidence, negative values lower it. Range -1..1. */
  effect: number;
  detail: string;
}

export interface Finding {
  /** Report-scoped identifier, e.g. `CSSA-0001`. Assigned after sorting. */
  id: string;
  /** Stable hash of the rule and the code it points at, usable for baselines. */
  fingerprint: string;
  rule: string;
  analyzer: string;
  severity: Severity;
  confidence: Confidence;
  /** Numeric confidence score in the range 0..1 used to derive `confidence`. */
  confidenceScore: number;
  confidenceFactors: ConfidenceFactor[];
  title: string;
  description: string;
  file: string;
  line: number;
  column: number;
  selector?: string;
  property?: string;
  value?: string;
  evidence: Evidence[];
  suggestion: string;
  /** True when the result relies on approximations of browser behaviour. */
  approximate: boolean;
  /** Extra structured data specific to the rule. */
  data?: Record<string, unknown>;
}

/** Finding as produced by an analyzer, before ids, scoring and overrides are applied. */
export interface FindingDraft {
  rule: string;
  severity: Severity;
  /** Base confidence score 0..1 before factors are applied. */
  baseConfidence: number;
  confidenceFactors?: ConfidenceFactor[];
  title: string;
  description: string;
  file: string;
  line: number;
  column?: number;
  selector?: string;
  property?: string;
  value?: string;
  evidence: Evidence[];
  suggestion: string;
  approximate?: boolean;
  data?: Record<string, unknown>;
}

/* ------------------------------------------------------------------------- */
/* Stylesheet model                                                          */
/* ------------------------------------------------------------------------- */

export type StylesheetSyntax = 'css' | 'scss';

export interface CssContext {
  /** Normalised media query conditions from outermost to innermost. */
  media: string[];
  supports: string[];
  container: string[];
  /** Cascade layer name (dot-joined for nested layers), `null` when unlayered. */
  layer: string | null;
  /** `@scope` preludes. */
  scope: string[];
}

export interface SelectorPart {
  /** Normalised selector text after nesting resolution. */
  text: string;
  specificity: Specificity;
  classes: string[];
  ids: string[];
  elements: string[];
  attributes: string[];
  pseudoClasses: string[];
  pseudoElements: string[];
  /** Number of compound selectors (separated by combinators). */
  compounds: number;
  /** Total number of simple selectors. */
  simpleSelectors: number;
  /** Normalised text of the right-most compound (the "key" selector). */
  keyCompound: string;
  /** Simple selectors of the key compound, excluding state pseudo-classes such as :hover. Sorted. */
  keySimple: string[];
  /** All simple selectors of the key compound, including pseudo-classes and pseudo-elements. Sorted. */
  keyAll: string[];
  /** Contains `:global(...)` (CSS Modules). */
  hasGlobal: boolean;
  /** Contains an interpolation or other construct that could not be analysed. */
  unparseable: boolean;
  /**
   * What markup must contain for this selector to match anything. Alternatives come
   * from `:is()` / `:where()` / selector lists inside pseudo-classes.
   */
  requirements: SelectorRequirements;
}

export interface SelectorRequirements {
  classes: string[];
  ids: string[];
  elements: string[];
  attributes: string[];
  /** Each entry is a set of alternatives; at least one alternative must be present. */
  alternatives: SelectorRequirements[][];
}

export interface CssDeclaration {
  /** Index into `ProjectModel.declarations`. */
  index: number;
  ruleIndex: number;
  file: string;
  line: number;
  column: number;
  prop: string;
  value: string;
  rawValue: string;
  important: boolean;
  /** Global cascade order across the project (approximate across files). */
  order: number;
  /** True when declared on a custom property (`--foo`). */
  custom: boolean;
}

export interface CssRule {
  index: number;
  file: string;
  line: number;
  column: number;
  endLine: number;
  /** Raw selector as written in the source (before nesting resolution). */
  rawSelector: string;
  selectorText: string;
  selectors: SelectorPart[];
  context: CssContext;
  contextKey: string;
  declarationIndexes: number[];
  order: number;
  /** Source nesting depth (0 = top level rule). */
  nestingDepth: number;
  /** Stylesheet is a CSS Module. */
  isModule: boolean;
}

export interface AtRuleRecord {
  file: string;
  line: number;
  column: number;
  name: string;
  params: string;
  /** Number of direct child nodes. */
  childCount: number;
  context: CssContext;
}

export interface ParseIssue {
  file: string;
  line: number;
  column: number;
  message: string;
  /** `recovered` means the safe parser repaired the input and analysis continued. */
  kind: 'recovered' | 'fatal';
}

export interface StylesheetRecord {
  file: string;
  syntax: StylesheetSyntax;
  bytes: number;
  lines: number;
  ruleCount: number;
  selectorCount: number;
  declarationCount: number;
  importantCount: number;
  maxNestingDepth: number;
  isModule: boolean;
  /** Contains Tailwind directives (`@tailwind`, `@import "tailwindcss"`, `@apply`, `@theme`). */
  tailwindDirectives: string[];
  /** Other stylesheets referenced through `@import`, resolved to project paths when possible. */
  imports: string[];
  /** Embedded stylesheet extracted from another file (e.g. HTML `<style>`). */
  embeddedIn?: string;
  parseIssues: ParseIssue[];
  /** Position used to approximate cascade order across files. */
  orderIndex: number;
}

/* ------------------------------------------------------------------------- */
/* Source references                                                         */
/* ------------------------------------------------------------------------- */

export type ReferenceKind = 'class' | 'id' | 'element' | 'attribute';

export interface ReferenceOccurrence {
  file: string;
  line: number;
  column: number;
  /** How the reference was found, e.g. `jsx-className`, `html-class`, `clsx-object`. */
  via: string;
}

export interface DynamicPattern {
  kind: 'class' | 'id';
  prefix: string;
  suffix: string;
  file: string;
  line: number;
  column: number;
  via: string;
}

export interface UnresolvedExpression {
  file: string;
  line: number;
  column: number;
  via: string;
  snippet: string;
}

export interface CssModuleUsage {
  /** Project path of the CSS Module. */
  module: string;
  importer: string;
  line: number;
  /** Class names accessed statically (as written in code, before name conversion). */
  accessed: string[];
  /** Prefixes from dynamic access like styles[`btn-${x}`]. */
  dynamicPrefixes: string[];
  /** The module object escaped (spread, passed, indexed with an unknown key). */
  escaped: boolean;
}

export interface StylesheetImport {
  importer: string;
  stylesheet: string;
  line: number;
  /** Position of the import inside the importer (0-based). */
  position: number;
}

/**
 * References extracted from one source file. Plain data so it can be cached
 * between incremental scans.
 */
export interface FileReferences {
  file: string;
  adapter: string;
  classes: Record<string, ReferenceOccurrence[]>;
  ids: Record<string, ReferenceOccurrence[]>;
  elements: Record<string, ReferenceOccurrence[]>;
  attributes: Record<string, ReferenceOccurrence[]>;
  /** Every identifier-like token found in string literals or text. Weak evidence. */
  tokens: string[];
  dynamicPatterns: DynamicPattern[];
  unresolved: UnresolvedExpression[];
  cssModules: CssModuleUsage[];
  stylesheetImports: StylesheetImport[];
  /** Embedded stylesheets (e.g. `<style>` blocks) to analyse as CSS. */
  embeddedStylesheets: EmbeddedStylesheet[];
  notes: string[];
}

export interface EmbeddedStylesheet {
  path: string;
  content: string;
  /** Line in the host file where the embedded CSS starts (1-based). */
  lineOffset: number;
}

export interface ProjectReferences {
  classes: Map<string, ReferenceOccurrence[]>;
  ids: Map<string, ReferenceOccurrence[]>;
  elements: Map<string, ReferenceOccurrence[]>;
  attributes: Map<string, ReferenceOccurrence[]>;
  tokens: Map<string, string[]>;
  dynamicPatterns: DynamicPattern[];
  unresolved: UnresolvedExpression[];
  cssModules: CssModuleUsage[];
  stylesheetImports: StylesheetImport[];
  sourceFileCount: number;
  /** Files scanned per adapter id. */
  adapterFiles: Record<string, number>;
}

/* ------------------------------------------------------------------------- */
/* Results                                                                   */
/* ------------------------------------------------------------------------- */

export interface StylesheetSummary {
  file: string;
  syntax: StylesheetSyntax;
  bytes: number;
  lines: number;
  rules: number;
  selectors: number;
  declarations: number;
  importantDeclarations: number;
  maxNestingDepth: number;
  averageSpecificity: Specificity;
  maxSpecificity: Specificity;
  isModule: boolean;
  embeddedIn?: string;
  parseIssues: number;
  findings: number;
}

export interface SelectorSummary {
  selector: string;
  specificity: Specificity;
  occurrences: number;
  files: string[];
  locations: SourceLocation[];
  findingIds: string[];
}

export type TokenCategory = 'color' | 'spacing' | 'typography' | 'radius' | 'shadow' | 'breakpoint';

export interface TokenValueSummary {
  category: TokenCategory;
  value: string;
  count: number;
  properties: string[];
  /** Custom properties already defined with exactly this value. */
  definedAs: string[];
  locations: SourceLocation[];
}

export interface ComplexityMetrics {
  stylesheets: number;
  totalBytes: number;
  totalLines: number;
  totalRules: number;
  totalSelectors: number;
  uniqueSelectors: number;
  totalDeclarations: number;
  importantDeclarations: number;
  customProperties: number;
  mediaQueries: number;
  uniqueMediaQueries: number;
  repeatedDeclarations: number;
  largestStylesheets: { file: string; bytes: number; lines: number; rules: number }[];
  mostComplexSelectors: { selector: string; file: string; line: number; specificity: Specificity; compounds: number; score: number }[];
  sizeDistribution: { label: string; min: number; max: number | null; count: number }[];
}

export interface AnalysisSummary {
  stylesheets: number;
  sourceFiles: number;
  selectors: number;
  declarations: number;
  findings: number;
  bySeverity: Record<Severity, number>;
  byConfidence: Record<Confidence, number>;
  byRule: Record<string, number>;
  byAnalyzer: Record<string, number>;
  potentiallyUnusedSelectors: number;
  duplicateDeclarations: number;
  specificityConflicts: number;
  overriddenDeclarations: number;
}

export interface AnalysisMeta {
  tool: 'css-archaeology';
  version: string;
  schemaVersion: 1;
  generatedAt: string;
  root: string;
  durationMs: number;
  frameworks: string[];
  analyzers: string[];
  filesDiscovered: number;
  filesSkipped: { file: string; reason: string }[];
  cache?: { hits: number; misses: number };
  notes: string[];
}

export interface AnalysisResult {
  meta: AnalysisMeta;
  summary: AnalysisSummary;
  metrics: ComplexityMetrics;
  findings: Finding[];
  stylesheets: StylesheetSummary[];
  selectors: SelectorSummary[];
  tokens: TokenValueSummary[];
  parseIssues: ParseIssue[];
}
