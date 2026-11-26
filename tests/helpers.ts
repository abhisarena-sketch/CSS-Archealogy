import { fileURLToPath } from 'node:url';
import { scanProject } from '../packages/cli/src/scan.js';

export const examplesDir = fileURLToPath(new URL('../examples/', import.meta.url));

export async function scanExample(name: string, overrides = {}) {
  const { result } = await scanProject({ root: `${examplesDir}${name}`, useCache: false, overrides, now: () => new Date(0) });
  return result;
}

export function selectorsFor(result: Awaited<ReturnType<typeof scanExample>>, rule: string): string[] {
  return result.findings.filter((f) => f.rule === rule).map((f) => f.selector ?? '').sort();
}
