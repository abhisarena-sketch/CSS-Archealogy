# Installation

CSS Archaeology needs **Node.js 20.9 or later**.

> **Status:** version 0.1.0 has not been published to npm yet. Until it is, install from source (below).
> The commands in this guide use the published package name `css-archaeology`.

## From npm (after the first release)

```sh
# Run once without installing
npx css-archaeology scan

# Or add it to a project
npm install --save-dev css-archaeology
npx css-archaeology init
```

## From source

```sh
git clone https://github.com/abhisarena-sketch/CSS-Archealogy.git
cd CSS-Archealogy
npm ci
npm run build
node packages/cli/dist/bin.js scan /path/to/your/project
```

To make `css-archaeology` available on your PATH from a source checkout, run `npm link -w css-archaeology`.

## First scan

```sh
cd your-project
npx css-archaeology init        # writes css-archaeology.config.json
npx css-archaeology scan        # prints a summary, writes .css-archaeology/report.json and report.html
npx css-archaeology explain CSSA-0001
```

Add `.css-archaeology/` to your `.gitignore`. It holds the reports and the incremental cache.

## In CI

```yaml
- run: npx css-archaeology scan --fail-on high --format text,html
```

The command exits with code 1 when a finding at or above `--fail-on` is shown. See [cli.md](cli.md#exit-codes).

## Playground

The browser playground runs the same engine without installing anything locally:

```sh
npm run dev:playground   # http://localhost:3000
```

See [playground.md](playground.md).
