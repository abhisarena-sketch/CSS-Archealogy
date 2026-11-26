# Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub security advisories](https://github.com/abhisarena-sketch/CSS-Archealogy/security/advisories/new).
Do not open a public issue. We aim to acknowledge reports within 5 working days.

## Supported versions

Only the latest released version receives security fixes.

## Security model

CSS Archaeology reads untrusted source code. It is designed so that scanning a project is safe:

- **No code execution.** Scanned JavaScript and TypeScript (including `tailwind.config.js`) is parsed with the
  TypeScript compiler API and never run. The codebase does not use `eval`, `new Function`, `vm` or child processes;
  ESLint rules and a CI check enforce this. Zod runs in jitless mode so it never generates code.
- **JSON-only configuration.** CSS Archaeology configuration files are JSON. JavaScript configuration files are
  rejected rather than imported.
- **Read-only.** Source files are never modified. The CLI only writes reports and its cache to the output directory
  (`.css-archaeology/` by default).
- **Bounded input.** Files larger than `maxFileSize` (2 MB by default) and binary files are skipped and listed in the
  report. Discovery does not follow symbolic links.
- **No network and no telemetry.** The CLI and the engine make no network requests.
- **Playground.** Uploaded ZIP files and folders are read in the browser and analysed in a Web Worker; nothing is
  uploaded. Archive entries with `..` segments, absolute paths, drive letters or NUL bytes are rejected. Archive size
  (25 MB), entry count (20,000), per-file size (2 MB), total expanded size (100 MB) and compression ratio (200:1) are
  limited. The production build sends a Content Security Policy without `unsafe-eval` and with `connect-src 'self'`.
- **Escaped reports.** Every value in the HTML report is HTML-escaped, and the report carries its own restrictive CSP.

Known limitation: the playground checks the real decompressed size of each entry after `fflate` has inflated it, so
an archive that lies about its uncompressed sizes can use more memory than the limits suggest before it is rejected.
The browser tab's memory limit is the final bound.
