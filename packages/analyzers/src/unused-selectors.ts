import {
  factor,
  type Analyzer,
  type AnalyzerContext,
  type ConfidenceFactor,
  type CssModuleUsage,
  type CssRule,
  type DynamicPattern,
  type Evidence,
  type FindingDraft,
  type SelectorPart,
  type SelectorRequirements,
} from '@css-archaeology/core';
import { z } from 'zod';

const options = z
  .object({
    /** Report selectors whose only unmatched parts are element or attribute selectors. */
    checkElements: z.boolean().default(true),
    checkAttributes: z.boolean().default(true),
    /** Class name prefixes commonly toggled at runtime; matching classes get lower confidence. */
    runtimeStatePrefixes: z.array(z.string()).default(['is-', 'has-', 'js-', 'active', 'open', 'show', 'visible', 'hidden', 'disabled', 'selected', 'collapsed', 'expanded']),
  })
  .strict();
type Options = z.infer<typeof options>;

type Missing = { kind: 'class' | 'id' | 'element' | 'attribute'; name: string };

function camelCase(name: string): string {
  return name.replace(/[-_]+(\w)/g, (_m, c: string) => c.toUpperCase());
}
function dashesCase(name: string): string {
  return name.replace(/-+(\w)/g, (_m, c: string) => c.toUpperCase());
}

/** Export names a bundler generates for a CSS Module class under each convention. */
export function moduleExportNames(className: string, convention: string): string[] {
  switch (convention) {
    case 'asIs':
      return [className];
    case 'camelCaseOnly':
      return [camelCase(className)];
    case 'dashes':
      return [className, dashesCase(className)];
    case 'dashesOnly':
      return [dashesCase(className)];
    case 'camelCase':
    default:
      return [className, camelCase(className)];
  }
}

function matchesPattern(name: string, patterns: DynamicPattern[]): DynamicPattern | undefined {
  return patterns.find((p) => (p.prefix.length >= 2 || p.suffix.length >= 2) && name.startsWith(p.prefix) && name.endsWith(p.suffix) && name.length >= p.prefix.length + p.suffix.length);
}

interface Lookup {
  ctx: AnalyzerContext;
  classPatterns: DynamicPattern[];
  idPatterns: DynamicPattern[];
  moduleUsage: Map<string, CssModuleUsage[]>;
  convention: string;
  opts: Options;
}

function moduleClassUsed(name: string, usages: CssModuleUsage[], convention: string): boolean {
  const exportsFor = moduleExportNames(name, convention);
  for (const u of usages) {
    if (u.escaped) return true;
    if (u.accessed.some((a) => a === name || exportsFor.includes(a))) return true;
    if (u.dynamicPrefixes.some((p) => p.length >= 2 && (name.startsWith(p) || exportsFor.some((e) => e.startsWith(p))))) return true;
  }
  return false;
}

function isPresent(kind: Missing['kind'], name: string, lookup: Lookup, rule: CssRule, part: SelectorPart): boolean {
  const { references } = lookup.ctx;
  switch (kind) {
    case 'class': {
      if (rule.isModule && !part.hasGlobal) {
        const usages = lookup.moduleUsage.get(rule.file) ?? [];
        return moduleClassUsed(name, usages, lookup.convention);
      }
      return references.classes.has(name) || references.tokens.has(name) || matchesPattern(name, lookup.classPatterns) !== undefined;
    }
    case 'id':
      return references.ids.has(name) || references.tokens.has(name) || references.tokens.has(`#${name}`) || matchesPattern(name, lookup.idPatterns) !== undefined;
    case 'element':
      return !lookup.opts.checkElements || references.elements.has(name) || (name.includes('-') && references.tokens.has(name));
    case 'attribute':
      return !lookup.opts.checkAttributes || references.attributes.has(name) || references.tokens.has(name);
  }
}

function missingRequirements(req: SelectorRequirements, lookup: Lookup, rule: CssRule, part: SelectorPart): Missing[] {
  const missing: Missing[] = [];
  for (const c of new Set(req.classes)) if (!isPresent('class', c, lookup, rule, part)) missing.push({ kind: 'class', name: c });
  for (const i of new Set(req.ids)) if (!isPresent('id', i, lookup, rule, part)) missing.push({ kind: 'id', name: i });
  for (const e of new Set(req.elements)) if (!isPresent('element', e, lookup, rule, part)) missing.push({ kind: 'element', name: e });
  for (const a of new Set(req.attributes)) if (!isPresent('attribute', a, lookup, rule, part)) missing.push({ kind: 'attribute', name: a });
  for (const group of req.alternatives) {
    const results = group.map((alt) => missingRequirements(alt, lookup, rule, part));
    if (results.every((r) => r.length > 0)) missing.push(...results.flat());
  }
  return missing;
}

function format(m: Missing): string {
  switch (m.kind) {
    case 'class':
      return `.${m.name}`;
    case 'id':
      return `#${m.name}`;
    case 'attribute':
      return `[${m.name}]`;
    case 'element':
      return `<${m.name}>`;
  }
}

export const unusedSelectorsAnalyzer: Analyzer = {
  id: 'unused-selectors',
  configKey: 'unusedSelectors',
  title: 'Potentially unused selectors',
  description: 'Finds selectors that do not appear to be referenced by any discoverable markup or script.',
  rules: [
    {
      id: 'unused-selector',
      title: 'Potentially unused selector',
      description: 'No scanned source file references the classes, ids, elements or attributes this selector requires.',
      defaultSeverity: 'low',
      optionsSchema: options,
      rationale:
        'A selector can only match if markup contains everything it requires. CSS Archaeology collects class, id, element and attribute references from HTML, JSX/TSX (className, clsx/classnames/cva calls, DOM APIs), CSS Modules imports, Tailwind @apply and every string literal in scripts. A selector is reported only when at least one requirement is not found anywhere. Static analysis cannot see runtime-generated markup, CMS content, third-party components or class names built from unresolved variables, so this is always labelled "potentially unused". Nothing is ever deleted automatically.',
    },
  ],
  run(ctx) {
    const { project, references, safelist } = ctx;
    if (references.sourceFileCount === 0) {
      ctx.note('Unused selector analysis skipped: no markup or script files were scanned, so there is nothing to compare selectors against.');
      return [];
    }
    const opts = ctx.rule<Options>('unused-selector').options;
    const moduleUsage = new Map<string, CssModuleUsage[]>();
    for (const u of references.cssModules) {
      const list = moduleUsage.get(u.module) ?? [];
      list.push(u);
      moduleUsage.set(u.module, list);
    }
    const lookup: Lookup = {
      ctx,
      classPatterns: references.dynamicPatterns.filter((p) => p.kind === 'class'),
      idPatterns: references.dynamicPatterns.filter((p) => p.kind === 'id'),
      moduleUsage,
      convention: ctx.config.cssModules.localsConvention,
      opts,
    };
    const unresolved = references.unresolved;
    const tailwindDirectiveFiles = new Set(project.stylesheets.filter((s) => s.tailwindDirectives.length > 0).map((s) => s.file));
    const findings: FindingDraft[] = [];
    let skippedUnparseable = 0;

    for (const rule of project.rules) {
      for (const part of rule.selectors) {
        if (part.unparseable) {
          skippedUnparseable++;
          continue;
        }
        if (safelist.matchesSelector(part.text, part.classes, part.ids)) continue;
        const missing = missingRequirements(part.requirements, lookup, rule, part);
        if (missing.length === 0) continue;

        const structural = missing.some((m) => m.kind === 'class' || m.kind === 'id');
        const factors: ConfidenceFactor[] = [];
        if (!structural) factors.push(factor('element-or-attribute-only', -0.1, 'Only element or attribute requirements are unmatched; such markup is often produced by CMS content, Markdown or third-party components.'));
        if (unresolved.length > 0) {
          const sample = unresolved[0]!;
          factors.push(
            factor(
              'unresolved-dynamic-classes',
              unresolved.length > 20 ? -0.25 : -0.15,
              `${unresolved.length} class expression(s) could not be resolved statically (e.g. ${sample.file}:${sample.line} \`${sample.snippet}\`).`,
            ),
          );
        }
        const stateLike = missing.find((m) => m.kind === 'class' && opts.runtimeStatePrefixes.some((p) => m.name.startsWith(p)));
        if (stateLike) factors.push(factor('runtime-state-name', -0.15, `.${stateLike.name} looks like a state class that scripts commonly toggle at runtime.`));
        if (rule.isModule && !part.hasGlobal) {
          const usages = moduleUsage.get(rule.file) ?? [];
          if (usages.length === 0) factors.push(factor('module-not-imported', -0.1, `${rule.file} is not imported by any scanned file; it may be unused entirely or imported from outside the scanned files.`));
          else factors.push(factor('module-scoped', 0.05, `CSS Module class names are local to ${rule.file}, so only its ${usages.length} import(s) were checked.`));
        }
        if (tailwindDirectiveFiles.has(rule.file)) {
          factors.push(factor('tailwind-stylesheet', -0.05, 'This stylesheet uses Tailwind directives; classes may also be referenced through Tailwind configuration.'));
        }
        const unmatched = missing.map(format);
        const evidence: Evidence[] = [
          { kind: 'selector', message: `Selector declared here`, file: rule.file, line: rule.line, column: rule.column, snippet: part.text },
          ...missing.map((m): Evidence => ({
            kind: 'search',
            message:
              rule.isModule && m.kind === 'class' && !part.hasGlobal
                ? `No import of ${rule.file} accesses ${moduleExportNames(m.name, lookup.convention).map((n) => `styles.${n}`).join(' or ')}`
                : `No reference to ${format(m)} found in ${references.sourceFileCount} scanned source file(s) or any string literal`,
          })),
        ];
        if (lookup.classPatterns.length > 0 && missing.some((m) => m.kind === 'class')) {
          evidence.push({
            kind: 'note',
            message: `Checked against ${lookup.classPatterns.length} dynamic class pattern(s) such as "${lookup.classPatterns[0]!.prefix}*${lookup.classPatterns[0]!.suffix}"; none match.`,
          });
        }
        findings.push({
          rule: 'unused-selector',
          severity: structural ? 'low' : 'info',
          baseConfidence: structural ? 0.85 : 0.5,
          confidenceFactors: factors,
          title: `Potentially unused selector ${part.text}`,
          description: `${part.text} requires ${unmatched.join(', ')}, which ${unmatched.length === 1 ? 'was' : 'were'} not found in any scanned source file.`,
          file: rule.file,
          line: rule.line,
          column: rule.column,
          selector: part.text,
          evidence,
          suggestion:
            'Confirm the selector is not used by runtime-generated markup, third-party code or content before removing it. Add it to the safelist if it is used.',
          approximate: false,
          data: { missing },
        });
      }
    }
    if (skippedUnparseable > 0) {
      ctx.note(`Unused selector analysis skipped ${skippedUnparseable} selector(s) containing interpolation or unresolved nesting.`);
    }
    return findings;
  },
};
