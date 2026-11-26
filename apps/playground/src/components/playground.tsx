'use client';

import * as React from 'react';
import { Download, FileArchive, FolderOpen, Loader2, ShieldCheck } from 'lucide-react';
import type { AnalysisResult } from '@css-archaeology/core';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArchiveError, LIMITS, extractZip, readFileList, type ExtractResult } from '@/lib/zip';
import type { WorkerRequest, WorkerResponse } from '@/lib/analysis.worker';
import samples from '@/lib/samples.json';
import { Dashboard } from './dashboard';
import { FindingsExplorer } from './findings-explorer';
import { SelectorExplorer } from './selector-explorer';
import { StylesheetExplorer } from './stylesheet-explorer';
import { TokenExplorer } from './token-explorer';

type State =
  | { status: 'idle' }
  | { status: 'working'; label: string }
  | { status: 'done'; result: AnalysisResult; json: string; html: string; name: string }
  | { status: 'error'; message: string };

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Playground() {
  const [state, setState] = React.useState<State>({ status: 'idle' });
  const [tab, setTab] = React.useState('dashboard');
  const [focusSelector, setFocusSelector] = React.useState<string | null>(null);
  const workerRef = React.useRef<Worker | null>(null);
  const folderInput = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => () => workerRef.current?.terminate(), []);

  const analyse = React.useCallback((extracted: ExtractResult, name: string) => {
    if (extracted.files.length === 0) {
      setState({ status: 'error', message: 'No CSS, HTML or script files were found in the upload.' });
      return;
    }
    workerRef.current?.terminate();
    const worker = new Worker(new URL('../lib/analysis.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    setState({ status: 'working', label: `Analysing ${extracted.files.length} files…` });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.type === 'progress') setState({ status: 'working', label: `${msg.phase} ${msg.current}/${msg.total}` });
      else if (msg.type === 'error') setState({ status: 'error', message: msg.message });
      else {
        setState({ status: 'done', result: msg.result, json: msg.json, html: msg.html, name });
        setTab('dashboard');
        worker.terminate();
      }
    };
    worker.onerror = (e) => setState({ status: 'error', message: e.message || 'The analysis worker failed.' });
    worker.postMessage({ type: 'analyze', files: extracted.files, skipped: extracted.skipped, name } satisfies WorkerRequest);
  }, []);

  const onZip = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (file.size > LIMITS.maxArchiveBytes) throw new ArchiveError(`The archive is larger than ${LIMITS.maxArchiveBytes / 1024 / 1024} MB. Use the CLI for large projects.`);
      setState({ status: 'working', label: 'Reading archive…' });
      const data = new Uint8Array(await file.arrayBuffer());
      analyse(extractZip(data), file.name.replace(/\.zip$/i, ''));
    } catch (error) {
      setState({ status: 'error', message: (error as Error).message });
    }
  };

  const onFolder = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    try {
      setState({ status: 'working', label: 'Reading folder…' });
      const first = (list[0] as File & { webkitRelativePath?: string }).webkitRelativePath?.split('/')[0] ?? 'project';
      analyse(await readFileList(list), first);
    } catch (error) {
      setState({ status: 'error', message: (error as Error).message });
    }
  };

  const onSample = (id: string) => {
    const sample = samples.find((s) => s.id === id);
    if (sample) analyse({ files: sample.files, skipped: [], totalBytes: 0 }, sample.id);
  };

  const showSelector = (selector: string) => {
    setFocusSelector(selector);
    setTab('selectors');
  };

  return (
    <div className="mx-auto max-w-[1400px] px-6 pb-16">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border py-5">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Workfonic Labs</div>
          <h1 className="text-xl font-semibold">CSS Archaeology</h1>
          <p className="text-sm text-muted-foreground">Understand your CSS. Find what is hiding beneath it.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <FileArchive className="size-4" /> Upload ZIP
            <input type="file" accept=".zip,application/zip" className="sr-only" onChange={(e) => onZip(e.target.files?.[0])} />
          </label>
          <Button variant="outline" onClick={() => folderInput.current?.click()}>
            <FolderOpen /> Choose folder
          </Button>
          <input
            ref={folderInput}
            type="file"
            className="hidden"
            multiple
            onChange={(e) => onFolder(e.target.files)}
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
          />
          <Select aria-label="Load a sample project" defaultValue="" onChange={(e) => e.target.value && onSample(e.target.value)}>
            <option value="">Load a sample…</option>
            {samples.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </Select>
        </div>
      </header>

      <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5 text-primary" />
        Files are read and analysed in your browser. Nothing is uploaded, no project code is executed, and source files are never modified. Limits: {LIMITS.maxArchiveBytes / 1024 / 1024} MB archive,{' '}
        {LIMITS.maxFileBytes / 1024 / 1024} MB per file, {LIMITS.maxEntries.toLocaleString()} entries. Use the CLI for larger projects.
      </p>

      {state.status === 'idle' && (
        <div className="mt-10 rounded-lg border border-dashed border-border p-10 text-center">
          <h2 className="text-base font-semibold">Analyse a frontend project</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
            Upload a ZIP of your repository, choose a folder, or load a sample. CSS Archaeology finds potentially unused selectors, duplicate and overridden declarations,
            specificity conflicts, media query issues and repeated values, with the evidence behind every finding.
          </p>
        </div>
      )}
      {state.status === 'working' && (
        <div className="mt-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> {state.label}
        </div>
      )}
      {state.status === 'error' && (
        <div role="alert" className="mt-6 rounded-md border border-severity-high/30 bg-severity-high/5 p-4 text-sm text-severity-high">
          {state.message}
        </div>
      )}
      {state.status === 'done' && (
        <Tabs value={tab} onValueChange={setTab} className="mt-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <TabsList>
              <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
              <TabsTrigger value="findings">Findings ({state.result.findings.length})</TabsTrigger>
              <TabsTrigger value="selectors">Selectors</TabsTrigger>
              <TabsTrigger value="stylesheets">Stylesheets</TabsTrigger>
              <TabsTrigger value="tokens">Design tokens</TabsTrigger>
            </TabsList>
            <div className="flex gap-2 pb-1">
              <Button variant="outline" size="sm" onClick={() => download(`${state.name}-css-archaeology.json`, state.json, 'application/json')}>
                <Download /> JSON
              </Button>
              <Button variant="outline" size="sm" onClick={() => download(`${state.name}-css-archaeology.html`, state.html, 'text/html')}>
                <Download /> HTML
              </Button>
            </div>
          </div>
          <TabsContent value="dashboard">
            <Dashboard result={state.result} onOpenFindings={() => setTab('findings')} />
          </TabsContent>
          <TabsContent value="findings">
            <FindingsExplorer result={state.result} onSelector={showSelector} />
          </TabsContent>
          <TabsContent value="selectors">
            <SelectorExplorer result={state.result} initialQuery={focusSelector ?? ''} />
          </TabsContent>
          <TabsContent value="stylesheets">
            <StylesheetExplorer result={state.result} />
          </TabsContent>
          <TabsContent value="tokens">
            <TokenExplorer result={state.result} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
