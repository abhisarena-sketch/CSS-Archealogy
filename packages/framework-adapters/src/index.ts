import type { FrameworkAdapter } from '@css-archaeology/core';
import { cssModulesAdapter } from './css-modules.js';
import { htmlAdapter } from './html.js';
import { nextAdapter } from './next.js';
import { reactAdapter } from './react.js';
import { tailwindAdapter } from './tailwind.js';

export { cssModulesAdapter, htmlAdapter, nextAdapter, reactAdapter, tailwindAdapter };
export { extractFromScript, resolveStyleImport, resolveHref } from './js-extractor.js';
export { extractFromHtml } from './html.js';
export { readTailwindSafelist, expandBraces } from './tailwind.js';
export { SCRIPT_EXTENSIONS } from './react.js';

/** Built-in adapters. Order does not matter; priority decides which extractor handles a file. */
export const defaultAdapters: FrameworkAdapter[] = [htmlAdapter, reactAdapter, nextAdapter, cssModulesAdapter, tailwindAdapter];

/** All extensions handled by the default adapters, for file discovery. */
export function adapterExtensions(adapters: FrameworkAdapter[] = defaultAdapters): string[] {
  return [...new Set(adapters.flatMap((a) => a.extensions))];
}
