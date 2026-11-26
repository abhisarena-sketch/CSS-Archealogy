import {
  ConfigError,
  createSafelist,
  frameworksOf,
  resolveConfig,
  ruleSetting,
  confidenceRank,
  type ConfigIssue,
  type CssArchaeologyConfig,
  type CssArchaeologyConfigInput,
} from './config.js';
import { scoreConfidence } from './confidence.js';
import { hashString } from './hash.js';
import { computeMetrics, summariseSelectors, summariseStylesheets } from './metrics.js';
import { extname, resolveRelative } from './paths.js';
import type { AdapterContext, Analyzer, AnalyzerContext, AnalysisCache, DetectionInput, FrameworkAdapter } from './plugins.js';
import { buildProjectModel } from './project.js';
import { emptyFileReferences, emptyProjectReferences, mergeFileReferences, tokenize } from './references.js';
import { detectSyntax, parseStylesheet, STYLESHEET_MODEL_VERSION, type StylesheetModel } from './stylesheet.js';
import { summariseTokens } from './tokens.js';
import {
  CONFIDENCES,
  SEVERITIES,
  type AnalysisResult,
  type AnalysisSummary,
  type FileReferences,
  type Finding,
  type FindingDraft,
  type SourceFile,
} from './types.js';
import { VERSION } from './version.js';

export const STYLESHEET_EXTENSIONS = ['css', 'scss', 'pcss', 'postcss'] as const;
export const UNSUPPORTED_STYLESHEET_EXTENSIONS = ['less', 'sass', 'styl'] as const;

export type ProgressPhase = 'parse' | 'extract' | 'analyze' | 'report';
export interface ProgressEvent {
  phase: ProgressPhase;
  current: number;
  total: number;
  detail?: string;
}

export interface AnalyzeOptions {
  files: SourceFile[];
  config?: CssArchaeologyConfigInput | CssArchaeologyConfig;
  analyzers: Analyzer[];
  adapters?: FrameworkAdapter[];
  /** Display name of the scanned root (never an absolute path in shared reports unless chosen). */
  root?: string;
  cache?: AnalysisCache;
  onProgress?: (event: ProgressEvent) => void;
  /** Files discovery skipped (too large, binary, ...). Reported in metadata. */
  skipped?: { file: string; reason: string }[];
  filesDiscovered?: number;
  /** Injected clock for reproducible output. */
  now?: () => Date;
}

export function isStylesheetPath(path: string): boolean {
  return (STYLESHEET_EXTENSIONS as readonly string[]).includes(extname(path).slice(1));
}

/** Validate `rules` entries against the analyzers' rule metadata and option schemas. */
export function validateRuleSettings(config: CssArchaeologyConfig, analyzers: Analyzer[]): { errors: ConfigIssue[]; warnings: ConfigIssue[] } {
  const errors: ConfigIssue[] = [];
  const warnings: ConfigIssue[] = [];
  const metas = new Map(analyzers.flatMap((a) => a.rules.map((r) => [r.id, r] as const)));
  for (const [id, setting] of Object.entries(config.rules)) {
    const meta = metas.get(id);
    if (!meta) {
      warnings.push({ path: `rules.${id}`, message: `Unknown rule "${id}". Run \`css-archaeology explain --rules\` to list rules.` });
      continue;
    }
    if (typeof setting === 'object' && setting.options) {
      if (!meta.optionsSchema) {
        errors.push({ path: `rules.${id}.options`, message: `Rule "${id}" does not accept options` });
        continue;
      }
      const parsed = meta.optionsSchema.safeParse(setting.options);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          errors.push({ path: `rules.${id}.options${issue.path.length ? '.' + issue.path.map(String).join('.') : ''}`, message: issue.message });
        }
      }
    }
  }
  return { errors, warnings };
}

function packageDependencies(files: SourceFile[]): Set<string> {
  const deps = new Set<string>();
  for (const f of files) {
    if (!/(^|\/)package\.json$/.test(f.path) || f.path.includes('node_modules/')) continue;
    try {
      const pkg = JSON.parse(f.content) as Record<string, unknown>;
      for (const key of ['dependencies', 'devDependencies', 'peerDependencies']) {
        const section = pkg[key];
        if (section && typeof section === 'object') for (const name of Object.keys(section)) deps.add(name);
      }
    } catch {
      // A malformed package.json only affects framework detection.
    }
  }
  return deps;
}

/** Fallback extractor: class-like tokens only, for template languages without a parser. */
function tokenScan(file: SourceFile): FileReferences {
  const refs = emptyFileReferences(file.path, 'token-scan');
  const tokens = new Set<string>();
  tokenize(file.content, tokens);
  refs.tokens = [...tokens];
  return refs;
}

export function selectAdapters(
  adapters: FrameworkAdapter[],
  config: CssArchaeologyConfig,
  input: DetectionInput,
): { active: FrameworkAdapter[]; reasons: string[] } {
  const requested = frameworksOf(config).filter((f) => f !== 'auto');
  const byId = new Map(adapters.map((a) => [a.id, a]));
  const active = new Set<string>();
  const reasons: string[] = [];
  const enable = (id: string, reason: string) => {
    if (active.has(id) || !byId.has(id)) return;
    active.add(id);
    reasons.push(`${id}: ${reason}`);
    for (const implied of byId.get(id)!.implies ?? []) enable(implied, `implied by ${id}`);
  };
  for (const id of requested) {
    if (!byId.has(id)) reasons.push(`${id}: requested but no adapter with this id is installed`);
    enable(id, 'selected in configuration');
  }
  for (const adapter of adapters) {
    const detection = adapter.detect(input);
    if (detection.detected) enable(adapter.id, detection.reason);
  }
  return { active: adapters.filter((a) => active.has(a.id)), reasons };
}

export async function analyzeProject(options: AnalyzeOptions): Promise<AnalysisResult> {
  const started = Date.now();
  const config = resolveConfig(options.config ?? {});
  const ruleValidation = validateRuleSettings(config, options.analyzers);
  if (ruleValidation.errors.length) throw new ConfigError(ruleValidation.errors);
  const notes: string[] = ruleValidation.warnings.map((w) => `${w.path}: ${w.message}`);
  const progress = options.onProgress ?? (() => undefined);
  const cache = config.cache ? options.cache : undefined;
  let cacheHits = 0;
  let cacheMisses = 0;
  const skipped = [...(options.skipped ?? [])];

  const files = options.files;
  const paths = files.map((f) => f.path);
  const pathSet = new Set(paths);
  const stylesheetFiles = files.filter((f) => isStylesheetPath(f.path));
  for (const f of files) {
    const ext = extname(f.path).slice(1);
    if ((UNSUPPORTED_STYLESHEET_EXTENSIONS as readonly string[]).includes(ext)) {
      skipped.push({ file: f.path, reason: `.${ext} stylesheets are not supported yet; analyse the compiled CSS instead` });
    }
  }

  /* 1. Parse stylesheets ------------------------------------------------- */
  const models: StylesheetModel[] = [];
  const parseOne = (path: string, content: string, opts: Parameters<typeof parseStylesheet>[2] = {}) => {
    const key = `css:${STYLESHEET_MODEL_VERSION}:${path}:${content.length}:${hashString(content)}:${opts.lineOffset ?? 1}`;
    const hit = cache?.get(key) as StylesheetModel | undefined;
    if (hit && hit.version === STYLESHEET_MODEL_VERSION) {
      cacheHits++;
      models.push(hit);
      return;
    }
    cacheMisses++;
    const model = parseStylesheet(path, content, opts);
    cache?.set(key, model);
    models.push(model);
  };
  stylesheetFiles.forEach((f, i) => {
    progress({ phase: 'parse', current: i + 1, total: stylesheetFiles.length, detail: f.path });
    parseOne(f.path, f.content, { syntax: detectSyntax(f.path) });
  });

  /* 2. Detect frameworks and extract references -------------------------- */
  const tailwindDirectives = new Set<string>();
  for (const m of models) for (const d of m.record.tailwindDirectives) tailwindDirectives.add(d);
  const detectionInput: DetectionInput = { paths, dependencies: packageDependencies(files), tailwindDirectives };
  const { active, reasons } = selectAdapters(options.adapters ?? [], config, detectionInput);
  for (const r of reasons) notes.push(`framework ${r}`);
  const adapterContext: AdapterContext = { config, fileExists: (p) => pathSet.has(p), paths };
  const extractors = new Map<string, FrameworkAdapter>();
  for (const adapter of active) {
    if (!adapter.extract) continue;
    for (const ext of adapter.extensions) {
      const current = extractors.get(ext);
      if (!current || adapter.priority > current.priority) extractors.set(ext, adapter);
    }
  }
  const tokenScanExts = new Set(config.tokenScanExtensions.map((e) => e.toLowerCase()));
  const references = emptyProjectReferences();
  const sourceFiles = files.filter((f) => !isStylesheetPath(f.path));
  let extracted = 0;
  for (const file of sourceFiles) {
    const ext = extname(file.path).slice(1);
    const adapter = extractors.get(ext);
    if (!adapter && !tokenScanExts.has(ext)) continue;
    extracted++;
    progress({ phase: 'extract', current: extracted, total: sourceFiles.length, detail: file.path });
    let refs: FileReferences;
    if (adapter) {
      const key = `ref:${adapter.id}:${adapter.version}:${config.cssModules.localsConvention}:${file.path}:${file.content.length}:${hashString(file.content)}`;
      const hit = cache?.get(key) as FileReferences | undefined;
      if (hit) {
        cacheHits++;
        refs = hit;
      } else {
        cacheMisses++;
        refs = adapter.extract!(file, adapterContext);
        cache?.set(key, refs);
      }
    } else {
      refs = tokenScan(file);
    }
    for (const embedded of refs.embeddedStylesheets) {
      parseOne(embedded.path, embedded.content, { lineOffset: embedded.lineOffset, embeddedIn: file.path, syntax: 'css' });
    }
    for (const note of refs.notes) notes.push(`${file.path}: ${note}`);
    mergeFileReferences(references, refs);
  }

  /* 3. Build the project model ------------------------------------------ */
  const project = buildProjectModel(models, references.stylesheetImports);
  for (const ref of project.cssReferences) {
    const occurrence = { file: ref.file, line: ref.line, column: ref.column, via: `css-${ref.via}` };
    if (ref.via === 'composes' && ref.from !== 'global') {
      const target = ref.from ? resolveRelative(ref.file, ref.from) : ref.file;
      if (target) {
        references.cssModules.push({ module: target, importer: ref.file, line: ref.line, accessed: [ref.name], dynamicPrefixes: [], escaped: false });
        continue;
      }
    }
    const list = references.classes.get(ref.name);
    if (!list) references.classes.set(ref.name, [occurrence]);
    else if (list.length < 25) list.push(occurrence);
  }
  for (const adapter of active) {
    adapter.projectHook?.({ ...adapterContext, files, project, references, note: (m) => notes.push(m) });
  }

  /* 4. Run analyzers ------------------------------------------------------ */
  const safelist = createSafelist(config.safelist);
  const ruleOwner = new Map<string, Analyzer>();
  for (const analyzer of options.analyzers) for (const r of analyzer.rules) ruleOwner.set(r.id, analyzer);
  const ruleCache = new Map<string, ReturnType<AnalyzerContext['rule']>>();
  const context: AnalyzerContext = {
    config,
    project,
    references,
    safelist,
    rule<T extends Record<string, unknown>>(id: string) {
      let resolved = ruleCache.get(id);
      if (!resolved) {
        const setting = ruleSetting(config, id);
        const meta = ruleOwner.get(id)?.rules.find((r) => r.id === id);
        let opts: Record<string, unknown> = setting.options;
        if (meta?.optionsSchema) {
          const parsed = meta.optionsSchema.safeParse(setting.options);
          if (parsed.success) opts = parsed.data as Record<string, unknown>;
        }
        resolved = { ...setting, options: opts };
        ruleCache.set(id, resolved);
      }
      return resolved as ReturnType<AnalyzerContext['rule']> & { options: T };
    },
    isRuleEnabled(id: string) {
      return ruleSetting(config, id).enabled;
    },
    note(message: string) {
      notes.push(message);
    },
  };

  const enabledAnalyzers = options.analyzers.filter((a) => config.analysis[a.configKey]);
  const drafts: { draft: FindingDraft; analyzer: Analyzer }[] = [];
  enabledAnalyzers.forEach((analyzer, i) => {
    progress({ phase: 'analyze', current: i + 1, total: enabledAnalyzers.length, detail: analyzer.id });
    for (const draft of analyzer.run(context)) {
      if (!context.isRuleEnabled(draft.rule)) continue;
      drafts.push({ draft, analyzer });
    }
  });
  for (const m of models) {
    for (const issue of m.record.parseIssues) {
      if (!context.isRuleEnabled('parse-error')) break;
      drafts.push({
        analyzer: PARSE_ANALYZER,
        draft: {
          rule: 'parse-error',
          severity: issue.kind === 'fatal' ? 'high' : 'medium',
          baseConfidence: 0.95,
          title: issue.kind === 'fatal' ? 'Stylesheet could not be parsed' : 'Invalid CSS was recovered',
          description:
            issue.kind === 'fatal'
              ? `The stylesheet could not be parsed: ${issue.message}. It was excluded from analysis.`
              : `The CSS parser reported "${issue.message}". A tolerant parser recovered the rest of the file, so results for this file may be incomplete.`,
          file: issue.file,
          line: issue.line,
          column: issue.column,
          evidence: [{ kind: 'note', message: issue.message, file: issue.file, line: issue.line, column: issue.column }],
          suggestion: 'Fix the syntax error so browsers and tools interpret the stylesheet consistently.',
        },
      });
    }
  }

  /* 5. Finalise findings ------------------------------------------------- */
  progress({ phase: 'report', current: 1, total: 1 });
  const minConfidence = confidenceRank(config.minConfidence);
  let findings: Finding[] = [];
  const fingerprints = new Map<string, number>();
  for (const { draft, analyzer } of drafts) {
    const setting = context.rule(draft.rule);
    const { score, level } = scoreConfidence(draft.baseConfidence, draft.confidenceFactors);
    if (confidenceRank(level) < minConfidence) continue;
    const baseFingerprint = hashString(
      [draft.rule, draft.file, draft.selector ?? '', draft.property ?? '', draft.value ?? '', draft.title].join('\u0000'),
    );
    const seen = fingerprints.get(baseFingerprint) ?? 0;
    fingerprints.set(baseFingerprint, seen + 1);
    const finding: Finding = {
      id: '',
      fingerprint: seen ? `${baseFingerprint}-${seen}` : baseFingerprint,
      rule: draft.rule,
      analyzer: analyzer.id,
      severity: setting.severity ?? draft.severity,
      confidence: level,
      confidenceScore: score,
      confidenceFactors: draft.confidenceFactors ?? [],
      title: draft.title,
      description: draft.description,
      file: draft.file,
      line: draft.line,
      column: draft.column ?? 1,
      evidence: draft.evidence,
      suggestion: draft.suggestion,
      approximate: draft.approximate ?? false,
    };
    if (draft.selector !== undefined) finding.selector = draft.selector;
    if (draft.property !== undefined) finding.property = draft.property;
    if (draft.value !== undefined) finding.value = draft.value;
    if (draft.data !== undefined) finding.data = draft.data;
    findings.push(finding);
  }
  findings = findings.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column || a.rule.localeCompare(b.rule) || a.fingerprint.localeCompare(b.fingerprint),
  );
  const width = Math.max(4, String(findings.length).length);
  findings.forEach((f, i) => {
    f.id = `CSSA-${String(i + 1).padStart(width, '0')}`;
  });

  const summary = summarise(findings, project.stylesheets.length, references.sourceFileCount, project);
  const now = options.now ? options.now() : new Date();
  return {
    meta: {
      tool: 'css-archaeology',
      version: VERSION,
      schemaVersion: 1,
      generatedAt: now.toISOString(),
      root: options.root ?? '.',
      durationMs: options.now ? 0 : Date.now() - started,
      frameworks: active.map((a) => a.id),
      analyzers: enabledAnalyzers.map((a) => a.id),
      filesDiscovered: options.filesDiscovered ?? files.length,
      filesSkipped: skipped,
      ...(cache ? { cache: { hits: cacheHits, misses: cacheMisses } } : {}),
      notes,
    },
    summary,
    metrics: computeMetrics(project),
    findings,
    stylesheets: summariseStylesheets(project, findings),
    selectors: summariseSelectors(project, findings),
    tokens: summariseTokens(project),
    parseIssues: project.stylesheets.flatMap((s) => s.parseIssues),
  };
}

const PARSE_ANALYZER: Analyzer = {
  id: 'parser',
  configKey: 'complexity',
  title: 'Parser',
  description: 'Reports CSS that the parser had to recover from.',
  rules: [],
  run: () => [],
};

export const CORE_RULES = [
  {
    id: 'parse-error',
    title: 'Invalid CSS',
    description: 'A stylesheet contains syntax the CSS parser could not read without recovery.',
    defaultSeverity: 'medium' as const,
  },
];

function summarise(findings: Finding[], stylesheets: number, sourceFiles: number, project: ReturnType<typeof buildProjectModel>): AnalysisSummary {
  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as AnalysisSummary['bySeverity'];
  const byConfidence = Object.fromEntries(CONFIDENCES.map((c) => [c, 0])) as AnalysisSummary['byConfidence'];
  const byRule: Record<string, number> = {};
  const byAnalyzer: Record<string, number> = {};
  for (const f of findings) {
    bySeverity[f.severity]++;
    byConfidence[f.confidence]++;
    byRule[f.rule] = (byRule[f.rule] ?? 0) + 1;
    byAnalyzer[f.analyzer] = (byAnalyzer[f.analyzer] ?? 0) + 1;
  }
  let selectors = 0;
  for (const r of project.rules) selectors += r.selectors.length;
  return {
    stylesheets,
    sourceFiles,
    selectors,
    declarations: project.declarations.length,
    findings: findings.length,
    bySeverity,
    byConfidence,
    byRule,
    byAnalyzer,
    potentiallyUnusedSelectors: byRule['unused-selector'] ?? 0,
    duplicateDeclarations: byRule['duplicate-declaration'] ?? 0,
    specificityConflicts: (byRule['specificity-conflict'] ?? 0) + (byRule['conflicting-declaration'] ?? 0),
    overriddenDeclarations: byRule['overridden-declaration'] ?? 0,
  };
}
