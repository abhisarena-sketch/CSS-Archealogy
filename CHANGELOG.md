# Changelog

All notable changes to CSS Archaeology are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - Unreleased

First public version. Not yet published to npm.

### Added

- `@css-archaeology/core`: PostCSS-based stylesheet model (CSS, partial SCSS, CSS nesting, `@media`, `@supports`,
  `@container`, `@layer`, `@scope`), selector specificity, import-graph stylesheet ordering, configuration schema
  and validation, confidence scoring, JSON and self-contained HTML reports, Node file discovery and an incremental cache.
- `@css-archaeology/analyzers`: 21 rules across unused selectors, duplicate declarations, specificity and conflicts,
  overridden declarations, media queries, design tokens and complexity.
- `@css-archaeology/framework-adapters`: HTML, React (JSX/TSX and plain scripts), Next.js, CSS Modules and Tailwind CSS.
  Scripts are parsed with the TypeScript compiler API and never executed.
- `css-archaeology` CLI: `init`, `scan`, `report`, `explain`, `config validate`, CI exit codes.
- Browser playground (Next.js) with dashboard, findings, selector, stylesheet and token explorers, safe in-memory ZIP
  extraction and JSON/HTML export.
- Measured benchmarks (`npm run bench`), GitHub Actions CI.
