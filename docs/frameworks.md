# Framework compatibility

CSS Archaeology finds selector usage by reading markup and scripts **statically**. It never runs your code, renders
components or starts a dev server. That makes it safe and fast, and it also sets the limits described below. Support is
labelled honestly: **Supported** means the common patterns are understood and covered by tests; **Partial** means some
common patterns are not understood and can cause false positives.

| Framework | Status | Files | What is understood | Main gaps |
|---|---|---|---|---|
| Plain HTML | Supported | `.html`, `.htm` | Elements, `class`, `id`, all attributes, `<style>` blocks, `<link rel="stylesheet">` order, inline `<script>` | Markup produced at runtime or by a CMS |
| React (JSX/TSX) | Supported | `.jsx`, `.tsx`, `.js`, `.ts`, `.mjs`, `.cjs`, `.mts`, `.cts` | `className`, `class`, `id`, intrinsic elements, string/template literals, `clsx`-style helpers, `cva`, DOM APIs, CSS Module imports | Classes built from values only known at runtime; markup inside third-party components |
| Next.js | Partial | React files plus `app/`, `pages/` | Everything in React; `next/link` → `a`, `next/image` → `img`; route detection; `app/layout` and `pages/_app` as stylesheet entry points | `.mdx` content is token-scanned only; server-rendered markup from data; `next/font` class names |
| CSS Modules | Supported | `*.module.css`, `*.module.scss` | `styles.foo`, `styles['foo-bar']`, destructuring, `composes`, `:global`, `localsConvention` | Dynamic access (`styles[variant]`) is detected and treated as "all classes possibly used" for that module |
| Tailwind CSS | Partial | CSS with `@tailwind`/`@import "tailwindcss"`, `tailwind.config.*` | Custom CSS in Tailwind projects, `@apply`, `safelist` (strings and regex prefixes) read statically, `@source inline(...)` with brace expansion | Generated utilities are not analysed; `content`/`@source` globs and plugins are not evaluated |
| Vue, Svelte, Astro, PHP, ERB, Handlebars, Twig, Nunjucks, Liquid, Markdown, MDX, EJS, Pug | Token scan only | see `tokenScanExtensions` | Class-like tokens anywhere in the file count as references | No structure: elements, attributes and bindings are not parsed, so element/attribute selectors are judged from other files |
| SCSS | Partial | `.scss` | Nesting, `&` suffixes, `@extend` (recorded), `@media` nesting, comments | Mixins, functions, `@each`/`@for` loops, interpolation `#{}` and `@use` are not evaluated; selectors with interpolation are skipped by unused-selector analysis (the count is noted in the report), and rules inside `@mixin` are not reported |
| Less, Sass (indented), Stylus | Not supported | `.less`, `.sass`, `.styl` | Skipped and listed in `meta.filesSkipped` | Compile them to CSS and scan the output |

Framework detection: `framework: "auto"` (the default) enables adapters based on `package.json` dependencies, config
files and file types. Detection reasons are listed in the report under `meta.notes` (for example `framework react: react dependency in package.json`). Set `framework` in
the configuration, or pass `--framework`, to force an adapter on.

## Plain HTML

- **Discovery:** every `.html`/`.htm` file under `include`. `<style>` blocks are analysed as embedded stylesheets
  (reported as `index.html#style-1` with the host file's line numbers).
- **Stylesheet order:** `<link rel="stylesheet">` order in each HTML file feeds cascade ordering for overrides.
- **Templates:** `{{ }}`, `{% %}`, `<%= %>` and `${}` inside attributes are treated as dynamic. `class="card-{{ variant }}"`
  produces the pattern `card-*`, and any class starting with `card-` is treated as possibly used.
- **False-positive scenarios:** classes added by scripts that are not scanned (CDN scripts, analytics, A/B tools);
  markup injected by a CMS or server templates in another repository; elements created by `innerHTML` with strings
  the scanner cannot see.

## React

- **Discovery:** script files under `include`. Every string literal in a script (except import paths) is also
  tokenized, so a class name that appears in any string, such as a config object or a map of variants, counts as a
  reference. This deliberately favours avoiding false positives.
- **Helpers:** `clsx`, `classnames`/`classNames`, `cn`, `cx`, `twMerge`, `twJoin`, `cva`, `tv`, `ctl`, `mergeClasses`
  are evaluated wherever they are called. Conditional (`a && 'x'`, ternaries), object (`{ active: isActive }`), array
  and template-literal arguments are resolved when their parts are literals or `const` values in the same file.
- **DOM APIs:** `classList.add/remove/toggle/replace/contains`, `querySelector(All)`, `closest`, `matches`,
  `setAttribute`/`toggleAttribute`, `element.className =` and `element.id =`.
- **Dynamic classes:** `` `btn-${size}` `` produces the pattern `btn-*`. Expressions that cannot be resolved at all
  (`className={props.theme}`) are counted and lower the confidence of every unused-selector finding, with an example
  in the confidence factors. Pass-through props named `className`, `classes`, `props`, `rest` and similar do not
  count as unresolved.
- **False-positive scenarios:** classes coming from a server response, a CMS or a database; class names assembled in
  another package; components from `node_modules` that render your global classes (for example a UI library that
  expects `.modal-open` on `body`). Safelist these.

## Next.js

- **Discovery:** as React, plus route detection for `app/` and `pages/` (noted in the report).
- **Stylesheet order:** global CSS imported from `app/layout.*` or `pages/_app.*` (and their imports) is ordered by the
  import graph, which makes cross-file override findings more reliable. When no import graph covers a stylesheet,
  path order is assumed and findings that depend on it are marked `approximate` with lower confidence.
- **Components:** `next/link` `Link` counts as an `a` element, `next/image` `Image` as `img`.
- **Not understood:** markup in `.mdx` beyond class-like tokens; classes generated by `next/font`; styled-jsx
  (`<style jsx>`) blocks; styles in `node_modules` packages.

## CSS Modules

- **Scoping:** module classes are local to their file. A module class is only matched against code that imports that
  module; a global `.title` elsewhere does not make `styles.title` used, and vice versa. Cascade analysis (overrides,
  conflicts) never compares local classes from different modules.
- **Access patterns:** `styles.foo`, `styles['foo']`, `const { foo } = styles`, `composes: foo from './x.module.css'`
  and `:global(...)`.
- **Naming:** `cssModules.localsConvention` controls which exported names are accepted (`.card-title` is reachable as
  `styles.cardTitle` with the default `camelCase`).
- **Dynamic use:** `styles[variant]`, spreading `styles` or passing it to a function marks the whole module as
  possibly used, and the report notes it. A module that no scanned file imports is still analysed, with lower
  confidence.

## Tailwind CSS

- **What is analysed:** the CSS you write in a Tailwind project: component classes in `@layer`, plain rules, `@apply`
  (the applied utilities and classes count as references). Utilities that Tailwind generates are not part of your
  source CSS, so CSS Archaeology does not report on them.
- **Safelist:** `safelist` entries in `tailwind.config.{js,cjs,mjs,ts}` are read with the TypeScript parser (the file
  is not executed). String entries are exact references; `{ pattern: /^bg-(red|blue)-500$/ }` contributes the literal
  prefix `bg-`. `@source inline("bg-{red,blue}-500")` is expanded.
- **Not understood:** `content` globs and `@source` paths (every scanned file is used instead), plugins, `theme()`
  values, arbitrary variants such as `group-hover:` applied to custom classes, and config files that compute the
  safelist with code.

## Reporting false positives

If a selector is reported as potentially unused but is used, please
[open an issue](https://github.com/abhisarena-sketch/CSS-Archealogy/issues) with the output of
`css-archaeology explain CSSA-xxxx` and a minimal snippet of the code that uses it. Until it is fixed, add it to the
`safelist`.
