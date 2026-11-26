# Playground

The playground (`apps/playground`) is a Next.js app that runs the CSS Archaeology engine in the browser.

```sh
npm ci
npm run dev:playground        # development, http://localhost:3000
npm run build:playground      # production build
npm run start -w @css-archaeology/playground
```

## What it does

- **Input:** upload a ZIP of a repository, choose a folder (browsers that support directory pickers), or load one of
  the bundled samples from `examples/`.
- **Views:** dashboard (summary, severity and rule breakdown, largest stylesheets, most complex selectors), findings
  explorer (filters, evidence and confidence factors per finding), selector explorer, stylesheet explorer and design
  token explorer (colour swatches are rendered only for values that pass strict colour validation).
- **Export:** download the JSON report or the same self-contained HTML report the CLI writes.

## Safety

- Files are read with the File API and analysed in a Web Worker. **Nothing is uploaded**, and the production
  Content Security Policy sets `connect-src 'self'`.
- **No project code runs.** Scripts are parsed, never executed. The CSP has no `unsafe-eval`.
- **ZIP extraction** happens in memory with `fflate`. Entries with `..` segments, absolute paths, Windows drive letters,
  UNC paths or NUL bytes are rejected and listed as skipped. Limits: 25 MB archive, 20,000 entries, 2 MB per file,
  100 MB total expanded size, and a 200:1 compression ratio per entry. Binary files and directories such as
  `node_modules`, `.git` and `dist` are skipped. A single top-level folder (as in GitHub's "Download ZIP") is stripped.
- Folder uploads go through the same filters and limits.

For larger projects, use the CLI. The playground does not have an incremental cache.

## Tests

`apps/playground/src/lib/zip.test.ts` covers path validation, traversal rejection, limits, binary detection and
corrupt archives. Run it with `npm test`.
