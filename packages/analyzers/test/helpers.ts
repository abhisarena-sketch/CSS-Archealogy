import { analyzeProject, emptyFileReferences, addReference, type FrameworkAdapter, type CssArchaeologyConfigInput, type Finding } from '@css-archaeology/core';
import { defaultAnalyzers } from '../src/index.js';

/** Minimal test adapter: reads class="", id="" and tag names from .html files with regexes. */
export const regexHtmlAdapter: FrameworkAdapter = {
  id: 'test-html',
  title: 'Test HTML',
  version: 1,
  extensions: ['html'],
  priority: 1,
  detect: () => ({ detected: true, reason: 'test' }),
  extract(file) {
    const refs = emptyFileReferences(file.path, 'test-html');
    const occ = { file: file.path, line: 1, column: 1, via: 'test' };
    for (const m of file.content.matchAll(/class="([^"]*)"/g)) for (const c of m[1]!.split(/\s+/).filter(Boolean)) addReference(refs.classes, c, occ);
    for (const m of file.content.matchAll(/id="([^"]*)"/g)) addReference(refs.ids, m[1]!, occ);
    for (const m of file.content.matchAll(/<([a-z][a-z0-9-]*)/g)) addReference(refs.elements, m[1]!, occ);
    for (const m of file.content.matchAll(/\s([a-z-]+)=/g)) addReference(refs.attributes, m[1]!, occ);
    return refs;
  },
};

export async function scan(files: Record<string, string>, config: CssArchaeologyConfigInput = {}) {
  return analyzeProject({
    files: Object.entries(files).map(([path, content]) => ({ path, content })),
    analyzers: defaultAnalyzers,
    adapters: [regexHtmlAdapter],
    config,
    now: () => new Date(0),
  });
}

export function byRule(findings: Finding[], rule: string) {
  return findings.filter((f) => f.rule === rule);
}
