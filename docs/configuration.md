# Configuration reference

CSS Archaeology reads the first file found in the scanned root of:
`css-archaeology.config.json`, `.css-archaeologyrc.json`, `.css-archaeologyrc`. Use `--config <file>` to point
elsewhere. Configuration is **JSON only**: JavaScript configuration files are rejected and never executed.

Every field is optional. Unknown fields are errors. Run `css-archaeology config validate` to check a file.

```json
{
  "include": ["**/*"],
  "exclude": ["node_modules", ".git", ".next", "dist", "build", "out", "coverage", ".css-archaeology"],
  "framework": "auto",
  "analysis": {
    "unusedSelectors": true,
    "duplicateDeclarations": true,
    "specificityConflicts": true,
    "overriddenDeclarations": true,
    "mediaQueries": true,
    "designTokens": true,
    "complexity": true
  },
  "safelist": ["is-open", ".js-toggle", "/^swiper-/"],
  "reportFormat": ["json", "html"],
  "rules": {
    "repeated-value": "off",
    "high-specificity": { "severity": "medium", "options": { "max": [0, 3, 0] } },
    "unused-selector": { "options": { "checkElements": false } }
  },
  "failOn": "high"
}
```

## Fields

| Field | Type | Default | Description |
|---|---|---|---|
| `include` | glob[] | `["**/*"]` | Files to scan, relative to the root. |
| `exclude` | glob[] | see above | Directory names or globs to skip. Setting this replaces the defaults. |
| `framework` | string or string[] | `"auto"` | `auto`, `html`, `react`, `next`, `css-modules`, `tailwind`. Named frameworks are always enabled; the others still auto-detect. |
| `analysis` | object | all `true` | Turns whole analyzers on or off (keys above). |
| `safelist` | string[] | `[]` | Never report these as potentially unused. See [Safelist](#safelist). |
| `reportFormat` | (`json` \| `html`)[] | `["json", "html"]` | Report files written by `scan`. `report.json` is always written. |
| `outputDir` | string | `".css-archaeology"` | Where reports and the cache go. |
| `rules` | object | `{}` | Per-rule settings. See [Rules](#rules). |
| `failOn` | severity or `"none"` | `"high"` | Exit code 1 when a shown finding is at or above this severity. |
| `minConfidence` | `low` \| `medium` \| `high` | `"low"` | Drop findings below this confidence from the report entirely. |
| `maxFileSize` | integer (bytes) | `2000000` | Larger files are skipped and listed in `meta.filesSkipped`. |
| `concurrency` | 1-256 | `16` | Files read in parallel. |
| `cache` | boolean | `true` | Incremental cache in `outputDir/cache.json`. |
| `cssModules.localsConvention` | `asIs` \| `camelCase` \| `camelCaseOnly` \| `dashes` \| `dashesOnly` | `"camelCase"` | How your bundler exports CSS Module class names (`.card-title` as `styles.cardTitle`). Matches css-loader / Vite / Next.js naming. |
| `tokenScanExtensions` | string[] | vue, svelte, astro, php, erb, hbs, handlebars, twig, njk, liquid, md, mdx, ejs, pug | Extra file types searched for class-like tokens without structured parsing. |

## Rules

Each entry in `rules` is one of:

- `"off"` disables the rule.
- `"info"`, `"low"`, `"medium"` or `"high"` overrides the rule's severity.
- `{ "enabled": boolean, "severity": "...", "options": { ... } }`.

Rule options are validated against each rule's schema. All rules, their defaults and options are listed in
[rules.md](rules.md), or run `css-archaeology explain --rules`.

Severity and confidence are separate. **Severity** says how much an issue matters. **Confidence** says how sure the
analysis is that the finding is real; it is computed for each finding from a base value and listed factors (for
example "3 class expressions could not be resolved statically" lowers the confidence of unused-selector findings).
Scores of 0.75 or more are `high`, 0.45 or more are `medium`, and anything lower is `low`.

## Safelist

Entries can be:

- a class name (`is-open`) or class selector (`.is-open`),
- an id (`main`) or id selector (`#main`),
- an exact selector as written in the stylesheet (`.modal .is-open`),
- a regular expression between slashes (`/^swiper-/`, `/^theme-(dark|light)$/i`), tested against the selector text,
  each class and each id.

A selector is safelisted when its text, or any class or id it requires, matches. Invalid regular expressions are
reported as warnings by `config validate`.

Tailwind `safelist` entries in `tailwind.config.*` and `@source inline(...)` are read automatically (see
[frameworks.md](frameworks.md#tailwind-css)).
