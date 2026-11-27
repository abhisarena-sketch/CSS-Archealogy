# Benchmarks

These numbers were **measured** by `npm run bench` (`scripts/benchmark.mjs`). They are not estimates.
Re-run the script on your own hardware; results vary with CPU, disk and Node version.

## Environment

| | |
|---|---|
| Date | 2026-11-26T21:22:36.122Z |
| Node | v22.23.5 |
| Platform | linux 6.18.44-fc-v880 x64 |
| CPU | Intel(R) Xeon(R) Processor @ 2.10GHz × 4 |
| Memory | 15.7 GB |
| Runs per case | 3 cold (median reported) + 1 warm |

## Projects

Synthetic, deterministic (seed 42) React projects: each component has a CSS Module (8 classes, hover
states, nested rules, a media query, an unreferenced `.legacy` rule, occasional duplicate properties) and a
TSX file using `styles.*` and `clsx(...)`. Global stylesheets add utility classes, descendant selectors,
`!important` overrides and custom properties. Generation time is not included.

## Results

| Case | Files | Stylesheets | CSS | Selectors | Declarations | Findings | Cold scan (median) | Warm scan (cache) | Peak RSS | Peak heap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| small | 103 | 52 | 58 KB | 1098 | 2334 | 528 | 294 ms | 136 ms | 165 MB | 51 MB |
| medium | 817 | 416 | 466 KB | 8982 | 18748 | 5509 | 1353 ms | 997 ms | 234 MB | 111 MB |
| large | 4081 | 2080 | 2328 KB | 44800 | 93740 | 28579 | 6290 ms | 4921 ms | 593 MB | 418 MB |

Individual cold runs (ms): small 261, 316, 294; medium 1345, 1415, 1353; large 6290, 6348, 6155.

"Cold" runs start with no cache. "Warm" runs reuse `.css-archaeology/cache.json` from the previous run, so
parsing and extraction are skipped for unchanged files; the analyzers always run on the whole project.
Times are wall-clock time for `scanProject()` (discovery, reading, parsing, extraction, analysis) in a fresh
Node process, excluding process start-up and report writing. Peak RSS is the process maximum, including
Node itself (about 40-50 MB).

## Limits of this benchmark

- The projects are synthetic. Real projects differ in selector shapes, file sizes and framework mix.
- Only one machine is measured per run of the script.
- The browser playground is not benchmarked here; it runs the same engine in a Web Worker.
