import { formatSpecificity, type AnalysisResult, type Finding, type RuleMeta } from '@css-archaeology/core';

const useColor = () => process.stdout.isTTY === true && !process.env.NO_COLOR && process.env.TERM !== 'dumb';

const codes = { bold: [1, 22], dim: [2, 22], red: [31, 39], yellow: [33, 39], blue: [34, 39], gray: [90, 39] } as const;
type Style = keyof typeof codes;

export function paint(text: string, ...styles: Style[]): string {
  if (!useColor()) return text;
  return styles.reduce((t, s) => `\u001b[${codes[s][0]}m${t}\u001b[${codes[s][1]}m`, text);
}

const SEVERITY_STYLE: Record<Finding['severity'], Style> = { high: 'red', medium: 'yellow', low: 'blue', info: 'gray' };

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

export function formatFindingLine(f: Finding): string {
  return [
    paint(pad(f.id, 10), 'bold'),
    paint(pad(f.severity, 7), SEVERITY_STYLE[f.severity]),
    pad(`${f.confidence} conf.`, 12),
    paint(pad(`${f.file}:${f.line}`, 36), 'dim'),
    f.title,
  ].join(' ');
}

export function formatSummary(result: AnalysisResult, shown: Finding[], limit: number): string {
  const { summary, metrics, meta } = result;
  const lines: string[] = [];
  lines.push(paint('CSS Archaeology', 'bold') + paint(` v${meta.version} · ${meta.root}`, 'dim'));
  lines.push('');
  lines.push(`  Stylesheets       ${summary.stylesheets} (${(metrics.totalBytes / 1024).toFixed(1)} KB, ${metrics.totalLines} lines)`);
  lines.push(`  Source files      ${summary.sourceFiles}`);
  lines.push(`  Selectors         ${summary.selectors} (${metrics.uniqueSelectors} unique)`);
  lines.push(`  Declarations      ${summary.declarations}`);
  lines.push(`  Frameworks        ${meta.frameworks.join(', ') || 'none detected'}`);
  lines.push('');
  lines.push(`  Potentially unused selectors   ${summary.potentiallyUnusedSelectors}`);
  lines.push(`  Duplicate declarations         ${summary.duplicateDeclarations}`);
  lines.push(`  Specificity conflicts          ${summary.specificityConflicts}`);
  lines.push(`  Overridden declarations        ${summary.overriddenDeclarations}`);
  lines.push('');
  const sev = summary.bySeverity;
  lines.push(
    `  Findings: ${summary.findings} total · ${paint(`${sev.high} high`, 'red')} · ${paint(`${sev.medium} medium`, 'yellow')} · ${paint(`${sev.low} low`, 'blue')} · ${sev.info} info`,
  );
  if (shown.length !== summary.findings) lines.push(`  ${shown.length} finding(s) match the current filters.`);
  if (shown.length) {
    lines.push('');
    const ranked = [...shown].sort((a, b) => sevRank(b) - sevRank(a) || a.file.localeCompare(b.file) || a.line - b.line);
    for (const f of ranked.slice(0, limit)) lines.push('  ' + formatFindingLine(f));
    if (ranked.length > limit) lines.push(paint(`  … ${ranked.length - limit} more. Use --limit or open the HTML report.`, 'dim'));
  }
  if (meta.filesSkipped.length) lines.push('', paint(`  ${meta.filesSkipped.length} file(s) skipped (see report meta.filesSkipped).`, 'dim'));
  if (meta.cache) lines.push(paint(`  Cache: ${meta.cache.hits} reused, ${meta.cache.misses} parsed · ${meta.durationMs} ms`, 'dim'));
  else lines.push(paint(`  ${meta.durationMs} ms`, 'dim'));
  return lines.join('\n') + '\n';
}

function sevRank(f: Finding): number {
  return ['info', 'low', 'medium', 'high'].indexOf(f.severity);
}

export function formatExplain(f: Finding, meta: (RuleMeta & { analyzer: string }) | undefined): string {
  const lines: string[] = [];
  lines.push(paint(`${f.id}  ${f.title}`, 'bold'));
  lines.push('');
  lines.push(`  Rule        ${f.rule} (${f.analyzer})`);
  lines.push(`  Severity    ${paint(f.severity, SEVERITY_STYLE[f.severity])}`);
  lines.push(`  Confidence  ${f.confidence} (${f.confidenceScore.toFixed(2)})${f.approximate ? ' · approximate cascade evaluation' : ''}`);
  lines.push(`  Location    ${f.file}:${f.line}:${f.column}`);
  if (f.selector) lines.push(`  Selector    ${f.selector}`);
  if (f.property) lines.push(`  Property    ${f.property}${f.value ? `: ${f.value}` : ''}`);
  lines.push('', `  ${f.description}`, '');
  lines.push(paint('  Evidence', 'bold'));
  for (const e of f.evidence) {
    const where = e.file ? paint(` ${e.file}${e.line ? `:${e.line}` : ''}`, 'dim') : '';
    lines.push(`   - ${e.message}${e.snippet ? `  ${paint(e.snippet, 'blue')}` : ''}${where}`);
  }
  if (f.confidenceFactors.length) {
    lines.push('', paint('  Confidence factors', 'bold'));
    for (const c of f.confidenceFactors) lines.push(`   ${c.effect >= 0 ? '+' : ''}${c.effect.toFixed(2)}  ${c.detail}`);
  }
  lines.push('', paint('  Suggestion', 'bold'), `   ${f.suggestion}`);
  if (meta?.rationale) lines.push('', paint('  About this rule', 'bold'), `   ${meta.rationale}`);
  if (f.data && 'specificity' in f.data && Array.isArray(f.data.specificity)) {
    lines.push('', `   Specificity ${formatSpecificity(f.data.specificity as [number, number, number])}`);
  }
  return lines.join('\n') + '\n';
}

export function formatRuleList(rules: (RuleMeta & { analyzer: string })[]): string {
  const lines = [paint('Rules', 'bold'), ''];
  let current = '';
  for (const r of rules) {
    if (r.analyzer !== current) {
      current = r.analyzer;
      lines.push(paint(`  ${current}`, 'bold'));
    }
    lines.push(`    ${pad(r.id, 30)} ${pad(r.defaultSeverity, 7)} ${r.description}`);
  }
  return lines.join('\n') + '\n';
}
