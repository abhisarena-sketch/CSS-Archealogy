#!/usr/bin/env node
/**
 * CSS Archaeology benchmark.
 *
 * Generates deterministic synthetic projects (React components with CSS Modules,
 * global stylesheets, nested rules, media queries, duplicates and unused rules),
 * scans each one in a fresh Node process and records measured wall time, peak RSS
 * and heap. Results are written to docs/benchmarks.md and bench-results/latest.json.
 *
 * Every number in the output is measured on the machine that ran this script.
 *
 *   npm run bench                 # build, then small / medium / large
 *   node scripts/benchmark.mjs --runs 5 --cases small,medium
 */
// The benchmark harness (not the analyzer) spawns one process per measurement so
// that peak memory is isolated per run.
// eslint-disable-next-line no-restricted-imports
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

/* ------------------------------------------------------------------ */
/* Child mode: scan one directory and print measurements as JSON.      */
/* ------------------------------------------------------------------ */
if (args[0] === '--measure') {
  const dir = args[1];
    const { scanProject } = await import(pathToFileURL(path.join(repo, 'packages/cli/dist/index.js')).href);
  let peakHeap = 0;
  const sample = setInterval(() => (peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed)), 5);
  const start = process.hrtime.bigint();
  const { result } = await scanProject({ root: dir, useCache: true });
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  clearInterval(sample);
  peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
  process.stdout.write(
    JSON.stringify({
      ms,
      maxRssMb: process.resourceUsage().maxRSS / 1024,
      peakHeapMb: peakHeap / 1024 / 1024,
      stylesheets: result.summary.stylesheets,
      sourceFiles: result.summary.sourceFiles,
      selectors: result.summary.selectors,
      declarations: result.summary.declarations,
      findings: result.summary.findings,
      bytes: result.metrics.totalBytes,
      cache: result.meta.cache ?? null,
    }),
  );
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/* Project generator                                                   */
/* ------------------------------------------------------------------ */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLORS = ['#0047ab', '#1f2328', '#59636e', '#d8dee4', '#ffffff', '#b42318', '#b54708', '#0047ac', '#f6f8fa'];
const SPACES = ['4px', '8px', '12px', '16px', '24px', '32px', '0.5rem', '1rem', '1.5rem'];
const BREAKPOINTS = ['640px', '768px', '1024px', '1280px', '767px'];

function generate(dir, components, seed) {
  const r = rng(seed);
  const pick = (list) => list[Math.floor(r() * list.length)];
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, 'src/components'), { recursive: true });
  mkdirSync(path.join(dir, 'src/styles'), { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'bench', private: true, dependencies: { react: '19.0.0' } }));
  writeFileSync(path.join(dir, 'css-archaeology.config.json'), JSON.stringify({ cache: true }));

  const globalImports = [];
  const used = [];
  for (let i = 0; i < components; i++) {
    const name = `Component${i}`;
    const classes = Array.from({ length: 8 }, (_, j) => `part${j}`);
    let css = '';
    for (const [j, cls] of classes.entries()) {
      css += `.${cls} {\n  color: ${pick(COLORS)};\n  padding: ${pick(SPACES)} ${pick(SPACES)};\n  margin: ${pick(SPACES)};\n  display: flex;\n`;
      if (r() < 0.15) css += `  color: ${pick(COLORS)};\n`; // duplicate property
      css += `}\n`;
      if (j % 3 === 0) css += `.${cls}:hover { background: ${pick(COLORS)}; }\n`;
      if (r() < 0.3) css += `.${cls} .inner { & > span { font-size: ${pick(SPACES)}; } }\n`;
    }
    css += `@media (min-width: ${pick(BREAKPOINTS)}) {\n  .part0 { padding: ${pick(SPACES)}; }\n  .part1 { display: none; }\n}\n`;
    css += `.legacy${i} { float: left; }\n`; // never referenced
    writeFileSync(path.join(dir, `src/components/${name}.module.css`), css);
    const usedParts = classes.filter(() => r() < 0.85);
    const jsx = usedParts.map((c) => `      <div className={styles.${c}}><span className={styles.inner}>x</span></div>`).join('\n');
    writeFileSync(
      path.join(dir, `src/components/${name}.tsx`),
      `import styles from './${name}.module.css';\nimport clsx from 'clsx';\n\nexport function ${name}({ active }: { active: boolean }) {\n  return (\n    <section className={clsx('card', active && 'card--active', 'u-gap-${i % 20}')}>\n${jsx}\n    </section>\n  );\n}\n`,
    );
    used.push(name);
  }

  const sheets = Math.max(2, Math.ceil(components / 25));
  for (let s = 0; s < sheets; s++) {
    let css = `:root { --brand-${s}: ${pick(COLORS)}; }\n`;
    for (let k = 0; k < 40; k++) {
      css += `.u-gap-${(s * 40 + k) % 60} { gap: ${pick(SPACES)}; }\n`;
      css += `.card .title-${k} { font-weight: 600; color: ${pick(COLORS)}; }\n`;
      if (r() < 0.2) css += `#main .card .title-${k} { color: ${pick(COLORS)} !important; }\n`;
    }
    css += `.card { border: 1px solid ${pick(COLORS)}; border-radius: 6px; }\n.card--active { border-color: var(--brand-${s}); }\n`;
    const file = `src/styles/global-${s}.css`;
    writeFileSync(path.join(dir, file), css);
    globalImports.push(`import './styles/global-${s}.css';`);
  }
  writeFileSync(
    path.join(dir, 'src/main.tsx'),
    `${globalImports.join('\n')}\n${used.map((n) => `import { ${n} } from './components/${n}';`).join('\n')}\n\nexport const all = [${used.join(', ')}];\n`,
  );
}

/* ------------------------------------------------------------------ */
/* Driver                                                              */
/* ------------------------------------------------------------------ */
const CASES = { small: 50, medium: 400, large: 2000 };
const wanted = flag('cases', 'small,medium,large').split(',');
const runs = Number(flag('runs', '3'));
const work = path.join(os.tmpdir(), 'css-archaeology-bench');
const cli = path.join(repo, 'packages/cli/dist/index.js');
if (!existsSync(cli)) {
  console.error('Build first: npm run build');
  process.exit(1);
}

const measure = (dir, mode) => JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--measure', dir, mode], { encoding: 'utf8', maxBuffer: 1 << 26 }));
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const results = [];
for (const name of wanted) {
  const components = CASES[name];
  if (!components) throw new Error(`Unknown case ${name}`);
  const dir = path.join(work, name);
  generate(dir, components, 42);
  const cold = [];
  for (let i = 0; i < runs; i++) {
    rmSync(path.join(dir, '.css-archaeology'), { recursive: true, force: true });
    cold.push(measure(dir, 'cold'));
  }
  // Cold runs start without a cache and write one; the warm run reuses the last one.
  const warm = measure(dir, 'warm');
  rmSync(path.join(dir, '.css-archaeology'), { recursive: true, force: true });
  const sample = cold[0];
  const row = {
    case: name,
    files: sample.stylesheets + sample.sourceFiles,
    stylesheets: sample.stylesheets,
    sourceFiles: sample.sourceFiles,
    cssKb: sample.bytes / 1024,
    selectors: sample.selectors,
    declarations: sample.declarations,
    findings: sample.findings,
    coldMsMedian: median(cold.map((c) => c.ms)),
    coldMsAll: cold.map((c) => Math.round(c.ms)),
    warmMs: warm.ms,
    warmCache: warm.cache,
    maxRssMb: median(cold.map((c) => c.maxRssMb)),
    peakHeapMb: median(cold.map((c) => c.peakHeapMb)),
  };
  results.push(row);
  console.log(`${name.padEnd(7)} ${String(row.files).padStart(5)} files  cold ${row.coldMsMedian.toFixed(0)} ms  warm ${row.warmMs.toFixed(0)} ms  RSS ${row.maxRssMb.toFixed(0)} MB  ${row.findings} findings`);
}

const env = {
  date: new Date().toISOString(),
  node: process.version,
  platform: `${os.platform()} ${os.release()} ${os.arch()}`,
  cpu: `${os.cpus()[0]?.model ?? 'unknown'} × ${os.cpus().length}`,
  memoryGb: (os.totalmem() / 1024 ** 3).toFixed(1),
  runs,
};
mkdirSync(path.join(repo, 'bench-results'), { recursive: true });
writeFileSync(path.join(repo, 'bench-results/latest.json'), JSON.stringify({ env, results }, null, 2));

const md = `# Benchmarks

These numbers were **measured** by \`npm run bench\` (\`scripts/benchmark.mjs\`). They are not estimates.
Re-run the script on your own hardware; results vary with CPU, disk and Node version.

## Environment

| | |
|---|---|
| Date | ${env.date} |
| Node | ${env.node} |
| Platform | ${env.platform} |
| CPU | ${env.cpu} |
| Memory | ${env.memoryGb} GB |
| Runs per case | ${runs} cold (median reported) + 1 warm |

## Projects

Synthetic, deterministic (seed 42) React projects: each component has a CSS Module (8 classes, hover
states, nested rules, a media query, an unreferenced \`.legacy\` rule, occasional duplicate properties) and a
TSX file using \`styles.*\` and \`clsx(...)\`. Global stylesheets add utility classes, descendant selectors,
\`!important\` overrides and custom properties. Generation time is not included.

## Results

| Case | Files | Stylesheets | CSS | Selectors | Declarations | Findings | Cold scan (median) | Warm scan (cache) | Peak RSS | Peak heap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${results
  .map(
    (r) =>
      `| ${r.case} | ${r.files} | ${r.stylesheets} | ${r.cssKb.toFixed(0)} KB | ${r.selectors} | ${r.declarations} | ${r.findings} | ${r.coldMsMedian.toFixed(0)} ms | ${r.warmMs.toFixed(0)} ms | ${r.maxRssMb.toFixed(0)} MB | ${r.peakHeapMb.toFixed(0)} MB |`,
  )
  .join('\n')}

Individual cold runs (ms): ${results.map((r) => `${r.case} ${r.coldMsAll.join(', ')}`).join('; ')}.

"Cold" runs start with no cache. "Warm" runs reuse \`.css-archaeology/cache.json\` from the previous run, so
parsing and extraction are skipped for unchanged files; the analyzers always run on the whole project.
Times are wall-clock time for \`scanProject()\` (discovery, reading, parsing, extraction, analysis) in a fresh
Node process, excluding process start-up and report writing. Peak RSS is the process maximum, including
Node itself (about 40-50 MB).

## Limits of this benchmark

- The projects are synthetic. Real projects differ in selector shapes, file sizes and framework mix.
- Only one machine is measured per run of the script.
- The browser playground is not benchmarked here; it runs the same engine in a Web Worker.
`;
writeFileSync(path.join(repo, 'docs/benchmarks.md'), md);
console.log('Wrote docs/benchmarks.md and bench-results/latest.json');
