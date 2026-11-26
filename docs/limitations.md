# Known limitations

CSS Archaeology is a static analyzer. It reads files; it does not run a browser, your build or your application.
These limits are inherent to that design or not yet implemented. Findings are labelled with confidence and, where
browser behaviour is approximated, `approximate: true`.

## Usage detection ("potentially unused")

- Markup created at runtime from data (API responses, CMS content, databases, Markdown) is invisible unless the class
  names also appear as literals in scanned files.
- Class names assembled from variables that cannot be resolved in the same file (`className={theme.button}`) cannot be
  matched. They are counted, and they lower confidence on every unused-selector finding.
- Third-party packages in `node_modules` are not scanned. A UI library that applies your global classes will not be
  seen. Use the `safelist`.
- Element and attribute selectors in projects with token-scanned templates (Vue, Svelte, Astro and others) are judged
  only from files that are parsed structurally.
- Any string literal that looks like a class name counts as a reference. This avoids false positives but can hide
  truly unused selectors (false negatives).

## Cascade analysis (overrides, conflicts, duplicates)

- Selectors are compared structurally. Two different selectors that match the same elements in your markup are not
  known to overlap unless one structurally covers the other.
- Media queries are compared as written. `(min-width: 768px)` and `(min-width: 48em)` are different conditions.
- Cross-file order is derived from the import graph; when it is unknown, path order is assumed and findings are marked
  approximate with lower confidence. Bundlers that reorder CSS, or CSS loaded with JavaScript at runtime, can differ.
- Inline `style` attributes, `!important` from user agent or user stylesheets, Shadow DOM and `@scope` proximity are
  not modelled.

## Languages and frameworks

- SCSS is partial: mixins, functions, loops, interpolation and `@use` are not evaluated. Less, indented Sass and
  Stylus are skipped. See [frameworks.md](frameworks.md).
- Tailwind-generated utilities are not analysed; only the CSS you write is. Tailwind `content` globs and plugins are
  not evaluated.
- CSS-in-JS (styled-components, Emotion, styled-jsx, vanilla-extract) is not analysed as CSS.

## Tooling

- The browser playground has no cache and is limited to 25 MB archives. It checks the real decompressed size of each
  entry after inflating it, so a malicious archive that lies about sizes can use more memory before it is rejected.
- Finding ids (`CSSA-0001`) are per report. Use `fingerprint` to track findings across scans. A baseline file
  (suppressing known findings) is not implemented yet.
- There is no watch mode, no autofix, and no editor integration. CSS Archaeology never changes source files by design.
