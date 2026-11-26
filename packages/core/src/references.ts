import type { FileReferences, ProjectReferences, ReferenceOccurrence } from './types.js';

export function emptyFileReferences(file: string, adapter: string): FileReferences {
  return {
    file,
    adapter,
    classes: {},
    ids: {},
    elements: {},
    attributes: {},
    tokens: [],
    dynamicPatterns: [],
    unresolved: [],
    cssModules: [],
    stylesheetImports: [],
    embeddedStylesheets: [],
    notes: [],
  };
}

const MAX_OCCURRENCES_PER_NAME = 25;

export function addReference(
  bucket: Record<string, ReferenceOccurrence[]>,
  name: string,
  occurrence: ReferenceOccurrence,
): void {
  if (!name) return;
  // Own-property check guards against names such as `constructor` or `__proto__`.
  const list = Object.prototype.hasOwnProperty.call(bucket, name) ? bucket[name]! : (bucket[name] = []);
  if (list.length < MAX_OCCURRENCES_PER_NAME) list.push(occurrence);
}

export function emptyProjectReferences(): ProjectReferences {
  return {
    classes: new Map(),
    ids: new Map(),
    elements: new Map(),
    attributes: new Map(),
    tokens: new Map(),
    dynamicPatterns: [],
    unresolved: [],
    cssModules: [],
    stylesheetImports: [],
    sourceFileCount: 0,
    adapterFiles: {},
  };
}

function mergeBucket(target: Map<string, ReferenceOccurrence[]>, source: Record<string, ReferenceOccurrence[]>) {
  for (const name of Object.keys(source)) {
    const list = target.get(name);
    const add = source[name]!;
    if (!list) target.set(name, add.slice(0, MAX_OCCURRENCES_PER_NAME));
    else if (list.length < MAX_OCCURRENCES_PER_NAME) list.push(...add.slice(0, MAX_OCCURRENCES_PER_NAME - list.length));
  }
}

export function mergeFileReferences(project: ProjectReferences, refs: FileReferences): void {
  mergeBucket(project.classes, refs.classes);
  mergeBucket(project.ids, refs.ids);
  mergeBucket(project.elements, refs.elements);
  mergeBucket(project.attributes, refs.attributes);
  for (const token of refs.tokens) {
    const files = project.tokens.get(token);
    if (!files) project.tokens.set(token, [refs.file]);
    else if (files.length < 5 && !files.includes(refs.file)) files.push(refs.file);
  }
  project.dynamicPatterns.push(...refs.dynamicPatterns);
  project.unresolved.push(...refs.unresolved);
  project.cssModules.push(...refs.cssModules);
  project.stylesheetImports.push(...refs.stylesheetImports);
  project.sourceFileCount++;
  project.adapterFiles[refs.adapter] = (project.adapterFiles[refs.adapter] ?? 0) + 1;
}

const TOKEN_SPLIT = /[\s"'`]+/;
const SUBTOKEN_SPLIT = /[.#,>+~()[\]=:{}<;|&*$^!?]+/;

/**
 * Split free text (string literals, template text) into class-like tokens. Whole
 * whitespace-separated tokens are kept (so Tailwind tokens such as `md:hover:p-4`
 * survive), and selector-ish strings such as `.card > .title` are split further.
 */
export function tokenize(text: string, into: Set<string>): void {
  for (const raw of text.split(TOKEN_SPLIT)) {
    if (!raw || raw.length > 200) continue;
    into.add(raw);
    if (SUBTOKEN_SPLIT.test(raw)) {
      for (const sub of raw.split(SUBTOKEN_SPLIT)) if (sub && sub.length > 0) into.add(sub);
    }
  }
}
