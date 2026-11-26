'use client';
import * as React from 'react';
import type { AnalysisResult, Finding } from '@css-archaeology/core';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ConfidenceLabel, SeverityBadge } from './severity';

const SEV = ['info', 'low', 'medium', 'high'];
const CONF = ['low', 'medium', 'high'];

function Detail({ f, onSelector }: { f: Finding; onSelector: (s: string) => void }) {
  return (
    <div className="space-y-3 rounded-md bg-muted/50 p-3 text-sm">
      <p>{f.description}</p>
      {f.approximate && <p className="text-xs text-severity-medium">Approximate: complete browser cascade evaluation is not possible statically.</p>}
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Evidence</div>
        <ul className="space-y-1">
          {f.evidence.map((e, i) => (
            <li key={i} className="text-xs">
              {e.message}
              {e.snippet && (
                <>
                  {' '}
                  <code className="rounded bg-background px-1">{e.snippet}</code>
                </>
              )}
              {e.file && (
                <span className="text-muted-foreground">
                  {' '}
                  · {e.file}
                  {e.line ? `:${e.line}` : ''}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
      {f.confidenceFactors.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Confidence factors</div>
          <ul className="space-y-0.5 text-xs">
            {f.confidenceFactors.map((c) => (
              <li key={c.factor}>
                <code>{c.effect >= 0 ? '+' : ''}{c.effect.toFixed(2)}</code> {c.detail}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Suggested remediation</div>
        <p className="text-xs">{f.suggestion}</p>
      </div>
      {f.selector && (
        <button className="text-xs text-primary hover:underline" onClick={() => onSelector(f.selector!.split(', ')[0]!)}>
          View selector in the selector explorer →
        </button>
      )}
    </div>
  );
}

export function FindingsExplorer({ result, onSelector }: { result: AnalysisResult; onSelector: (s: string) => void }) {
  const [query, setQuery] = React.useState('');
  const [analyzer, setAnalyzer] = React.useState('');
  const [severity, setSeverity] = React.useState('');
  const [confidence, setConfidence] = React.useState('');
  const [sort, setSort] = React.useState<'location' | 'severity'>('location');
  const [open, setOpen] = React.useState<string | null>(null);
  const analyzers = React.useMemo(() => [...new Set(result.findings.map((f) => f.analyzer))].sort(), [result]);

  const rows = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = result.findings.filter(
      (f) =>
        (!analyzer || f.analyzer === analyzer || f.rule === analyzer) &&
        (!severity || SEV.indexOf(f.severity) >= SEV.indexOf(severity)) &&
        (!confidence || CONF.indexOf(f.confidence) >= CONF.indexOf(confidence)) &&
        (!q || [f.id, f.title, f.description, f.file, f.selector ?? '', f.rule, f.property ?? ''].some((v) => v.toLowerCase().includes(q))),
    );
    return sort === 'severity'
      ? [...list].sort((a, b) => SEV.indexOf(b.severity) - SEV.indexOf(a.severity) || a.file.localeCompare(b.file) || a.line - b.line)
      : [...list].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  }, [result, query, analyzer, severity, confidence, sort]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input className="max-w-sm" placeholder="Search id, selector, file, property…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search findings" />
        <Select value={analyzer} onChange={(e) => setAnalyzer(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {analyzers.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
        <Select value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Minimum severity">
          <option value="">Any severity</option>
          <option value="high">High</option>
          <option value="medium">Medium and above</option>
          <option value="low">Low and above</option>
        </Select>
        <Select value={confidence} onChange={(e) => setConfidence(e.target.value)} aria-label="Minimum confidence">
          <option value="">Any confidence</option>
          <option value="high">High</option>
          <option value="medium">Medium and above</option>
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value as 'location' | 'severity')} aria-label="Sort">
          <option value="location">Sort by file and line</option>
          <option value="severity">Sort by severity</option>
        </Select>
        <span className="self-center text-xs text-muted-foreground">
          {rows.length} of {result.findings.length}
        </span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>Severity</TableHead>
            <TableHead>Confidence</TableHead>
            <TableHead>Finding</TableHead>
            <TableHead>Location</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, 500).map((f) => (
            <React.Fragment key={f.id}>
              <TableRow className="cursor-pointer" data-state={open === f.id ? 'selected' : undefined} onClick={() => setOpen(open === f.id ? null : f.id)}>
                <TableCell>
                  <code>{f.id}</code>
                </TableCell>
                <TableCell>
                  <SeverityBadge severity={f.severity} />
                </TableCell>
                <TableCell>
                  <ConfidenceLabel finding={f} />
                </TableCell>
                <TableCell>
                  <div className="font-medium">{f.title}</div>
                  <div className="text-xs text-muted-foreground">
                    <code>{f.rule}</code>
                    {f.selector && (
                      <>
                        {' · '}
                        <code className="break-all">{f.selector}</code>
                      </>
                    )}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {f.file}:{f.line}
                </TableCell>
              </TableRow>
              {open === f.id && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5}>
                    <Detail f={f} onSelector={onSelector} />
                  </TableCell>
                </TableRow>
              )}
            </React.Fragment>
          ))}
        </TableBody>
      </Table>
      {rows.length > 500 && <p className="text-xs text-muted-foreground">Showing the first 500 matches. Narrow the filters or export the report.</p>}
    </div>
  );
}
