# CSS Archaeology

**Understand your CSS. Find what is hiding beneath it.**

CSS Archaeology is an open-source static analyzer by Workfonic Labs. It reads your stylesheets together with your
HTML, React, Next.js, CSS Modules and Tailwind code, and shows you potentially unused selectors, duplicate and
overridden declarations, specificity conflicts, media query problems and repeated values, with the evidence behind
every finding.

It is built to be trusted:

- **Evidence, not guesses.** Every finding lists where it comes from, why it was reported, and a confidence score with
  the factors that raised or lowered it. Severity (how much it matters) and confidence (how sure we are) are separate.
- **"Potentially unused", never "delete this".** Static analysis cannot see runtime markup, so unused selectors are
  labelled as potential and nothing is ever removed for you.
- **Safe on untrusted code.** Scanned code is parsed, never executed. No `eval`, no network, no telemetry. Source files
  are never modified.

> Status: 0.1.0, not yet published to npm. Install from source for now (see [Installation](docs/installation.md)).

## Quick start

```sh
npx css-archaeology init          # optional: writes css-archaeology.config.json
npx css-archaeology scan          # summary in the terminal, reports in .css-archaeology/
npx css-archaeology explain CSSA-0004
```

```
CSS Archaeology v0.1.0 · html-site

  Stylesheets       3 (1.0 KB, 30 lines)
  Source files      1
  Selectors         23 (18 unique)
  Declarations      32
  Frameworks        html

  Potentially unused selectors   3
  Duplicate declarations         2
  Specificity conflicts          0
  Overridden declarations        1

  Findings: 13 total · 0 high · 3 medium · 4 low · 6 info

  CSSA-0004  medium  high conf.   css/base.css:7                       Overridden padding declaration
  CSSA-0008  medium  high conf.   css/components.css:4                 Duplicate padding declaration
  CSSA-0013  medium  high conf.   index.html#style-1:10                Duplicate padding declaration
  CSSA-0007  low     high conf.   css/components.css:2                 High specificity (1,3,0)
  CSSA-0009  low     high conf.   css/components.css:9                 Potentially unused selector .btn-secondary
```

(Output from scanning [`examples/html-site`](examples/html-site).)

## What it finds

| Analysis | Rules |
|---|---|
| Unused selectors | `unused-selector`, with safelists, dynamic class patterns and CSS Module scoping |
| Duplicates | `duplicate-declaration` (cascade and media aware, with a consolidation-safety verdict), `repeated-declaration-block` |
| Specificity and conflicts | `high-specificity`, `complex-selector`, `overqualified-selector`, `specificity-hack`, `specificity-escalation`, `important-overuse`, `conflicting-declaration`, `specificity-conflict` |
| Overridden declarations | `overridden-declaration`, through importance, layers, specificity and source order, including shorthands |
| Media queries | `duplicate-media-query`, `inconsistent-breakpoint`, `redundant-media-declaration`, `repeated-across-breakpoints` |
| Design tokens | `repeated-value`, `hardcoded-token-value`, `near-duplicate-color` |
| Complexity | `oversized-stylesheet`, `deep-nesting` |

Full descriptions, defaults and options: [docs/rules.md](docs/rules.md).

## Framework support

| | Status |
|---|---|
| HTML | Supported |
| React (JSX/TSX, plain JS/TS) | Supported |
| CSS Modules | Supported |
| Next.js | Partial |
| Tailwind CSS | Partial (custom CSS only; generated utilities are not analysed) |
| SCSS | Partial (no mixins, loops or interpolation) |
| Vue, Svelte, Astro, templates | Token scan only |
| Less, Sass (indented), Stylus | Not supported |

What each level means, and the false-positive scenarios for each framework: [docs/frameworks.md](docs/frameworks.md).

## Playground

A browser playground runs the same engine locally. Upload a ZIP or a folder (nothing leaves your machine) and explore
findings, selectors, stylesheets and design tokens, then export JSON or HTML.

```sh
npm ci && npm run dev:playground
```

## Performance

Measured on a 4-core Xeon VM with Node 22 (`npm run bench`, synthetic React + CSS Modules projects):

| Files | CSS | Cold scan | Warm scan (cache) | Peak RSS |
|---:|---:|---:|---:|---:|
| 103 | 58 KB | 0.29 s | 0.14 s | 165 MB |
| 817 | 466 KB | 1.35 s | 1.00 s | 234 MB |
| 4,081 | 2.3 MB | 6.3 s | 4.9 s | 593 MB |

Details, environment and method: [docs/benchmarks.md](docs/benchmarks.md). Your results will differ.

## Documentation

[Installation](docs/installation.md) · [CLI](docs/cli.md) · [Configuration](docs/configuration.md) ·
[Rules](docs/rules.md) · [Frameworks](docs/frameworks.md) · [Report format](docs/report-format.md) ·
[Playground](docs/playground.md) · [Architecture](docs/architecture.md) · [Limitations](docs/limitations.md) ·
[Benchmarks](docs/benchmarks.md) · [Publishing](docs/publishing.md)

## Packages

| Package | Description |
|---|---|
| [`css-archaeology`](packages/cli) | Command line interface |
| [`@css-archaeology/core`](packages/core) | Browser-safe engine, stylesheet model, configuration and reports |
| [`@css-archaeology/analyzers`](packages/analyzers) | The analysis rules |
| [`@css-archaeology/framework-adapters`](packages/framework-adapters) | HTML, React, Next.js, CSS Modules and Tailwind support |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). False-positive reports are especially welcome. Please follow the
[Code of Conduct](CODE_OF_CONDUCT.md), and report security issues as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Workfonic Labs
