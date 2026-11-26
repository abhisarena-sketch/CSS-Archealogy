import type { FrameworkAdapter } from '@css-archaeology/core';
import { extractFromScript } from './js-extractor.js';
import { SCRIPT_EXTENSIONS } from './react.js';

const ROUTE_DIRS = /^(src\/)?(app|pages)\//;

/**
 * Next.js adapter. Builds on the React extractor and adds Next.js conventions:
 * `next/link` and `next/image` render <a> and <img>, global CSS order follows
 * imports in `app/layout` and `pages/_app`, and `.next/` output is excluded by default.
 */
export const nextAdapter: FrameworkAdapter = {
  id: 'next',
  title: 'Next.js',
  version: 3,
  extensions: SCRIPT_EXTENSIONS,
  priority: 20,
  implies: ['react'],
  detect(input) {
    if (input.dependencies.has('next')) return { detected: true, reason: 'next dependency in package.json' };
    const config = input.paths.find((p) => /(^|\/)next\.config\.(js|mjs|cjs|ts)$/.test(p));
    if (config) return { detected: true, reason: `${config} found` };
    return { detected: false, reason: 'no next dependency or next.config file' };
  },
  extract(file, context) {
    const refs = extractFromScript(file, context, { adapter: 'next' });
    // Root layouts render <html> and <body>; they are always present.
    return refs;
  },
  projectHook(ctx) {
    const routes = ctx.paths.filter((p) => ROUTE_DIRS.test(p) && /\.(jsx?|tsx?|mdx)$/.test(p));
    const appRouter = routes.some((p) => /^(src\/)?app\//.test(p));
    const pagesRouter = routes.some((p) => /^(src\/)?pages\//.test(p));
    ctx.note(`Next.js: ${routes.length} route file(s) found (${[appRouter && 'app router', pagesRouter && 'pages router'].filter(Boolean).join(', ') || 'no app/ or pages/ directory'}).`);
    if (ctx.paths.some((p) => p.endsWith('.mdx'))) {
      ctx.note('Next.js: .mdx content is token-scanned only; elements produced by Markdown are not detected.');
    }
  },
};
