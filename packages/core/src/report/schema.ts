import { z } from 'zod';
import { CONFIDENCES, SEVERITIES } from '../types.js';

/**
 * Zod schema for the JSON report. Used by tests, by `css-archaeology report` and
 * `explain` to validate saved reports, and available to consumers of the JSON output.
 */
const location = z.object({ file: z.string(), line: z.number().int(), column: z.number().int() });
const specificity = z.tuple([z.number(), z.number(), z.number()]);

export const findingSchema = z.object({
  id: z.string().regex(/^CSSA-\d{4,}$/),
  fingerprint: z.string().min(1),
  rule: z.string().min(1),
  analyzer: z.string().min(1),
  severity: z.enum(SEVERITIES),
  confidence: z.enum(CONFIDENCES),
  confidenceScore: z.number().min(0).max(1),
  confidenceFactors: z.array(z.object({ factor: z.string(), effect: z.number(), detail: z.string() })),
  title: z.string().min(1),
  description: z.string().min(1),
  file: z.string(),
  line: z.number().int().min(0),
  column: z.number().int().min(0),
  selector: z.string().optional(),
  property: z.string().optional(),
  value: z.string().optional(),
  evidence: z.array(
    z.object({
      kind: z.enum(['declaration', 'selector', 'occurrence', 'reference', 'search', 'context', 'metric', 'note']),
      message: z.string(),
      file: z.string().optional(),
      line: z.number().int().optional(),
      column: z.number().int().optional(),
      snippet: z.string().optional(),
    }),
  ),
  suggestion: z.string().min(1),
  approximate: z.boolean(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const reportSchema = z.object({
  meta: z.object({
    tool: z.literal('css-archaeology'),
    version: z.string(),
    schemaVersion: z.literal(1),
    generatedAt: z.string(),
    root: z.string(),
    durationMs: z.number().min(0),
    frameworks: z.array(z.string()),
    analyzers: z.array(z.string()),
    filesDiscovered: z.number().int().min(0),
    filesSkipped: z.array(z.object({ file: z.string(), reason: z.string() })),
    cache: z.object({ hits: z.number(), misses: z.number() }).optional(),
    notes: z.array(z.string()),
  }),
  summary: z.object({
    stylesheets: z.number().int(),
    sourceFiles: z.number().int(),
    selectors: z.number().int(),
    declarations: z.number().int(),
    findings: z.number().int(),
    bySeverity: z.record(z.enum(SEVERITIES), z.number()),
    byConfidence: z.record(z.enum(CONFIDENCES), z.number()),
    byRule: z.record(z.string(), z.number()),
    byAnalyzer: z.record(z.string(), z.number()),
    potentiallyUnusedSelectors: z.number().int(),
    duplicateDeclarations: z.number().int(),
    specificityConflicts: z.number().int(),
    overriddenDeclarations: z.number().int(),
  }),
  metrics: z.object({
    stylesheets: z.number(),
    totalBytes: z.number(),
    totalLines: z.number(),
    totalRules: z.number(),
    totalSelectors: z.number(),
    uniqueSelectors: z.number(),
    totalDeclarations: z.number(),
    importantDeclarations: z.number(),
    customProperties: z.number(),
    mediaQueries: z.number(),
    uniqueMediaQueries: z.number(),
    repeatedDeclarations: z.number(),
    largestStylesheets: z.array(z.object({ file: z.string(), bytes: z.number(), lines: z.number(), rules: z.number() })),
    mostComplexSelectors: z.array(
      z.object({ selector: z.string(), file: z.string(), line: z.number(), specificity, compounds: z.number(), score: z.number() }),
    ),
    sizeDistribution: z.array(z.object({ label: z.string(), min: z.number(), max: z.number().nullable(), count: z.number() })),
  }),
  findings: z.array(findingSchema),
  stylesheets: z.array(
    z.object({
      file: z.string(),
      syntax: z.enum(['css', 'scss']),
      bytes: z.number(),
      lines: z.number(),
      rules: z.number(),
      selectors: z.number(),
      declarations: z.number(),
      importantDeclarations: z.number(),
      maxNestingDepth: z.number(),
      averageSpecificity: specificity,
      maxSpecificity: specificity,
      isModule: z.boolean(),
      embeddedIn: z.string().optional(),
      parseIssues: z.number(),
      findings: z.number(),
    }),
  ),
  selectors: z.array(
    z.object({
      selector: z.string(),
      specificity,
      occurrences: z.number(),
      files: z.array(z.string()),
      locations: z.array(location),
      findingIds: z.array(z.string()),
    }),
  ),
  tokens: z.array(
    z.object({
      category: z.enum(['color', 'spacing', 'typography', 'radius', 'shadow', 'breakpoint']),
      value: z.string(),
      count: z.number(),
      properties: z.array(z.string()),
      definedAs: z.array(z.string()),
      locations: z.array(location),
    }),
  ),
  parseIssues: z.array(
    z.object({ file: z.string(), line: z.number(), column: z.number(), message: z.string(), kind: z.enum(['recovered', 'fatal']) }),
  ),
});

export type ReportShape = z.infer<typeof reportSchema>;
