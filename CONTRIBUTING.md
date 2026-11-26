# Contributing to CSS Archaeology

Thank you for helping. CSS Archaeology values accuracy and explainability over the number of warnings, so the most
useful contributions are false-positive reports, regression tests and better evidence.

## Setup

Requirements: Node.js 20.9 or later and npm 10 or later.

```sh
git clone https://github.com/abhisarena-sketch/CSS-Archealogy.git
cd CSS-Archealogy
npm ci
npm run build
npm test
```

## Everyday commands

| Command | What it does |
|---|---|
| `npm run build` | Builds the four packages with TypeScript project references |
| `npm run typecheck` | Type-checks packages and tests |
| `npm run lint` | ESLint, including the security and browser-safety rules |
| `npm test` | Vitest: unit, analyzer, adapter, example, CLI and playground tests |
| `npm run dev:playground` | Runs the playground at http://localhost:3000 |
| `npm run build:playground` | Production build of the playground |
| `npm run bench` | Measured benchmarks; rewrites `docs/benchmarks.md` |
| `node scripts/generate-rules-doc.mjs` | Regenerates `docs/rules.md` after changing rule metadata |
| `node scripts/build-playground-samples.mjs` | Rebuilds the playground samples from `examples/` |

Run the CLI from source after building: `node packages/cli/dist/bin.js scan examples/html-site`.

## Project layout

See [docs/architecture.md](docs/architecture.md). In short: `packages/core` holds the browser-safe engine (Node-only code
lives in `packages/core/src/node`), `packages/analyzers` holds the rules, `packages/framework-adapters` extracts usage
from markup and scripts, `packages/cli` is the command line, and `apps/playground` is the browser UI.

## Ground rules

- **Never execute scanned code.** No `eval`, `new Function`, `vm`, dynamic `import()` of project files or child
  processes in the engine. Lint enforces this; do not disable the rules.
- **Keep the engine browser-safe.** No `node:*` imports outside `packages/core/src/node`.
- **Every finding needs evidence.** A new rule must attach evidence that lets a reader verify the finding, a suggestion,
  and a rationale in its metadata. Severity and confidence are separate: severity is how much the issue matters,
  confidence is how sure the analysis is.
- **Prefer missing a finding to reporting a false one.** When static analysis cannot be sure, lower the confidence and
  say why in a confidence factor, or do not report.
- **Add a regression test** for every false positive you fix, in the analyzer's test file or in `tests/examples.test.ts`.
- **Do not publish estimates as measurements.** Performance claims must come from `npm run bench`.

## Adding a rule

1. Add the rule metadata (id, title, description, default severity, zod `optionsSchema`, rationale) to an analyzer in
   `packages/analyzers/src`, and emit `FindingDraft`s from its `run()`.
2. Add tests that cover true positives and the false-positive cases you considered.
3. Regenerate `docs/rules.md` and update the changelog.

## Adding a framework adapter

Implement `FrameworkAdapter` from `@css-archaeology/core` (see `packages/framework-adapters/src/html.ts` for a complete
example), register it in `defaultAdapters`, document supported syntax and known false positives in
[docs/frameworks.md](docs/frameworks.md), and add an example project under `examples/` with expected findings.

## Pull requests

- Keep pull requests focused, and describe what changed and how you verified it.
- CI must pass: typecheck, lint, tests, build, playground build and dependency audit.
- By contributing you agree that your contribution is licensed under the MIT License and that you follow the
  [Code of Conduct](CODE_OF_CONDUCT.md).
