'use client';
import * as React from 'react';
import type { AnalysisResult } from '@css-archaeology/core';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatBytes } from '@/lib/utils';
import { specificityText } from './severity';

export function StylesheetExplorer({ result }: { result: AnalysisResult }) {
  const [sort, setSort] = React.useState<'file' | 'bytes' | 'rules' | 'findings'>('bytes');
  const rows = [...result.stylesheets].sort((a, b) => (sort === 'file' ? a.file.localeCompare(b.file) : sort === 'bytes' ? b.bytes - a.bytes : sort === 'rules' ? b.rules - a.rules : b.findings - a.findings));
  const max = Math.max(1, ...rows.map((r) => r.bytes));
  const h = (key: typeof sort, label: string) => (
    <button className={key === sort ? 'text-foreground' : ''} onClick={() => setSort(key)}>
      {label}
      {key === sort ? ' ↓' : ''}
    </button>
  );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{h('file', 'Stylesheet')}</TableHead>
          <TableHead>{h('bytes', 'Size')}</TableHead>
          <TableHead className="text-right">Lines</TableHead>
          <TableHead className="text-right">{h('rules', 'Rules')}</TableHead>
          <TableHead className="text-right">Selectors</TableHead>
          <TableHead className="text-right">Declarations</TableHead>
          <TableHead className="text-right">!important</TableHead>
          <TableHead>Avg / max specificity</TableHead>
          <TableHead className="text-right">Nesting</TableHead>
          <TableHead className="text-right">{h('findings', 'Findings')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((s) => (
          <TableRow key={s.file}>
            <TableCell>
              <code className="break-all">{s.file}</code>{' '}
              {s.isModule && <Badge variant="outline">module</Badge>} {s.syntax === 'scss' && <Badge variant="outline">scss</Badge>}{' '}
              {s.parseIssues > 0 && <Badge variant="medium">parse issues</Badge>}
            </TableCell>
            <TableCell className="min-w-36">
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-20 rounded bg-muted">
                  <div className="h-1.5 rounded bg-primary" style={{ width: `${(s.bytes / max) * 100}%` }} />
                </div>
                <span className="tabular-nums text-xs">{formatBytes(s.bytes)}</span>
              </div>
            </TableCell>
            <TableCell className="text-right tabular-nums">{s.lines}</TableCell>
            <TableCell className="text-right tabular-nums">{s.rules}</TableCell>
            <TableCell className="text-right tabular-nums">{s.selectors}</TableCell>
            <TableCell className="text-right tabular-nums">{s.declarations}</TableCell>
            <TableCell className="text-right tabular-nums">{s.importantDeclarations}</TableCell>
            <TableCell>
              <code>{specificityText(s.averageSpecificity)}</code> / <code>{specificityText(s.maxSpecificity)}</code>
            </TableCell>
            <TableCell className="text-right tabular-nums">{s.maxNestingDepth}</TableCell>
            <TableCell className="text-right tabular-nums">{s.findings}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
