# CLI reference

```
css-archaeology init [--framework <name>] [--force]
css-archaeology scan [path] [options]
css-archaeology report [--format html|json|text] [--input <report.json>]
css-archaeology explain <CSSA-0001 | rule-id> [--input <report.json>]
css-archaeology explain --rules
css-archaeology config validate [--config <file>]
css-archaeology --help | --version
```

CSS Archaeology never modifies source files. The only files it writes are `css-archaeology.config.json` (from
`init`) and the reports and cache in the output directory (`.css-archaeology/` by default).

## `init`

Writes a starter `css-archaeology.config.json` in the current directory. `--framework` sets the `framework` field
(`auto`, `html`, `react`, `next`, `css-modules`, `tailwind`). Refuses to overwrite an existing file unless `--force`
is given.

## `scan`

Scans `path` (default: the current directory), prints a summary and writes `report.json` (always) and `report.html`
(when `html` is among the formats) to the output directory.

| Option | Description |
|---|---|
| `--format <list>` | `text` (default summary), `json` (prints the JSON report to stdout instead of the summary), `html`. Repeatable or comma separated. |
| `--rule <id>` | Only run and show these rules. Accepts rule ids (`duplicate-declaration`) or analyzer ids (`unused-selectors`). Repeatable. |
| `--severity <level>` | Only show findings at or above `info`, `low`, `medium` or `high`. |
| `--confidence <level>` | Only show findings at or above `low`, `medium` or `high` confidence. |
| `--exclude <glob>` | Additional exclude pattern. Repeatable. |
| `--include <glob>` | Replace the include patterns. Repeatable. |
| `--framework <name>` | Force framework adapters on. Repeatable. Others still auto-detect. |
| `--config <file>` | Configuration file (default: first of `css-archaeology.config.json`, `.css-archaeologyrc.json`, `.css-archaeologyrc`). |
| `--output <dir>` | Report directory (default `.css-archaeology`). |
| `--fail-on <level>` | Exit with code 1 when a shown finding is at or above this severity. `none` disables. Default `high`. |
| `--limit <n>` | Number of findings listed in the text summary (default 20). |
| `--no-cache` | Do not read or write the incremental cache. |
| `--quiet` | No progress output on stderr. |

Progress is written to stderr, so `--format json` output on stdout can be piped:

```sh
css-archaeology scan --format json --quiet | jq '.findings[] | select(.rule == "unused-selector") | .selector'
```

### Incremental scanning

With `cache: true` (the default), parse and extraction results are stored in `.css-archaeology/cache.json`, keyed by
a hash of each file's content and the engine version. Unchanged files are not re-parsed on the next scan. The
analyzers always run on the whole project, because a change in one file can change findings in another. Measured
effect: see [benchmarks.md](benchmarks.md).

## `report`

Re-renders a previous scan without scanning again. Reads `.css-archaeology/report.json` (or `--input`) and prints
a text summary, or writes `report.html` / prints JSON with `--format`.

## `explain`

`explain CSSA-0004` prints one finding from the last report with all of its evidence, the confidence factors and the
rule's rationale. `explain overridden-declaration` prints a rule's documentation. `explain --rules` lists all rules.

Finding ids (`CSSA-0001`, ...) are assigned in a stable order (file, line, column, rule) within one report. They can
change between scans when the code changes; each finding also has a content-based `fingerprint` in the JSON report
for tracking across scans.

## `config validate`

Validates the configuration file, including rule options, and reports every problem with its path. Exit code 2 when
the file is invalid:

```
Configuration error: Invalid configuration:
  - rules.deep-nesting.options.maxDepth: Invalid input: expected number, received string
```

Unknown rule ids are reported as warnings (exit code 0), so a configuration written for a newer version still works.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success, and no shown finding is at or above `--fail-on` |
| 1 | At least one shown finding is at or above `--fail-on` |
| 2 | Usage or configuration error |
| 3 | Unexpected error |

`--fail-on` applies after the `--severity`, `--confidence` and `--rule` filters, so
`--confidence high --fail-on medium` fails only on high-confidence findings of medium or high severity.

## Colours

Colour is used only when stdout is a TTY. Set `NO_COLOR=1` to disable it.
