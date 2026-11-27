import { formatSpecificity } from '../selectors.js';
import type { AnalysisResult, Finding, TokenCategory } from '../types.js';

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

const STYLE = `
:root{--bg:#fff;--fg:#1f2328;--muted:#59636e;--line:#d8dee4;--soft:#f6f8fa;--accent:#0047ab;--accent-soft:#e8effa;--high:#b42318;--medium:#b54708;--low:#475467;--info:#475467}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
header{border-bottom:1px solid var(--line);padding:20px 32px;display:flex;justify-content:space-between;align-items:baseline;gap:16px;flex-wrap:wrap}
header h1{margin:0;font-size:18px}header .brand{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.08em}
main{padding:24px 32px;max-width:1400px;margin:0 auto}h2{font-size:15px;margin:32px 0 12px;border-bottom:1px solid var(--line);padding-bottom:6px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px}.stat{border:1px solid var(--line);border-radius:6px;padding:12px 14px}
.stat b{display:block;font-size:22px;font-variant-numeric:tabular-nums}.stat span{color:var(--muted);font-size:12px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{background:var(--soft);font-weight:600;position:sticky;top:0}td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
code{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--soft);padding:1px 4px;border-radius:4px;word-break:break-word}
.badge{display:inline-block;border:1px solid currentColor;border-radius:999px;padding:0 8px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.03em}
.sev-high{color:var(--high)}.sev-medium{color:var(--medium)}.sev-low{color:var(--low)}.sev-info{color:var(--info)}
.conf{color:var(--accent)}.muted{color:var(--muted)}.filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.filters input,.filters select{font:inherit;border:1px solid var(--line);border-radius:6px;padding:6px 10px;background:#fff;color:var(--fg)}
.filters input{min-width:260px}details summary{cursor:pointer;color:var(--accent)}ul.evidence{margin:6px 0 0;padding-left:18px}
.note{background:var(--accent-soft);border-left:3px solid var(--accent);padding:10px 14px;border-radius:4px;margin:12px 0}
footer{color:var(--muted);font-size:12px;padding:24px 32px;border-top:1px solid var(--line);margin-top:32px}
`;

const SCRIPT = `
(function(){var q=document.getElementById('q'),s=document.getElementById('sev'),c=document.getElementById('conf'),r=document.getElementById('rule'),n=document.getElementById('count');
var rows=[].slice.call(document.querySelectorAll('tr[data-finding]'));var rank={info:0,low:1,medium:2,high:3};
function apply(){var t=q.value.toLowerCase(),sv=s.value,cv=c.value,rv=r.value,shown=0;rows.forEach(function(row){var ok=(!t||row.textContent.toLowerCase().indexOf(t)>=0)&&(!sv||rank[row.dataset.severity]>=rank[sv])&&(!cv||rank[row.dataset.confidence]>=rank[cv])&&(!rv||row.dataset.rule===rv);row.hidden=!ok;if(ok)shown++;});n.textContent=shown+' of '+rows.length+' findings shown';}
[q,s,c,r].forEach(function(el){el.addEventListener('input',apply);});apply();})();
`;

function findingRow(f: Finding): string {
  const loc = `${escapeHtml(f.file)}:${f.line}`;
  const evidence = f.evidence
    .map((e) => {
      const where = e.file ? ` <span class="muted">${escapeHtml(e.file)}${e.line ? ':' + e.line : ''}</span>` : '';
      const snippet = e.snippet ? ` <code>${escapeHtml(e.snippet)}</code>` : '';
      return `<li>${escapeHtml(e.message)}${snippet}${where}</li>`;
    })
    .join('');
  const factors = f.confidenceFactors
    .map((x) => `<li>${x.effect >= 0 ? '+' : ''}${x.effect.toFixed(2)} ${escapeHtml(x.detail)}</li>`)
    .join('');
  return `<tr data-finding data-severity="${escapeHtml(f.severity)}" data-confidence="${escapeHtml(f.confidence)}" data-rule="${escapeHtml(f.rule)}">
<td><code>${escapeHtml(f.id)}</code></td>
<td><span class="badge sev-${escapeHtml(f.severity)}">${escapeHtml(f.severity)}</span></td>
<td><span class="conf">${escapeHtml(f.confidence)}</span> <span class="muted">${f.confidenceScore.toFixed(2)}</span></td>
<td><code>${escapeHtml(f.rule)}</code></td>
<td><strong>${escapeHtml(f.title)}</strong>${f.approximate ? ' <span class="muted">(approximate)</span>' : ''}<br>${escapeHtml(f.description)}
${f.selector ? `<br><code>${escapeHtml(f.selector)}</code>` : ''}
<details><summary>Evidence and suggestion</summary><ul class="evidence">${evidence}</ul>
${factors ? `<p class="muted">Confidence factors:</p><ul class="evidence">${factors}</ul>` : ''}
<p><strong>Suggestion:</strong> ${escapeHtml(f.suggestion)}</p></details></td>
<td><code>${loc}</code></td></tr>`;
}

const TOKEN_LABELS: Record<TokenCategory, string> = {
  color: 'Colours',
  spacing: 'Spacing',
  typography: 'Typography',
  radius: 'Border radii',
  shadow: 'Shadows',
  breakpoint: 'Breakpoints',
};

export function toHtmlReport(result: AnalysisResult): string {
  const { summary, metrics, meta } = result;
  const stats: [string, number | string][] = [
    ['CSS files', summary.stylesheets],
    ['Source files scanned', summary.sourceFiles],
    ['Selectors', summary.selectors],
    ['Declarations', summary.declarations],
    ['Total CSS size', formatBytes(metrics.totalBytes)],
    ['Findings', summary.findings],
    ['Potentially unused selectors', summary.potentiallyUnusedSelectors],
    ['Duplicate declarations', summary.duplicateDeclarations],
    ['Specificity conflicts', summary.specificityConflicts],
    ['Overridden declarations', summary.overriddenDeclarations],
  ];
  const rules = Object.keys(summary.byRule).sort();
  const tokensByCategory = new Map<TokenCategory, typeof result.tokens>();
  for (const t of result.tokens) {
    if (t.count < 2) continue;
    const list = tokensByCategory.get(t.category) ?? [];
    list.push(t);
    tokensByCategory.set(t.category, list);
  }
  const tokenSections = [...tokensByCategory.entries()]
    .map(
      ([cat, list]) => `<h3>${escapeHtml(TOKEN_LABELS[cat])}</h3><table><thead><tr><th>Value</th><th class="num">Uses</th><th>Properties</th><th>Defined as</th></tr></thead><tbody>
${list
  .slice(0, 30)
  .map(
    (t) =>
      `<tr><td><code>${escapeHtml(t.value)}</code></td><td class="num">${t.count}</td><td>${escapeHtml(t.properties.join(', '))}</td><td>${t.definedAs.length ? `<code>${escapeHtml(t.definedAs.join(', '))}</code>` : '<span class="muted">not tokenised</span>'}</td></tr>`,
  )
  .join('')}</tbody></table>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>CSS Archaeology report</title><style>${STYLE}</style></head>
<body><header><div><div class="brand">Workfonic Labs · CSS Archaeology</div><h1>CSS analysis report</h1></div>
<div class="muted">Generated ${escapeHtml(meta.generatedAt)} · v${escapeHtml(meta.version)} · ${escapeHtml(meta.root)}</div></header>
<main>
<div class="note">Findings are produced by static analysis. "Potentially unused" selectors may still be used by runtime-generated markup, third-party code or dynamic class names. Review the evidence before removing anything. CSS Archaeology never modifies source files.</div>
<h2>Summary</h2><div class="grid">${stats.map(([k, v]) => `<div class="stat"><b>${escapeHtml(v)}</b><span>${escapeHtml(k)}</span></div>`).join('')}</div>
<h2>Findings</h2>
<div class="filters"><input id="q" type="search" placeholder="Search findings, selectors, files" aria-label="Search findings">
<select id="sev" aria-label="Minimum severity"><option value="">Any severity</option><option value="high">High</option><option value="medium">Medium and above</option><option value="low">Low and above</option></select>
<select id="conf" aria-label="Minimum confidence"><option value="">Any confidence</option><option value="high">High</option><option value="medium">Medium and above</option></select>
<select id="rule" aria-label="Rule"><option value="">All rules</option>${rules.map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(r)} (${summary.byRule[r]})</option>`).join('')}</select>
<span id="count" class="muted"></span></div>
<table><thead><tr><th>ID</th><th>Severity</th><th>Confidence</th><th>Rule</th><th>Finding</th><th>Location</th></tr></thead>
<tbody>${result.findings.map(findingRow).join('\n')}</tbody></table>
<h2>Stylesheets</h2><table><thead><tr><th>File</th><th class="num">Size</th><th class="num">Lines</th><th class="num">Rules</th><th class="num">Selectors</th><th class="num">Declarations</th><th class="num">!important</th><th>Max specificity</th><th class="num">Findings</th></tr></thead><tbody>
${result.stylesheets
  .map(
    (s) =>
      `<tr><td><code>${escapeHtml(s.file)}</code>${s.isModule ? ' <span class="muted">module</span>' : ''}</td><td class="num">${formatBytes(s.bytes)}</td><td class="num">${s.lines}</td><td class="num">${s.rules}</td><td class="num">${s.selectors}</td><td class="num">${s.declarations}</td><td class="num">${s.importantDeclarations}</td><td><code>${formatSpecificity(s.maxSpecificity)}</code></td><td class="num">${s.findings}</td></tr>`,
  )
  .join('')}</tbody></table>
<h2>Most complex selectors</h2><table><thead><tr><th>Selector</th><th>Specificity</th><th class="num">Compounds</th><th>Location</th></tr></thead><tbody>
${metrics.mostComplexSelectors
  .map(
    (c) =>
      `<tr><td><code>${escapeHtml(c.selector)}</code></td><td><code>${formatSpecificity(c.specificity)}</code></td><td class="num">${c.compounds}</td><td><code>${escapeHtml(c.file)}:${c.line}</code></td></tr>`,
  )
  .join('')}</tbody></table>
<h2>Repeated values (design token candidates)</h2>${tokenSections || '<p class="muted">No repeated values found.</p>'}
${meta.notes.length ? `<h2>Notes</h2><ul>${meta.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>` : ''}
${meta.filesSkipped.length ? `<h2>Skipped files</h2><ul>${meta.filesSkipped.map((s) => `<li><code>${escapeHtml(s.file)}</code> ${escapeHtml(s.reason)}</li>`).join('')}</ul>` : ''}
</main><footer>CSS Archaeology by Workfonic Labs · Frameworks: ${escapeHtml(meta.frameworks.join(', ') || 'none detected')} · Analyzers: ${escapeHtml(meta.analyzers.join(', '))} · ${meta.durationMs} ms</footer>
<script>${SCRIPT}</script></body></html>
`;
}
