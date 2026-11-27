'use client';
import * as React from 'react';
import type { AnalysisResult, TokenCategory } from '@css-archaeology/core';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const CATEGORIES: { id: TokenCategory; label: string }[] = [
  { id: 'color', label: 'Colour' },
  { id: 'spacing', label: 'Spacing' },
  { id: 'typography', label: 'Typography' },
  { id: 'radius', label: 'Border radius' },
  { id: 'shadow', label: 'Shadows' },
  { id: 'breakpoint', label: 'Breakpoints' },
];

/** Swatch colour only for literal colour syntax we produced ourselves; never arbitrary CSS. */
function safeSwatch(value: string): string | null {
  return /^(#[0-9a-f]{3,8}|(rgba?|hsla?)\([\d\s.,%/]+\)|[a-z]+)$/i.test(value) ? value : null;
}

export function TokenExplorer({ result }: { result: AnalysisResult }) {
  const [cat, setCat] = React.useState<TokenCategory>('color');
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c.id, result.tokens.filter((t) => t.category === c.id).length]));
  return (
    <Tabs value={cat} onValueChange={(v) => setCat(v as TokenCategory)}>
      <TabsList>
        {CATEGORIES.map((c) => (
          <TabsTrigger key={c.id} value={c.id}>
            {c.label} <span className="text-xs text-muted-foreground">{counts[c.id]}</span>
          </TabsTrigger>
        ))}
      </TabsList>
      {CATEGORIES.map((c) => (
        <TabsContent key={c.id} value={c.id}>
          <p className="mb-2 text-xs text-muted-foreground">Values grouped by frequency. CSS Archaeology never introduces or replaces CSS variables.</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Value</TableHead>
                <TableHead className="text-right">Uses</TableHead>
                <TableHead>Properties</TableHead>
                <TableHead>Defined as variable</TableHead>
                <TableHead>Example locations</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.tokens
                .filter((t) => t.category === c.id)
                .sort((a, b) => b.count - a.count)
                .slice(0, 300)
                .map((t) => {
                  const swatch = c.id === 'color' ? safeSwatch(t.value) : null;
                  return (
                    <TableRow key={t.value}>
                      <TableCell>
                        <span className="inline-flex items-center gap-2">
                          {swatch && <span className="inline-block size-4 rounded border border-border" style={{ background: swatch }} />}
                          <code className="break-all">{t.value}</code>
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{t.count}</TableCell>
                      <TableCell className="text-xs">{t.properties.join(', ')}</TableCell>
                      <TableCell className="text-xs">{t.definedAs.length ? <code>{t.definedAs.join(', ')}</code> : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {t.locations.slice(0, 2).map((l) => (
                          <div key={`${l.file}:${l.line}:${l.column}`}>
                            {l.file}:{l.line}
                          </div>
                        ))}
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </TabsContent>
      ))}
    </Tabs>
  );
}
