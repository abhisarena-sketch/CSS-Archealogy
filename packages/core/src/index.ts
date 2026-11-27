/**
 * @css-archaeology/core: browser-safe analysis engine.
 *
 * Node-only helpers (file discovery, config files, the incremental cache) live in
 * `@css-archaeology/core/node` so the engine can run in the playground.
 */
export * from './types.js';
export * from './config.js';
export * from './confidence.js';
export * from './engine.js';
export * from './hash.js';
export * from './metrics.js';
export * from './paths.js';
export * from './plugins.js';
export * from './project.js';
export * from './references.js';
export * from './selectors.js';
export * from './stylesheet.js';
export * from './tokens.js';
export * from './version.js';
export * from './report/json.js';
export * from './report/html.js';
export * from './report/schema.js';
