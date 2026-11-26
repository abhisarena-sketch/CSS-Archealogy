import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  CONFIDENCES,
  ConfigError,
  DEFAULT_CONFIG_FILE,
  FRAMEWORKS,
  SEVERITIES,
  VERSION,
  confidenceRank,
  parseJsonReport,
  severityRank,
  starterConfig,
  toHtmlReport,
  toJsonReport,
  validateRuleSettings,
  type AnalysisResult,
  type Confidence,
  type CssArchaeologyConfig,
  type Finding,
  type Framework,
  type Severity,
} from '@css-archaeology/core';
import { ConfigFileError, loadConfig } from '@css-archaeology/core/node';
import { allRules, defaultAnalyzers } from '@css-archaeology/analyzers';
import { scanProject } from './scan.js';
import { formatExplain, formatRuleList, formatSummary, paint } from './text.js';

export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd: string;
  /** Whether stderr is interactive (enables progress updates). */
  interactive?: boolean;
}

export const EXIT = { ok: 0, findings: 1, usage: 2, error: 3 } as const;

const HELP = `CSS Archaeology ${VERSION} by Workfonic Labs
Understand your CSS. Find what is hiding beneath it.

Usage
  css-archaeology init [--framework <name>] [--force]
  css-archaeology scan [path] [options]
  css-archaeology report [--format html|json|text] [--input <report.json>]
  css-archaeology explain <CSSA-0001 | rule-id> [--input <report.json>]
  css-archaeology explain --rules
  css-archaeology config validate [--config <file>]

Scan options
  --format <list>        Output format: text (default), json (to stdout), html. Repeatable or comma separated.
  --rule <id>            Only run/show these rules or analyzers (e.g. unused-selectors, duplicate-declaration).
  --severity <level>     Minimum severity to show: info, low, medium, high.
  --confidence <level>   Minimum confidence to show: low, medium, high.
  --exclude <glob>       Additional exclude pattern (repeatable).
  --include <glob>       Replace include patterns (repeatable).
  --framework <name>     auto, html, react, next, css-modules, tailwind (repeatable).
  --config <file>        Configuration file (default: css-archaeology.config.json).
  --output <dir>         Report directory (default: .css-archaeology).
  --fail-on <level>      Exit with code 1 when a shown finding is at or above this severity, or "none".
  --limit <n>            Findings listed in the text summary (default 20).
  --no-cache             Disable the incremental cache.
  --quiet                No progress output.

Exit codes: 0 success, 1 findings at or above --fail-on, 2 usage or configuration error, 3 unexpected error.
CSS Archaeology never modifies source files. It only writes reports and its cache to the output directory.
`;

function list(values: string[] | undefined): string[] {
  return (values ?? []).flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], flag: string): T | undefined {
  if (value === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(value)) throw new UsageError(`${flag} must be one of: ${allowed.join(', ')} (got "${value}")`);
  return value as T;
}

class UsageError extends Error {}

function printConfigIssues(io: CliIO, error: ConfigFileError | ConfigError) {
  io.stderr(`${paint('Configuration error', 'red', 'bold')}: ${error.message.split('\n')[0]}\n`);
  for (const issue of error.issues) io.stderr(`  - ${issue.path}: ${issue.message}\n`);
}

/** Map `--rule` values (rule ids or analyzer ids) to the analyzers that must run and the rules to show. */
export function resolveRuleFilter(values: string[]): { analyzers: Set<string>; rules: Set<string> } {
  const rules = new Set<string>();
  const analyzers = new Set<string>();
  const metas = allRules();
  for (const v of values) {
    const analyzer = defaultAnalyzers.find((a) => a.id === v || a.configKey === v);
    if (analyzer) {
      analyzers.add(analyzer.id);
      for (const r of analyzer.rules) rules.add(r.id);
      continue;
    }
    const meta = metas.find((r) => r.id === v);
    if (!meta) throw new UsageError(`Unknown rule or analyzer "${v}". Run \`css-archaeology explain --rules\` to list them.`);
    rules.add(meta.id);
    analyzers.add(meta.analyzer);
  }
  return { analyzers, rules };
}

export function filterFindings(findings: Finding[], opts: { rules?: Set<string>; severity?: Severity; confidence?: Confidence }): Finding[] {
  return findings.filter(
    (f) =>
      (!opts.rules || opts.rules.size === 0 || opts.rules.has(f.rule)) &&
      (!opts.severity || severityRank(f.severity) >= severityRank(opts.severity)) &&
      (!opts.confidence || confidenceRank(f.confidence) >= confidenceRank(opts.confidence)),
  );
}

async function readReport(io: CliIO, input: string | undefined, config?: CssArchaeologyConfig): Promise<AnalysisResult | null> {
  const file = path.resolve(io.cwd, input ?? path.join(config?.outputDir ?? '.css-archaeology', 'report.json'));
  if (!existsSync(file)) {
    io.stderr(`No report found at ${file}. Run \`css-archaeology scan\` first.\n`);
    return null;
  }
  const parsed = parseJsonReport(await readFile(file, 'utf8'));
  if (!parsed.ok) {
    io.stderr(`${parsed.error}\n`);
    return null;
  }
  return parsed.report;
}

async function cmdInit(args: string[], io: CliIO): Promise<number> {
  const { values } = parseArgs({ args, options: { framework: { type: 'string' }, force: { type: 'boolean' } }, allowPositionals: false });
  const framework = oneOf(values.framework, FRAMEWORKS, '--framework') ?? 'auto';
  const file = path.join(io.cwd, DEFAULT_CONFIG_FILE);
  if (existsSync(file) && !values.force) {
    io.stderr(`${DEFAULT_CONFIG_FILE} already exists. Use --force to overwrite it.\n`);
    return EXIT.usage;
  }
  await writeFile(file, JSON.stringify(starterConfig(framework as Framework), null, 2) + '\n');
  io.stdout(`Created ${DEFAULT_CONFIG_FILE}. Run \`css-archaeology scan\` to analyse the project.\n`);
  return EXIT.ok;
}

async function cmdScan(args: string[], io: CliIO): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      format: { type: 'string', multiple: true },
      rule: { type: 'string', multiple: true },
      severity: { type: 'string' },
      confidence: { type: 'string' },
      exclude: { type: 'string', multiple: true },
      include: { type: 'string', multiple: true },
      framework: { type: 'string', multiple: true },
      config: { type: 'string' },
      output: { type: 'string' },
      'fail-on': { type: 'string' },
      limit: { type: 'string' },
      'no-cache': { type: 'boolean' },
      quiet: { type: 'boolean' },
    },
  });
  if (positionals.length > 1) throw new UsageError('scan accepts at most one path');
  const root = path.resolve(io.cwd, positionals[0] ?? '.');
  if (!existsSync(root)) throw new UsageError(`Path not found: ${root}`);
  const formats = list(values.format);
  for (const f of formats) oneOf(f, ['text', 'json', 'html'] as const, '--format');
  const severity = oneOf(values.severity, SEVERITIES, '--severity');
  const confidence = oneOf(values.confidence, CONFIDENCES, '--confidence');
  const failOnFlag = oneOf(values['fail-on'], [...SEVERITIES, 'none'] as const, '--fail-on');
  const frameworks = list(values.framework).map((f) => oneOf(f, FRAMEWORKS, '--framework')!);
  const limit = values.limit ? Number(values.limit) : 20;
  if (!Number.isInteger(limit) || limit < 0) throw new UsageError('--limit must be a non-negative integer');
  const ruleFilter = values.rule ? resolveRuleFilter(list(values.rule)) : null;

  const loaded = await loadConfig(root, values.config ? path.resolve(io.cwd, values.config) : undefined);
  const config = loaded.config;
  const overrides: Partial<CssArchaeologyConfig> = {};
  if (values.exclude) overrides.exclude = [...config.exclude, ...list(values.exclude)];
  if (values.include) overrides.include = list(values.include);
  if (frameworks.length) overrides.framework = frameworks;
  if (values.output) overrides.outputDir = values.output;
  if (ruleFilter) {
    overrides.analysis = { ...config.analysis };
    for (const a of defaultAnalyzers) overrides.analysis[a.configKey] = config.analysis[a.configKey] && ruleFilter.analyzers.has(a.id);
  }
  for (const w of loaded.warnings) io.stderr(`warning: ${w.path}: ${w.message}\n`);

  const quiet = values.quiet === true;
  let lastPhase = '';
  const started = Date.now();
  const outcome = await scanProject({
    root,
    ...(values.config ? { configPath: path.resolve(io.cwd, values.config) } : {}),
    overrides,
    useCache: !values['no-cache'],
    onProgress: quiet
      ? undefined
      : (e) => {
          if (io.interactive && 'detail' in e && e.total > 0) {
            io.stderr(`\r\u001b[2K${e.phase} ${e.current}/${e.total} ${String(e.detail ?? '').slice(-60)}`);
          } else if (e.phase !== lastPhase) {
            const label = { discover: 'Discovering files', parse: 'Parsing stylesheets', extract: 'Extracting references', analyze: 'Running analyzers', report: 'Building report' }[e.phase];
            io.stderr(`${io.interactive ? '\r\u001b[2K' : ''}${label}…${io.interactive ? '' : '\n'}`);
          }
          lastPhase = e.phase;
        },
  });
  if (!quiet && io.interactive) io.stderr('\r\u001b[2K');
  const result = outcome.result;
  const effective = outcome.config;

  const shown = filterFindings(result.findings, {
    ...(ruleFilter ? { rules: ruleFilter.rules } : {}),
    ...(severity ? { severity } : {}),
    ...(confidence ? { confidence } : {}),
  });
  const filtered: AnalysisResult = shown.length === result.findings.length ? result : { ...result, findings: shown };

  // Reports go to the output directory only; source files are never touched.
  const outDir = path.resolve(root, effective.outputDir);
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'report.json'), toJsonReport(filtered));
  const written: string[] = [path.join(outDir, 'report.json')];
  const wantHtml = formats.includes('html') || (formats.length === 0 && effective.reportFormat.includes('html'));
  if (wantHtml) {
    await writeFile(path.join(outDir, 'report.html'), toHtmlReport(filtered));
    written.push(path.join(outDir, 'report.html'));
  }

  if (formats.includes('json')) io.stdout(toJsonReport(filtered));
  if (formats.length === 0 || formats.includes('text')) io.stdout(formatSummary(result, shown, limit));
  const log = formats.includes('json') ? io.stderr : io.stdout;
  if (!quiet) log(paint(`Reports: ${written.map((w) => path.relative(io.cwd, w) || w).join(', ')} (${Date.now() - started} ms)\n`, 'dim'));

  const failOn = failOnFlag ?? effective.failOn;
  if (failOn !== 'none' && shown.some((f) => severityRank(f.severity) >= severityRank(failOn))) {
    if (!quiet) log(`Failing because ${shown.filter((f) => severityRank(f.severity) >= severityRank(failOn)).length} finding(s) are at or above "${failOn}" severity.\n`);
    return EXIT.findings;
  }
  return EXIT.ok;
}

async function cmdReport(args: string[], io: CliIO): Promise<number> {
  const { values } = parseArgs({ args, options: { format: { type: 'string' }, input: { type: 'string' }, output: { type: 'string' }, config: { type: 'string' } } });
  const format = oneOf(values.format, ['html', 'json', 'text'] as const, '--format') ?? 'html';
  const loaded = await loadConfig(io.cwd, values.config);
  const report = await readReport(io, values.input, loaded.config);
  if (!report) return EXIT.usage;
  if (format === 'json') io.stdout(toJsonReport(report));
  else if (format === 'text') io.stdout(formatSummary(report, report.findings, 50));
  else {
    const out = path.resolve(io.cwd, values.output ?? path.join(loaded.config.outputDir, 'report.html'));
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, toHtmlReport(report));
    io.stdout(`Wrote ${path.relative(io.cwd, out) || out}\n`);
  }
  return EXIT.ok;
}

async function cmdExplain(args: string[], io: CliIO): Promise<number> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { input: { type: 'string' }, rules: { type: 'boolean' }, config: { type: 'string' } } });
  const rules = allRules();
  if (values.rules) {
    io.stdout(formatRuleList(rules));
    return EXIT.ok;
  }
  const target = positionals[0];
  if (!target) throw new UsageError('explain needs a finding id (CSSA-0001) or a rule id');
  const rule = rules.find((r) => r.id === target);
  if (rule && !/^CSSA-/i.test(target)) {
    io.stdout(`${paint(rule.id, 'bold')} (${rule.analyzer}) · default severity ${rule.defaultSeverity}\n\n  ${rule.description}\n\n  ${rule.rationale ?? ''}\n`);
    return EXIT.ok;
  }
  const loaded = await loadConfig(io.cwd, values.config);
  const report = await readReport(io, values.input, loaded.config);
  if (!report) return EXIT.usage;
  const finding = report.findings.find((f) => f.id.toUpperCase() === target.toUpperCase() || f.fingerprint === target);
  if (!finding) {
    io.stderr(`No finding ${target} in the last report (${report.findings.length} findings). IDs are assigned per scan.\n`);
    return EXIT.usage;
  }
  io.stdout(formatExplain(finding, rules.find((r) => r.id === finding.rule)));
  return EXIT.ok;
}

async function cmdConfig(args: string[], io: CliIO): Promise<number> {
  const [sub, ...rest] = args;
  if (sub !== 'validate') throw new UsageError('Usage: css-archaeology config validate [--config <file>]');
  const { values } = parseArgs({ args: rest, options: { config: { type: 'string' } } });
  const loaded = await loadConfig(io.cwd, values.config);
  const { errors, warnings } = validateRuleSettings(loaded.config, defaultAnalyzers);
  for (const w of [...loaded.warnings, ...warnings]) io.stderr(`warning: ${w.path}: ${w.message}\n`);
  if (errors.length) {
    printConfigIssues(io, new ConfigError(errors));
    return EXIT.usage;
  }
  io.stdout(loaded.path ? `${path.relative(io.cwd, loaded.path) || loaded.path} is valid.\n` : `No configuration file found; defaults are valid. Run \`css-archaeology init\` to create one.\n`);
  return EXIT.ok;
}

export async function run(argv: string[], io: CliIO): Promise<number> {
  const [command, ...args] = argv;
  try {
    if (command && !command.startsWith('-') && (args.includes('--help') || args.includes('-h'))) {
      io.stdout(HELP);
      return EXIT.ok;
    }
    switch (command) {
      case undefined:
      case 'help':
      case '--help':
      case '-h':
        io.stdout(HELP);
        return EXIT.ok;
      case '--version':
      case '-v':
      case 'version':
        io.stdout(`${VERSION}\n`);
        return EXIT.ok;
      case 'init':
        return await cmdInit(args, io);
      case 'scan':
        return await cmdScan(args, io);
      case 'report':
        return await cmdReport(args, io);
      case 'explain':
        return await cmdExplain(args, io);
      case 'config':
        return await cmdConfig(args, io);
      default:
        io.stderr(`Unknown command "${command}".\n\n${HELP}`);
        return EXIT.usage;
    }
  } catch (error) {
    if (error instanceof ConfigFileError || error instanceof ConfigError) {
      printConfigIssues(io, error);
      return EXIT.usage;
    }
    if (error instanceof UsageError || (error as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) {
      io.stderr(`${(error as Error).message}\nRun \`css-archaeology --help\` for usage.\n`);
      return EXIT.usage;
    }
    io.stderr(`Unexpected error: ${(error as Error).stack ?? String(error)}\n`);
    return EXIT.error;
  }
}
