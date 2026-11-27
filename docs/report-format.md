# Report format

`css-archaeology scan` writes `.css-archaeology/report.json` (always) and `report.html` (when `html` is in the formats).
`--format json` prints the same JSON to stdout. The JSON report is validated against a Zod schema
(`reportSchema` in `@css-archaeology/core`) both when it is written and when `report` or `explain` read it back.

## Top level

| Field | Contents |
|---|---|
| `meta` | Tool name, `version`, `schemaVersion` (1), `generatedAt`, scanned `root` (directory name only), `durationMs`, active `frameworks` and `analyzers`, `filesDiscovered`, `filesSkipped` (with reasons), `cache` hits and misses, `notes` (framework detection reasons and analysis caveats) |
| `summary` | Counts: stylesheets, source files, selectors, declarations, findings, and findings by severity, confidence, rule and analyzer |
| `metrics` | Totals, `!important` count, custom properties, media queries, largest stylesheets, most complex selectors, size distribution |
| `findings` | Every finding (below) |
| `stylesheets` | Per-stylesheet measurements: syntax, bytes, lines, rules, selectors, declarations, `!important` count, max nesting depth, average and max specificity, parse issues, findings |
| `selectors` | Selector inventory: specificity, occurrences, files, locations and the ids of findings about each selector |
| `tokens` | Values by category (colour, spacing, typography, radius, shadow, breakpoint) with counts, properties, locations and custom properties already defined with that value |
| `parseIssues` | Stylesheets that could not be parsed strictly (recovered with a tolerant parser, or failed) |

Absolute paths are never written: file paths are relative to the scanned root.

## Findings

```json
{
  "id": "CSSA-0003",
  "fingerprint": "18syw4q8zni",
  "rule": "unused-selector",
  "analyzer": "unused-selectors",
  "severity": "low",
  "confidence": "high",
  "confidenceScore": 0.85,
  "confidenceFactors": [],
  "title": "Potentially unused selector .unused-theme-class",
  "description": ".unused-theme-class requires .unused-theme-class, which was not found in any scanned source file.",
  "file": "app/theme.css",
  "line": 3,
  "column": 1,
  "evidence": [
    {
      "kind": "selector",
      "message": "Selector declared here",
      "file": "app/theme.css",
      "line": 3,
      "column": 1,
      "snippet": ".unused-theme-class"
    },
    {
      "kind": "search",
      "message": "No reference to .unused-theme-class found in 4 scanned source file(s) or any string literal"
    }
  ],
  "suggestion": "Confirm the selector is not used by runtime-generated markup, third-party code or content before removing it. Add it to the safelist if it is used.",
  "approximate": false,
  "selector": ".unused-theme-class",
  "data": {
    "missing": [
      {
        "kind": "class",
        "name": "unused-theme-class"
      }
    ]
  }
}
```

| Field | Meaning |
|---|---|
| `id` | `CSSA-0001`... Stable order within one report (file, line, column, rule). Can change between scans. |
| `fingerprint` | Hash of the rule and the code the finding points at. Use it to track a finding across scans. |
| `severity` | `info`, `low`, `medium`, `high`: how much the issue matters (rule default, or your override). |
| `confidence` / `confidenceScore` | How sure the analysis is (0.05-0.99; high at 0.75 or more, medium at 0.45 or more). |
| `confidenceFactors` | What raised or lowered the score, with a human-readable `detail`. |
| `evidence` | What the finding is based on: declarations, selectors, searches, metrics, context and notes, each with a location where one exists. |
| `approximate` | True when the result depends on approximating browser behaviour (for example stylesheet load order, or a covering selector rather than an identical one). |
| `data` | Rule-specific structured data. |

## HTML report

`report.html` is a single self-contained file with no external requests. All values are HTML-escaped, and the file
carries a restrictive Content Security Policy. It includes the summary, filters by severity, confidence, rule and
text, and the evidence for each finding.
