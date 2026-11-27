import type { ZodType } from 'zod';
import type { AnalysisKey, CssArchaeologyConfig, ResolvedRuleSetting, Safelist } from './config.js';
import type { ProjectModel } from './project.js';
import type { FileReferences, FindingDraft, ProjectReferences, Severity, SourceFile } from './types.js';

export interface RuleMeta {
  /** Rule identifier used in findings and configuration, e.g. `duplicate-declaration`. */
  id: string;
  title: string;
  description: string;
  defaultSeverity: Severity;
  /** Optional Zod schema for `rules.<id>.options`. */
  optionsSchema?: ZodType;
  /** Longer explanation shown by `css-archaeology explain`. */
  rationale?: string;
}

export interface AnalyzerContext {
  config: CssArchaeologyConfig;
  project: ProjectModel;
  references: ProjectReferences;
  safelist: Safelist;
  /** Resolved settings for a rule, with validated options merged over defaults. */
  rule<T extends Record<string, unknown> = Record<string, unknown>>(id: string): ResolvedRuleSetting & { options: T };
  isRuleEnabled(id: string): boolean;
  /** Notes surfaced in the report metadata (e.g. "analysis skipped because ..."). */
  note(message: string): void;
}

export interface Analyzer {
  /** Kebab-case analyzer id, e.g. `unused-selectors`. Accepted by `--rule`. */
  id: string;
  configKey: AnalysisKey;
  title: string;
  description: string;
  rules: RuleMeta[];
  run(context: AnalyzerContext): FindingDraft[];
}

export interface DetectionInput {
  paths: string[];
  /** Dependencies and devDependencies from every discovered package.json. */
  dependencies: Set<string>;
  /** Tailwind directives seen in stylesheets. */
  tailwindDirectives: Set<string>;
}

export interface Detection {
  detected: boolean;
  reason: string;
}

export interface AdapterContext {
  config: CssArchaeologyConfig;
  /** True when the project contains a file with this path. */
  fileExists(path: string): boolean;
  /** All project paths (for alias resolution). */
  paths: readonly string[];
}

export interface ProjectHookContext extends AdapterContext {
  files: readonly SourceFile[];
  project: ProjectModel;
  references: ProjectReferences;
  note(message: string): void;
}

export interface FrameworkAdapter {
  id: string;
  title: string;
  /** Bump when extraction output changes so cached results are invalidated. */
  version: number;
  /** Lower-case extensions (without dot) this adapter extracts references from. */
  extensions: string[];
  /** When several active adapters claim an extension, the highest priority wins. */
  priority: number;
  /** Adapters this one builds on; enabling `next` also enables `react`. */
  implies?: string[];
  detect(input: DetectionInput): Detection;
  extract?(file: SourceFile, context: AdapterContext): FileReferences;
  /** Runs once after all files are extracted, before analyzers. */
  projectHook?(context: ProjectHookContext): void;
}

/** Key/value cache used for incremental scanning. */
export interface AnalysisCache {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}
