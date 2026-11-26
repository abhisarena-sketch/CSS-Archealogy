import type { FrameworkAdapter } from '@css-archaeology/core';

/**
 * CSS Modules support. Class names in `*.module.css` are file-scoped: they are only
 * considered used when an importing file accesses them (styles.name, styles['name'],
 * destructuring, composes). Extraction of the imports happens in the script adapters;
 * this adapter validates usage and reports modules that nothing imports.
 */
export const cssModulesAdapter: FrameworkAdapter = {
  id: 'css-modules',
  title: 'CSS Modules',
  version: 1,
  extensions: [],
  priority: 0,
  detect(input) {
    const modules = input.paths.filter((p) => /\.module\.(css|scss|pcss)$/i.test(p));
    return { detected: modules.length > 0, reason: `${modules.length} CSS Module file(s) found` };
  },
  projectHook(ctx) {
    const modules = ctx.project.stylesheets.filter((s) => s.isModule);
    const imported = new Set(ctx.references.cssModules.map((u) => u.module));
    const notImported = modules.filter((m) => !imported.has(m.file));
    if (notImported.length) {
      ctx.note(`CSS Modules: ${notImported.length} module(s) are not imported by any scanned file: ${notImported.slice(0, 5).map((m) => m.file).join(', ')}${notImported.length > 5 ? ', ...' : ''}`);
    }
    const escaped = ctx.references.cssModules.filter((u) => u.escaped);
    if (escaped.length) {
      ctx.note(`CSS Modules: ${escaped.length} import(s) use the styles object dynamically (spread, passed to a function or indexed with a variable); all classes of those modules are treated as used.`);
    }
    for (const u of ctx.references.cssModules) {
      if (!ctx.fileExists(u.module)) ctx.note(`CSS Modules: ${u.importer} imports ${u.module}, which was not found in the scanned files.`);
    }
  },
};
