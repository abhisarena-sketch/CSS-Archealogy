#!/usr/bin/env node
/** Writes docs/rules.md from the rule metadata in the built analyzers (run `npm run build` first). */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allRules } from '../packages/analyzers/dist/index.js';
import { CORE_RULES } from '../packages/core/dist/index.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seen = new Set();
const rules = [...allRules(), ...CORE_RULES.map((r) => ({ ...r, analyzer: 'parser' }))].filter((r) => !seen.has(r.id) && seen.add(r.id));
const analyzerKey = {
  'unused-selectors': 'unusedSelectors',
  'duplicate-declarations': 'duplicateDeclarations',
  specificity: 'specificityConflicts',
  'overridden-declarations': 'overriddenDeclarations',
  'media-queries': 'mediaQueries',
  'design-tokens': 'designTokens',
  complexity: 'complexity',
};

let md = `# Rules

Generated from the rule metadata by \`node scripts/generate-rules-doc.mjs\`. Run
\`css-archaeology explain <rule-id>\` for the same information in a terminal.

Each rule has a default **severity** (how much the issue matters). **Confidence** (how sure the analysis is that
the finding is real) is computed per finding from evidence and is listed in every finding with the factors that
raised or lowered it. See [configuration](configuration.md#rules) to turn rules off, change severity or set options.

| Rule | Analyzer (\`analysis\` key) | Default severity |
|---|---|---|
${rules.map((r) => `| [\`${r.id}\`](#${r.id}) | ${r.analyzer}${analyzerKey[r.analyzer] ? ` (\`${analyzerKey[r.analyzer]}\`)` : ''} | ${r.defaultSeverity} |`).join('\n')}
`;
for (const r of rules) {
  md += `\n## ${r.id}\n\n**${r.title}.** ${r.description}\n\n- Analyzer: \`${r.analyzer}\`\n- Default severity: \`${r.defaultSeverity}\`\n`;
  if (r.optionsSchema) {
    const defaults = r.optionsSchema.parse({});
    md += `- Options (defaults):\n${Object.entries(defaults)
      .map(([k, v]) => `  - \`${k}\`: \`${JSON.stringify(v)}\``)
      .join('\n')}\n`;
  }
  if (r.rationale) md += `\n${r.rationale}\n`;
}
writeFileSync(path.join(repo, 'docs/rules.md'), md);
console.log(`Wrote docs/rules.md (${rules.length} rules)`);
