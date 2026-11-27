import type { AnalysisResult } from '@css-archaeology/core';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatBytes } from '@/lib/utils';
import { specificityText } from './severity';

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
        {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export function Dashboard({ result, onOpenFindings }: { result: AnalysisResult; onOpenFindings: () => void }) {
  const { summary, metrics, meta } = result;
  const sev = summary.bySeverity;
  const total = Math.max(1, summary.findings);
  const maxBucket = Math.max(1, ...metrics.sizeDistribution.map((b) => b.count));
  const rules = Object.entries(summary.byRule).sort((a, b) => b[1] - a[1]);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="CSS files" value={summary.stylesheets} hint={`${formatBytes(metrics.totalBytes)} · ${metrics.totalLines.toLocaleString()} lines`} />
        <Stat label="Selectors" value={summary.selectors.toLocaleString()} hint={`${metrics.uniqueSelectors.toLocaleString()} unique`} />
        <Stat label="Declarations" value={summary.declarations.toLocaleString()} hint={`${metrics.importantDeclarations} !important`} />
        <Stat label="Source files scanned" value={summary.sourceFiles} hint={meta.frameworks.join(', ') || 'no framework detected'} />
        <Stat label="Potentially unused selectors" value={summary.potentiallyUnusedSelectors} />
        <Stat label="Duplicate declarations" value={summary.duplicateDeclarations} />
        <Stat label="Specificity conflicts" value={summary.specificityConflicts} />
        <Stat label="Overridden declarations" value={summary.overriddenDeclarations} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Findings by severity</CardTitle>
            <CardDescription>Severity is impact; confidence is how sure the analysis is. They are separate.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(['high', 'medium', 'low', 'info'] as const).map((s) => (
              <div key={s} className="flex items-center gap-3 text-sm">
                <span className="w-14 capitalize text-muted-foreground">{s}</span>
                <div className="h-2 flex-1 rounded bg-muted">
                  <div className={`h-2 rounded ${s === 'high' ? 'bg-severity-high' : s === 'medium' ? 'bg-severity-medium' : s === 'low' ? 'bg-primary' : 'bg-muted-foreground/40'}`} style={{ width: `${(sev[s] / total) * 100}%` }} />
                </div>
                <span className="w-10 text-right tabular-nums">{sev[s]}</span>
              </div>
            ))}
            <div className="pt-2 text-xs text-muted-foreground">
              Confidence: {summary.byConfidence.high} high · {summary.byConfidence.medium} medium · {summary.byConfidence.low} low
            </div>
            <Button size="sm" variant="link" className="px-0" onClick={onOpenFindings}>
              Explore findings →
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Findings by rule</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <tbody>
                {rules.slice(0, 12).map(([rule, n]) => (
                  <tr key={rule} className="border-b border-border last:border-0">
                    <td className="py-1.5">
                      <code>{rule}</code>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{n}</td>
                  </tr>
                ))}
                {rules.length === 0 && (
                  <tr>
                    <td className="py-2 text-muted-foreground">No findings.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Stylesheet size distribution</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {metrics.sizeDistribution.map((b) => (
              <div key={b.label} className="flex items-center gap-3 text-sm">
                <span className="w-24 text-muted-foreground">{b.label}</span>
                <div className="h-2 flex-1 rounded bg-muted">
                  <div className="h-2 rounded bg-primary" style={{ width: `${(b.count / maxBucket) * 100}%` }} />
                </div>
                <span className="w-8 text-right tabular-nums">{b.count}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Most complex selectors</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-1 text-left font-medium">Selector</th>
                <th className="py-1 text-left font-medium">Specificity</th>
                <th className="py-1 pr-4 text-right font-medium">Compounds</th>
                <th className="py-1 pl-2 text-left font-medium">Location</th>
              </tr>
            </thead>
            <tbody>
              {metrics.mostComplexSelectors.map((c) => (
                <tr key={`${c.selector}-${c.file}-${c.line}`} className="border-t border-border">
                  <td className="py-1.5 pr-3">
                    <code className="break-all">{c.selector}</code>
                  </td>
                  <td className="py-1.5">
                    <code>{specificityText(c.specificity)}</code>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{c.compounds}</td>
                  <td className="py-1.5 pl-3 text-xs text-muted-foreground">
                    {c.file}:{c.line}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {(meta.notes.length > 0 || meta.filesSkipped.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>Analysis notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs text-muted-foreground">
            {meta.notes.map((n) => (
              <div key={n}>{n}</div>
            ))}
            {meta.filesSkipped.slice(0, 20).map((s) => (
              <div key={s.file}>
                Skipped <code>{s.file}</code>: {s.reason}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
