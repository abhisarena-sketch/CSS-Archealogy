import type { FrameworkAdapter } from '@css-archaeology/core';
import { extractFromScript } from './js-extractor.js';

export const SCRIPT_EXTENSIONS = ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts'];

/**
 * React (and plain JavaScript/TypeScript) adapter. Reads JSX className/class props,
 * class-name helpers (clsx, classnames, cn, cva, tailwind-merge), DOM APIs
 * (classList, querySelector, getElementById, createElement), CSS Module imports and
 * every string literal. Uses the TypeScript parser only; code is never executed.
 */
export const reactAdapter: FrameworkAdapter = {
  id: 'react',
  title: 'React',
  version: 3,
  extensions: SCRIPT_EXTENSIONS,
  priority: 10,
  detect(input) {
    if (input.dependencies.has('react') || input.dependencies.has('preact')) return { detected: true, reason: 'react dependency in package.json' };
    const jsx = input.paths.filter((p) => /\.(jsx|tsx)$/i.test(p)).length;
    if (jsx > 0) return { detected: true, reason: `${jsx} JSX/TSX file(s) found` };
    const scripts = input.paths.filter((p) => /\.(m|c)?[jt]s$/i.test(p) && !p.endsWith('.d.ts')).length;
    // Plain scripts are still parsed for DOM class usage.
    return { detected: scripts > 0, reason: `${scripts} script file(s) found (parsed for DOM class usage)` };
  },
  extract(file, context) {
    return extractFromScript(file, context, { adapter: 'react' });
  },
};
