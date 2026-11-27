'use client';
import * as React from 'react';
import type { AnalysisResult } from '@css-archaeology/core';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { specificityText } from './severity';

const cmp = (a: number[], b: number[]) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;

export function SelectorExplorer({ result, initialQuery }: { result: AnalysisResult; initialQuery: string }) {
  const [query, setQuery] = React.useState(initialQuery);
  const [sort, setSort] = React.useState<'selector' | 'specificity' | 'occurrences' | 'findings'>('specificity');
  const byId = React.useMemo(() => new Map(result.findings.map((f) => [f.id, f])), [result]);
  const rows = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = result.selectors.filter((s) => !q || s.selector.toLowerCase().includes(q) || s.files.some((f) => f.toLowerCase().includes(q)));
    return [...list].sort((a, b) => {
      if (sort === 'selector') return a.selector.localeCompare(b.selector);
      if (sort === 'occurrences') return b.occurrences - a.occurrences;
      if (sort === 'findings') return b.findingIds.length - a.findingIds.length;
      return cmp(b.specificity, a.specificity);
    });
  }, [result, query, sort]);
  const header = (key: typeof sort, label: string) => (
    <button className={key === sort ? 'text-foreground' : ''} onClick={() => setSort(key)}>
      {label}
      {key === sort ? ' ↓' : ''}
    </button>
  );
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input className="max-w-sm" placeholder="Filter selectors or files…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter selectors" />
        <span className="text-xs text-muted-foreground">
          {rows.length} of {result.selectors.length} unique selectors
        </span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{header('selector', 'Selector')}</TableHead>
            <TableHead>{header('specificity', 'Specificity')}</TableHead>
            <TableHead className="text-right">{header('occurrences', 'Occurrences')}</TableHead>
            <TableHead>Source files</TableHead>
            <TableHead>{header('findings', 'Associated findings')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, 1000).map((s) => (
            <TableRow key={s.selector}>
              <TableCell>
                <code className="break-all">{s.selector}</code>
              </TableCell>
              <TableCell>
                <code>{specificityText(s.specificity)}</code>
              </TableCell>
              <TableCell className="text-right tabular-nums">{s.occurrences}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {s.locations.slice(0, 3).map((l) => (
                  <div key={`${l.file}:${l.line}`}>
                    {l.file}:{l.line}
                  </div>
                ))}
                {s.locations.length > 3 && <div>+{s.occurrences - 3} more</div>}
              </TableCell>
              <TableCell className="text-xs">
                {s.findingIds.map((id) => (
                  <div key={id}>
                    <code>{id}</code> <span className="text-muted-foreground">{byId.get(id)?.rule}</span>
                  </div>
                ))}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
