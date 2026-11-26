# Architecture

```
            ┌──────────────┐   files    ┌─────────────────────────────────────────────────────────┐
  CLI  ───▶ │ core/node    │ ─────────▶ │ core engine  (browser-safe, no Node built-ins)          │
            │ discovery,   │            │                                                         │
            │ config file, │            │ 1 parse stylesheets (PostCSS, safe parser, SCSS)        │
            │ cache        │            │ 2 extract references   ◀── framework adapters           │
            └──────────────┘            │ 3 build project model (order, layers, indexes)          │
                                        │ 4 run analyzers         ◀── analyzers (rules)           │
  Playground ─ ZIP / folder ──────────▶ │ 5 score confidence, filter, assign ids                  │
   (Web Worker)                         │ 6 summary, metrics, inventories → JSON / HTML report    │
                                        └─────────────────────────────────────────────────────────┘
```

## Packages

| Package | Responsibility | Depends on |
|---|---|---|
| `@css-archaeology/core` | Data model, stylesheet parsing, selectors and specificity, project model, engine, config schema, confidence, reports. `core/node` adds file discovery, JSON config loading and the cache. | postcss, postcss-safe-parser, postcss-scss, postcss-selector-parser, zod, fast-glob (node entry only) |
| `@css-archaeology/analyzers` | The rules. Each analyzer declares rule metadata (with a Zod options schema and rationale) and returns finding drafts. | core |
| `@css-archaeology/framework-adapters` | Detects frameworks and extracts class, id, element and attribute references, dynamic patterns, CSS Module usage and stylesheet imports from markup and scripts. | core, htmlparser2, typescript (parser only) |
| `css-archaeology` | The CLI. | all of the above |
| `apps/playground` | Next.js UI. Uses core, analyzers and adapters in a Web Worker. | the engine packages |

The engine has no dependency on Next.js, React or Node built-ins; ESLint enforces that `node:*` modules are only
imported in `core/src/node`.

## Engine pipeline

1. **Parse.** Every stylesheet (and `<style>` block) becomes a `StylesheetModel`: rules with resolved selectors
   (nesting and `&` applied), declarations with global order, and the full at-rule context (media, supports,
   container, layer, scope). Invalid CSS is recovered with `postcss-safe-parser` and reported as a parse issue.
2. **Extract.** Adapters turn source files into `FileReferences`. JS/TS is parsed with the TypeScript compiler API;
   HTML with htmlparser2. Nothing is executed. Results are cached by content hash.
3. **Project model.** Stylesheets are ordered by the import graph from entry points (`app/layout`, `pages/_app`,
   `main`/`index` scripts, HTML `<link>` order, CSS `@import`), falling back to path order. Each stylesheet records
   whether its order came from the import graph, so analyzers can lower confidence when order is guessed.
4. **Analyze.** Analyzers read the project model and the merged references through an `AnalyzerContext` that also
   resolves rule settings and options.
5. **Score.** `confidenceScore = clamp(base + Σ factor effects, 0.05, 0.99)`. Severity overrides from configuration
   are applied, `minConfidence` filters, findings are fingerprinted, sorted and numbered.

## Extending

- **Analyzer:** implement `Analyzer` (`id`, `configKey`, `title`, `description`, `rules`, `run(ctx)`) and pass it in
  `analyzers` to `analyzeProject`.
- **Framework adapter:** implement `FrameworkAdapter` (`id`, `extensions`, `detect`, optional `extract` and
  `projectHook`).

```ts
import { analyzeProject } from '@css-archaeology/core';
import { defaultAnalyzers } from '@css-archaeology/analyzers';
import { defaultAdapters } from '@css-archaeology/framework-adapters';

const result = await analyzeProject({
  files: [{ path: 'a.css', content: '.a { color: red } .a { color: red }' }],
  analyzers: defaultAnalyzers,
  adapters: defaultAdapters,
  config: { rules: { 'repeated-value': 'off' } },
});
```

## Testing

- Unit tests per package (`packages/*/test`), including false-positive regression tests for each analyzer.
- `tests/examples.test.ts` scans each project in `examples/` and asserts the exact expected findings.
- `tests/cli.test.ts` runs the CLI in-process, including a check that source files are byte-for-byte unchanged after a scan.
- `apps/playground/src/lib/zip.test.ts` covers archive safety.
