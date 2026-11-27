import type { ProjectModel } from './project.js';
import { compareSpecificity, selectorComplexityScore } from './selectors.js';
import type { ComplexityMetrics, Finding, SelectorSummary, Specificity, StylesheetSummary } from './types.js';

const SIZE_BUCKETS: { label: string; min: number; max: number | null }[] = [
  { label: '< 10 KB', min: 0, max: 10_240 },
  { label: '10–50 KB', min: 10_240, max: 51_200 },
  { label: '50–100 KB', min: 51_200, max: 102_400 },
  { label: '100–250 KB', min: 102_400, max: 256_000 },
  { label: '≥ 250 KB', min: 256_000, max: null },
];

export function computeMetrics(project: ProjectModel): ComplexityMetrics {
  let totalBytes = 0;
  let totalLines = 0;
  for (const s of project.stylesheets) {
    totalBytes += s.bytes;
    totalLines += s.lines;
  }
  const uniqueSelectors = new Set<string>();
  let totalSelectors = 0;
  const complex: ComplexityMetrics['mostComplexSelectors'] = [];
  for (const rule of project.rules) {
    for (const part of rule.selectors) {
      totalSelectors++;
      uniqueSelectors.add(part.text);
      complex.push({
        selector: part.text,
        file: rule.file,
        line: rule.line,
        specificity: part.specificity,
        compounds: part.compounds,
        score: Math.round(selectorComplexityScore(part) * 10) / 10,
      });
    }
  }
  complex.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line);
  const seenComplex = new Set<string>();
  const mostComplexSelectors = complex.filter((c) => !seenComplex.has(c.selector) && seenComplex.add(c.selector)).slice(0, 10);

  let important = 0;
  let custom = 0;
  const pairCounts = new Map<string, number>();
  for (const d of project.declarations) {
    if (d.important) important++;
    if (d.custom) custom++;
    const key = `${d.prop}:${d.value}`;
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }
  let repeatedDeclarations = 0;
  for (const count of pairCounts.values()) if (count > 1) repeatedDeclarations += count - 1;

  const media = project.atRules.filter((a) => a.name === 'media');
  return {
    stylesheets: project.stylesheets.length,
    totalBytes,
    totalLines,
    totalRules: project.rules.length,
    totalSelectors,
    uniqueSelectors: uniqueSelectors.size,
    totalDeclarations: project.declarations.length,
    importantDeclarations: important,
    customProperties: custom,
    mediaQueries: media.length,
    uniqueMediaQueries: new Set(media.map((m) => m.params)).size,
    repeatedDeclarations,
    largestStylesheets: [...project.stylesheets]
      .sort((a, b) => b.bytes - a.bytes || a.file.localeCompare(b.file))
      .slice(0, 10)
      .map((s) => ({ file: s.file, bytes: s.bytes, lines: s.lines, rules: s.ruleCount })),
    mostComplexSelectors,
    sizeDistribution: SIZE_BUCKETS.map((b) => ({
      ...b,
      count: project.stylesheets.filter((s) => s.bytes >= b.min && (b.max === null || s.bytes < b.max)).length,
    })),
  };
}

export function summariseStylesheets(project: ProjectModel, findings: Finding[]): StylesheetSummary[] {
  const findingCounts = new Map<string, number>();
  for (const f of findings) findingCounts.set(f.file, (findingCounts.get(f.file) ?? 0) + 1);
  return project.stylesheets.map((s) => {
    const indexes = project.rulesByFile.get(s.file) ?? [];
    let max: Specificity = [0, 0, 0];
    const sum: Specificity = [0, 0, 0];
    let n = 0;
    for (const i of indexes) {
      for (const part of project.rules[i]!.selectors) {
        if (compareSpecificity(part.specificity, max) > 0) max = part.specificity;
        sum[0] += part.specificity[0];
        sum[1] += part.specificity[1];
        sum[2] += part.specificity[2];
        n++;
      }
    }
    const avg: Specificity = n ? [round(sum[0] / n), round(sum[1] / n), round(sum[2] / n)] : [0, 0, 0];
    const summary: StylesheetSummary = {
      file: s.file,
      syntax: s.syntax,
      bytes: s.bytes,
      lines: s.lines,
      rules: s.ruleCount,
      selectors: s.selectorCount,
      declarations: s.declarationCount,
      importantDeclarations: s.importantCount,
      maxNestingDepth: s.maxNestingDepth,
      averageSpecificity: avg,
      maxSpecificity: max,
      isModule: s.isModule,
      parseIssues: s.parseIssues.length,
      findings: findingCounts.get(s.file) ?? 0,
    };
    if (s.embeddedIn) summary.embeddedIn = s.embeddedIn;
    return summary;
  });
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function summariseSelectors(project: ProjectModel, findings: Finding[], maxLocations = 20): SelectorSummary[] {
  const map = new Map<string, SelectorSummary>();
  for (const rule of project.rules) {
    for (const part of rule.selectors) {
      let s = map.get(part.text);
      if (!s) {
        s = { selector: part.text, specificity: part.specificity, occurrences: 0, files: [], locations: [], findingIds: [] };
        map.set(part.text, s);
      }
      s.occurrences++;
      if (!s.files.includes(rule.file)) s.files.push(rule.file);
      if (s.locations.length < maxLocations) s.locations.push({ file: rule.file, line: rule.line, column: rule.column });
    }
  }
  for (const f of findings) {
    if (!f.selector) continue;
    for (const sel of f.selector.split(/\s*,\s*(?![^()]*\))/)) {
      const s = map.get(sel);
      if (s && !s.findingIds.includes(f.id)) s.findingIds.push(f.id);
    }
  }
  return [...map.values()].sort((a, b) => a.selector.localeCompare(b.selector));
}
