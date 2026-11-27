// Bundles the example projects into the playground so it can demo without uploads.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const samples = { 'html-site': 'Plain HTML and CSS', 'react-app': 'React + CSS Modules', 'next-app': 'Next.js app router', 'tailwind-app': 'Tailwind CSS' };

async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p, base)));
    else out.push({ path: path.relative(base, p).split(path.sep).join('/'), content: await readFile(p, 'utf8') });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

const data = [];
for (const [id, title] of Object.entries(samples)) data.push({ id, title, files: await walk(path.join(root, 'examples', id)) });
await writeFile(path.join(root, 'apps/playground/src/lib/samples.json'), JSON.stringify(data, null, 1) + '\n');
console.log(`Wrote ${data.length} samples`);
