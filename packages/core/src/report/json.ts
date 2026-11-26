import { reportSchema } from './schema.js';
import type { AnalysisResult } from '../types.js';

export interface JsonReportOptions {
  /** Omit the selector and token inventories to keep large reports small. */
  inventory?: boolean;
  pretty?: boolean;
}

export function toJsonReport(result: AnalysisResult, options: JsonReportOptions = {}): string {
  const data: AnalysisResult = options.inventory === false ? { ...result, selectors: [], tokens: [] } : result;
  return JSON.stringify(data, null, options.pretty === false ? undefined : 2) + '\n';
}

export type ParsedReport = { ok: true; report: AnalysisResult } | { ok: false; error: string };

/** Parse and validate a JSON report produced by `toJsonReport`. */
export function parseJsonReport(text: string): ParsedReport {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `Report is not valid JSON: ${(error as Error).message}` };
  }
  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: `Report does not match the CSS Archaeology schema at ${first?.path.join('.') || '(root)'}: ${first?.message}` };
  }
  return { ok: true, report: parsed.data as AnalysisResult };
}
