import path from 'node:path';
import { analyzeProject, type AnalysisResult, type CssArchaeologyConfig, type ProgressEvent } from '@css-archaeology/core';
import { discoverFiles, FileCache, loadConfig } from '@css-archaeology/core/node';
import { defaultAnalyzers } from '@css-archaeology/analyzers';
import { adapterExtensions, defaultAdapters } from '@css-archaeology/framework-adapters';

export interface ScanOptions {
  root: string;
  configPath?: string;
  /** Overrides merged over the loaded configuration (already validated values). */
  overrides?: Partial<CssArchaeologyConfig>;
  useCache?: boolean;
  onProgress?: (event: ProgressEvent | { phase: 'discover'; current: number; total: number }) => void;
  now?: () => Date;
}

export interface ScanOutcome {
  result: AnalysisResult;
  config: CssArchaeologyConfig;
  configPath: string | null;
  warnings: string[];
}

/** Discover, read and analyse a project directory. Read-only apart from the cache file. */
export async function scanProject(options: ScanOptions): Promise<ScanOutcome> {
  const root = path.resolve(options.root);
  const loaded = await loadConfig(root, options.configPath);
  const config: CssArchaeologyConfig = { ...loaded.config, ...options.overrides };
  options.onProgress?.({ phase: 'discover', current: 0, total: 0 });
  const discovery = await discoverFiles({ root, config, extensions: adapterExtensions(defaultAdapters) });
  const useCache = options.useCache !== false && config.cache;
  const cache = useCache ? await FileCache.load(path.join(root, config.outputDir, 'cache.json')) : undefined;
  const result = await analyzeProject({
    files: discovery.files,
    config,
    analyzers: defaultAnalyzers,
    adapters: defaultAdapters,
    root: path.basename(root),
    ...(cache ? { cache } : {}),
    skipped: discovery.skipped,
    filesDiscovered: discovery.discovered,
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  if (cache) await cache.save();
  return { result, config, configPath: loaded.path, warnings: loaded.warnings.map((w) => `${w.path}: ${w.message}`) };
}
