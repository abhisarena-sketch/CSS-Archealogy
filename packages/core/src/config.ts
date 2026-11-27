import { z } from 'zod';
// CSS Archaeology never evaluates generated code: turn off Zod's `new Function` JIT.
z.config({ jitless: true });

import { SEVERITIES, CONFIDENCES, type Severity, type Confidence } from './types.js';

export const FRAMEWORKS = ['auto', 'html', 'react', 'next', 'css-modules', 'tailwind'] as const;
export type Framework = (typeof FRAMEWORKS)[number];

export const REPORT_FORMATS = ['json', 'html'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

/** Analysis toggles. Keys match the configuration file. */
export const ANALYSIS_KEYS = [
  'unusedSelectors',
  'duplicateDeclarations',
  'specificityConflicts',
  'overriddenDeclarations',
  'mediaQueries',
  'designTokens',
  'complexity',
] as const;
export type AnalysisKey = (typeof ANALYSIS_KEYS)[number];

export const DEFAULT_EXCLUDES = [
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'out',
  'coverage',
  '.css-archaeology',
] as const;

const severitySchema = z.enum(SEVERITIES);
const confidenceSchema = z.enum(CONFIDENCES);

const ruleSettingSchema = z.union([
  z.literal('off'),
  severitySchema,
  z
    .object({
      enabled: z.boolean().optional(),
      severity: severitySchema.optional(),
      options: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
]);

export type RuleSetting = z.infer<typeof ruleSettingSchema>;

const analysisSchema = z
  .object({
    unusedSelectors: z.boolean().default(true),
    duplicateDeclarations: z.boolean().default(true),
    specificityConflicts: z.boolean().default(true),
    overriddenDeclarations: z.boolean().default(true),
    mediaQueries: z.boolean().default(true),
    designTokens: z.boolean().default(true),
    complexity: z.boolean().default(true),
  })
  .strict();

const frameworkSchema = z.union([z.enum(FRAMEWORKS), z.array(z.enum(FRAMEWORKS)).min(1)]);

export const configSchema = z
  .object({
    $schema: z.string().optional(),
    include: z.array(z.string().min(1)).default(['**/*']),
    exclude: z.array(z.string().min(1)).default([...DEFAULT_EXCLUDES]),
    framework: frameworkSchema.default('auto'),
    analysis: analysisSchema.default({
      unusedSelectors: true,
      duplicateDeclarations: true,
      specificityConflicts: true,
      overriddenDeclarations: true,
      mediaQueries: true,
      designTokens: true,
      complexity: true,
    }),
    /**
     * Selectors, class names or `/regex/flags` patterns that must never be reported
     * as potentially unused.
     */
    safelist: z.array(z.string().min(1)).default([]),
    reportFormat: z.array(z.enum(REPORT_FORMATS)).default(['json', 'html']),
    outputDir: z.string().min(1).default('.css-archaeology'),
    rules: z.record(z.string(), ruleSettingSchema).default({}),
    /** Exit with a non-zero status when a finding at or above this severity exists. */
    failOn: z.union([severitySchema, z.literal('none')], { error: 'Expected one of "info", "low", "medium", "high" or "none"' }).default('high'),
    minConfidence: confidenceSchema.default('low'),
    /** Files larger than this many bytes are skipped (and listed in the report). */
    maxFileSize: z.number().int().positive().default(2_000_000),
    /** Maximum number of files read concurrently. */
    concurrency: z.number().int().min(1).max(256).default(16),
    /** Reuse parse/extraction results for unchanged files between scans. */
    cache: z.boolean().default(true),
    cssModules: z
      .object({
        /** Which class name conversions the bundler applies to exported names. */
        localsConvention: z.enum(['asIs', 'camelCase', 'camelCaseOnly', 'dashes', 'dashesOnly']).default('camelCase'),
      })
      .strict()
      .default({ localsConvention: 'camelCase' }),
    /** Additional file extensions scanned for class tokens only (no structured parsing). */
    tokenScanExtensions: z
      .array(z.string().regex(/^[a-z0-9]+$/i, 'extensions are written without the dot'))
      .default(['vue', 'svelte', 'astro', 'php', 'erb', 'hbs', 'handlebars', 'twig', 'njk', 'liquid', 'md', 'mdx', 'ejs', 'pug']),
  })
  .strict();

export type CssArchaeologyConfigInput = z.input<typeof configSchema>;
export type CssArchaeologyConfig = z.output<typeof configSchema>;

export interface ConfigIssue {
  path: string;
  message: string;
}

export type ConfigValidation =
  | { ok: true; config: CssArchaeologyConfig; warnings: ConfigIssue[] }
  | { ok: false; issues: ConfigIssue[] };

export function validateConfig(input: unknown): ConfigValidation {
  const parsed = configSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.length ? issue.path.map(String).join('.') : '(root)',
        message: issue.message,
      })),
    };
  }
  const warnings: ConfigIssue[] = [];
  parsed.data.safelist.forEach((entry, index) => {
    if (isRegexEntry(entry) && compileSafelistRegex(entry) === null) {
      warnings.push({ path: `safelist.${index}`, message: `"${entry}" looks like a regular expression but is not valid` });
    }
  });
  return { ok: true, config: parsed.data, warnings };
}

export function resolveConfig(input: unknown = {}): CssArchaeologyConfig {
  const result = validateConfig(input);
  if (!result.ok) {
    throw new ConfigError(result.issues);
  }
  return result.config;
}

export class ConfigError extends Error {
  readonly issues: ConfigIssue[];
  constructor(issues: ConfigIssue[]) {
    super(`Invalid configuration:\n${issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

export function frameworksOf(config: CssArchaeologyConfig): Framework[] {
  return Array.isArray(config.framework) ? config.framework : [config.framework];
}

/* ------------------------------------------------------------------------- */
/* Rule settings                                                             */
/* ------------------------------------------------------------------------- */

export interface ResolvedRuleSetting {
  enabled: boolean;
  severity?: Severity;
  options: Record<string, unknown>;
}

export function ruleSetting(config: CssArchaeologyConfig, rule: string): ResolvedRuleSetting {
  const setting = config.rules[rule];
  if (setting === undefined) return { enabled: true, options: {} };
  if (setting === 'off') return { enabled: false, options: {} };
  if (typeof setting === 'string') return { enabled: true, severity: setting, options: {} };
  const resolved: ResolvedRuleSetting = { enabled: setting.enabled ?? true, options: setting.options ?? {} };
  if (setting.severity) resolved.severity = setting.severity;
  return resolved;
}

/* ------------------------------------------------------------------------- */
/* Safelist                                                                  */
/* ------------------------------------------------------------------------- */

function isRegexEntry(entry: string): boolean {
  return entry.length > 2 && entry.startsWith('/') && entry.lastIndexOf('/') > 0;
}

function compileSafelistRegex(entry: string): RegExp | null {
  const last = entry.lastIndexOf('/');
  const body = entry.slice(1, last);
  const flags = entry.slice(last + 1);
  if (!/^[gimsuy]*$/.test(flags)) return null;
  try {
    return new RegExp(body, flags.replace('g', ''));
  } catch {
    return null;
  }
}

export interface Safelist {
  /** True when the selector text, or any class / id it requires, is safelisted. */
  matchesSelector(selector: string, classes: string[], ids: string[]): boolean;
}

export function createSafelist(entries: string[]): Safelist {
  const exact = new Set<string>();
  const patterns: RegExp[] = [];
  for (const entry of entries) {
    if (isRegexEntry(entry)) {
      const re = compileSafelistRegex(entry);
      if (re) patterns.push(re);
    } else {
      exact.add(entry.trim());
    }
  }
  const test = (value: string) => exact.has(value) || patterns.some((re) => re.test(value));
  return {
    matchesSelector(selector, classes, ids) {
      if (test(selector)) return true;
      for (const c of classes) if (test(c) || test(`.${c}`)) return true;
      for (const i of ids) if (test(i) || test(`#${i}`)) return true;
      return false;
    },
  };
}

export function severityRank(severity: Severity): number {
  return SEVERITIES.indexOf(severity);
}

export function confidenceRank(confidence: Confidence): number {
  return CONFIDENCES.indexOf(confidence);
}

export const DEFAULT_CONFIG_FILE = 'css-archaeology.config.json';
export const CONFIG_FILE_NAMES = [DEFAULT_CONFIG_FILE, '.css-archaeologyrc.json', '.css-archaeologyrc'] as const;

/** Configuration written by `css-archaeology init`. */
export function starterConfig(framework: Framework = 'auto'): CssArchaeologyConfigInput {
  return {
    include: ['**/*'],
    exclude: [...DEFAULT_EXCLUDES],
    framework,
    analysis: {
      unusedSelectors: true,
      duplicateDeclarations: true,
      specificityConflicts: true,
      overriddenDeclarations: true,
      mediaQueries: true,
      designTokens: true,
      complexity: true,
    },
    safelist: [],
    reportFormat: ['json', 'html'],
    failOn: 'high',
  };
}
