/// <reference lib="webworker" />
import { analyzeProject, toHtmlReport, toJsonReport, type AnalysisResult } from '@css-archaeology/core';
import { defaultAnalyzers } from '@css-archaeology/analyzers';
import { defaultAdapters } from '@css-archaeology/framework-adapters';
import type { ProjectFile } from './zip';

export type WorkerRequest = { type: 'analyze'; files: ProjectFile[]; skipped: { file: string; reason: string }[]; name: string };
export type WorkerResponse =
  | { type: 'progress'; phase: string; current: number; total: number }
  | { type: 'result'; result: AnalysisResult; json: string; html: string }
  | { type: 'error'; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

// The worker has no network access by design: the engine never fetches anything,
// and the page CSP restricts connections to the playground's own origin.
ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type !== 'analyze') return;
  try {
    const result = await analyzeProject({
      files: msg.files,
      analyzers: defaultAnalyzers,
      adapters: defaultAdapters,
      root: msg.name,
      skipped: msg.skipped,
      config: { cache: false },
      onProgress: (p) => ctx.postMessage({ type: 'progress', phase: p.phase, current: p.current, total: p.total } satisfies WorkerResponse),
    });
    ctx.postMessage({ type: 'result', result, json: toJsonReport(result), html: toHtmlReport(result) } satisfies WorkerResponse);
  } catch (error) {
    ctx.postMessage({ type: 'error', message: (error as Error).message } satisfies WorkerResponse);
  }
};
