import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { CONFIG_FILE_NAMES, validateConfig, type ConfigIssue, type CssArchaeologyConfig } from '../config.js';

export interface LoadedConfig {
  config: CssArchaeologyConfig;
  /** Absolute path of the configuration file, or null when defaults are used. */
  path: string | null;
  warnings: ConfigIssue[];
}

export class ConfigFileError extends Error {
  readonly issues: ConfigIssue[];
  readonly file: string | null;
  constructor(message: string, file: string | null, issues: ConfigIssue[] = []) {
    super(message);
    this.name = 'ConfigFileError';
    this.file = file;
    this.issues = issues;
  }
}

export function findConfigFile(root: string): string | null {
  for (const name of CONFIG_FILE_NAMES) {
    const candidate = path.join(root, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Load configuration from JSON. JavaScript configuration files are deliberately not
 * supported: loading them would execute project code.
 */
export async function loadConfig(root: string, explicitPath?: string): Promise<LoadedConfig> {
  const file = explicitPath ? path.resolve(root, explicitPath) : findConfigFile(root);
  if (!file) {
    const result = validateConfig({});
    if (!result.ok) throw new ConfigFileError('Default configuration is invalid', null, result.issues);
    return { config: result.config, path: null, warnings: [] };
  }
  if (/\.(c|m)?[jt]s$/.test(file)) {
    throw new ConfigFileError(`${file}: JavaScript configuration is not supported because it would execute code. Use css-archaeology.config.json.`, file);
  }
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    throw new ConfigFileError(`Could not read ${file}: ${(error as Error).message}`, file);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ConfigFileError(`${file} is not valid JSON: ${(error as Error).message}`, file);
  }
  const result = validateConfig(raw);
  if (!result.ok) throw new ConfigFileError(`${file} is not a valid CSS Archaeology configuration`, file, result.issues);
  return { config: result.config, path: file, warnings: result.warnings };
}
