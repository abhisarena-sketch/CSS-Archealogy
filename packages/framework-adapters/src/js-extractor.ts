import ts from 'typescript';
import {
  addReference,
  emptyFileReferences,
  extname,
  isCssModulePath,
  joinPath,
  normalisePath,
  resolveRelative,
  tokenize,
  type AdapterContext,
  type CssModuleUsage,
  type FileReferences,
  type ReferenceOccurrence,
  type SourceFile,
} from '@css-archaeology/core';

const STYLE_EXT = /\.(css|scss|pcss|postcss|sass|less)$/i;
/** Attribute names (JSX props) whose value is a class list. */
const CLASS_PROP = /^(className|class|[a-zA-Z]+ClassName|classNames?|[a-zA-Z]+Class)$/;
/** Identifiers that simply forward class names from elsewhere; not treated as unresolved. */
const PASS_THROUGH = /^(className|classes|classNames|cls|rest|props|otherProps|restProps|attrs)$/;
const MAX_DEPTH = 6;
/** Functions whose arguments are class lists wherever they are called. */
const CLASS_HELPERS = /^(clsx|classnames|classNames|cn|cx|twMerge|twJoin|cva|tv|ctl|mergeClasses)$/;
const MAX_COMBINATIONS = 64;

/** Components whose rendered element is known. */
const COMPONENT_ELEMENTS: Record<string, Record<string, string>> = {
  'next/link': { default: 'a' },
  'next/image': { default: 'img' },
  'next/legacy/image': { default: 'img' },
  'react-router-dom': { Link: 'a', NavLink: 'a' },
  'react-router': { Link: 'a', NavLink: 'a' },
  '@remix-run/react': { Link: 'a', NavLink: 'a' },
};

const JSX_ATTRIBUTE_ALIASES: Record<string, string> = { htmlFor: 'for', tabIndex: 'tabindex', readOnly: 'readonly', autoFocus: 'autofocus', colSpan: 'colspan', rowSpan: 'rowspan', maxLength: 'maxlength', crossOrigin: 'crossorigin' };

function scriptKind(path: string): ts.ScriptKind {
  switch (extname(path)) {
    case '.tsx':
      return ts.ScriptKind.TSX;
    case '.ts':
    case '.mts':
    case '.cts':
      return ts.ScriptKind.TS;
    case '.jsx':
      return ts.ScriptKind.JSX;
    default:
      // Plain .js files frequently contain JSX in React projects.
      return ts.ScriptKind.JSX;
  }
}

/**
 * Resolve a stylesheet import specifier to a project path. Supports relative paths and
 * the common `@/`, `~/` and `src/` aliases; bare package imports return null.
 */
export function resolveStyleImport(importer: string, specifier: string, context: Pick<AdapterContext, 'fileExists'>): string | null {
  const relative = resolveRelative(importer, specifier);
  if (relative) return relative;
  const aliases: [RegExp, string[]][] = [
    [/^@\//, ['', 'src/']],
    [/^~\//, ['', 'src/']],
    [/^src\//, ['src/']],
  ];
  for (const [re, bases] of aliases) {
    if (!re.test(specifier)) continue;
    const rest = specifier.replace(re, '');
    for (const base of bases) {
      const candidate = normalisePath(`${base}${rest}`);
      if (candidate && context.fileExists(candidate)) return candidate;
    }
  }
  return null;
}

function staticText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  if (ts.isPrivateIdentifier(name)) return null;
  if (ts.isComputedPropertyName(name)) return staticText(name.expression);
  return null;
}

export interface ExtractOptions {
  adapter: string;
  /** Prefix for `via` labels. */
  label?: string;
}

/** Extract CSS references from JavaScript / TypeScript / JSX source. Never executes code. */
export function extractFromScript(file: SourceFile, context: AdapterContext, options: ExtractOptions): FileReferences {
  const refs = emptyFileReferences(file.path, options.adapter);
  const sf = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true, scriptKind(file.path));
  const tokens = new Set<string>();
  const constants = new Map<string, ts.Expression>();
  const moduleBindings = new Map<string, CssModuleUsage>();
  const componentElements = new Map<string, string>();
  let importPosition = 0;

  const occ = (node: ts.Node, via: string): ReferenceOccurrence => {
    const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    return { file: file.path, line: line + 1, column: character + 1, via };
  };
  const snippet = (node: ts.Node) => node.getText(sf).replace(/\s+/g, ' ').slice(0, 80);

  const unwrap = (e: ts.Expression): ts.Expression => {
    while (ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isTypeAssertionExpression(e)) e = e.expression;
    return e;
  };
  /** Helper calls already evaluated as part of a class context. */
  const evaluatedCalls = new Set<ts.Node>();

  /* Pre-pass: constants, imports and CSS Module bindings ------------------ */
  const collect = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
      const list = node.parent;
      if (ts.isVariableDeclarationList(list) && list.flags & ts.NodeFlags.Const) constants.set(node.name.text, unwrap(node.initializer));
      const init = node.initializer;
      if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === 'require' && init.arguments[0]) {
        const spec = staticText(init.arguments[0]);
        if (spec) handleStyleImport(spec, node, node.name.text, []);
      }
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text;
      const clause = node.importClause;
      if (STYLE_EXT.test(spec)) {
        let binding: string | null = null;
        const named: string[] = [];
        if (clause?.name) binding = clause.name.text;
        const bindings = clause?.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) binding = bindings.name.text;
        if (bindings && ts.isNamedImports(bindings)) for (const el of bindings.elements) named.push((el.propertyName ?? el.name).text);
        handleStyleImport(spec, node, binding, named);
      } else if (COMPONENT_ELEMENTS[spec] && clause) {
        const map = COMPONENT_ELEMENTS[spec]!;
        if (clause.name && map.default) componentElements.set(clause.name.text, map.default);
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          for (const el of bindings.elements) {
            const tag = map[(el.propertyName ?? el.name).text];
            if (tag) componentElements.set(el.name.text, tag);
          }
        }
      }
    }
    ts.forEachChild(node, collect);
  };

  const handleStyleImport = (spec: string, node: ts.Node, binding: string | null, named: string[]) => {
    const resolved = resolveStyleImport(file.path, spec, context);
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    if (!resolved) {
      if (spec.startsWith('.') || spec.startsWith('@/') || spec.startsWith('~/')) refs.notes.push(`could not resolve stylesheet import "${spec}"`);
      return;
    }
    if (isCssModulePath(resolved)) {
      const usage: CssModuleUsage = { module: resolved, importer: file.path, line: line + 1, accessed: [...named], dynamicPrefixes: [], escaped: false };
      refs.cssModules.push(usage);
      if (binding) moduleBindings.set(binding, usage);
      else if (named.length === 0) usage.escaped = false;
    } else {
      refs.stylesheetImports.push({ importer: file.path, stylesheet: resolved, line: line + 1, position: importPosition++ });
    }
  };

  collect(sf);

  /* Static evaluation ------------------------------------------------------ */

  /** Finite set of possible string values, or null when unknown. */
  const staticValues = (expr: ts.Expression, depth = 0, seen = new Set<string>()): string[] | null => {
    if (depth > MAX_DEPTH) return null;
    const text = staticText(expr);
    if (text !== null) return [text];
    if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isNonNullExpression(expr) || ts.isSatisfiesExpression(expr)) {
      return staticValues(expr.expression, depth + 1, seen);
    }
    if (ts.isConditionalExpression(expr)) {
      const a = staticValues(expr.whenTrue, depth + 1, seen);
      const b = staticValues(expr.whenFalse, depth + 1, seen);
      return a && b ? [...a, ...b] : null;
    }
    if (ts.isBinaryExpression(expr)) {
      const op = expr.operatorToken.kind;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
        const right = staticValues(expr.right, depth + 1, seen);
        return right ? [...right, ''] : null;
      }
      if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
        const l = staticValues(expr.left, depth + 1, seen);
        const r = staticValues(expr.right, depth + 1, seen);
        return l && r ? [...l, ...r] : null;
      }
      if (op === ts.SyntaxKind.PlusToken) {
        const l = staticValues(expr.left, depth + 1, seen);
        const r = staticValues(expr.right, depth + 1, seen);
        return l && r ? combine(l, r) : null;
      }
      return null;
    }
    if (ts.isTemplateExpression(expr)) {
      let acc: string[] | null = [expr.head.text];
      for (const span of expr.templateSpans) {
        const v = staticValues(span.expression, depth + 1, seen);
        if (!v || !acc) return null;
        const withValue = combine(acc, v);
        acc = withValue ? combine(withValue, [span.literal.text]) : null;
      }
      return acc;
    }
    if (ts.isIdentifier(expr)) {
      if (expr.text === 'undefined') return [''];
      const init = constants.get(expr.text);
      if (!init || seen.has(expr.text)) return null;
      seen.add(expr.text);
      return staticValues(init, depth + 1, seen);
    }
    if (expr.kind === ts.SyntaxKind.NullKeyword || expr.kind === ts.SyntaxKind.FalseKeyword || expr.kind === ts.SyntaxKind.TrueKeyword) return [''];
    return null;
  };

  const combine = (a: string[], b: string[]): string[] | null => {
    if (a.length * b.length > MAX_COMBINATIONS) return null;
    const out: string[] = [];
    for (const x of a) for (const y of b) out.push(x + y);
    return out;
  };

  const addClasses = (text: string, node: ts.Node, via: string) => {
    for (const token of text.split(/\s+/)) if (token) addReference(refs.classes, token, occ(node, via));
  };

  /** Record class references from a template literal, keeping partial tokens as dynamic patterns. */
  const evaluateTemplate = (expr: ts.TemplateExpression, via: string, depth: number) => {
    const texts = [expr.head.text, ...expr.templateSpans.map((s) => s.literal.text)];
    const spans = expr.templateSpans.map((s) => s.expression);
    texts.forEach((text, i) => {
      const words = text.split(/\s+/).filter(Boolean);
      const gluedLeft = i > 0 && text !== '' && !/^\s/.test(text);
      const gluedRight = i < spans.length && text !== '' && !/\s$/.test(text);
      words.forEach((word, wi) => {
        if ((wi === 0 && gluedLeft) || (wi === words.length - 1 && gluedRight)) return;
        addReference(refs.classes, word, occ(expr, via));
      });
      if (i >= spans.length) return;
      const span = spans[i]!;
      const next = texts[i + 1] ?? '';
      const prefix = gluedRight ? (words[words.length - 1] ?? '') : '';
      const suffix = next !== '' && !/^\s/.test(next) ? (next.split(/\s+/)[0] ?? '') : '';
      if (!prefix && !suffix) return evaluateClass(span, via, depth + 1);
      const values = staticValues(span, depth + 1);
      if (values) {
        for (const v of values) for (const token of `${prefix}${v}${suffix}`.split(/\s+/)) if (token) addReference(refs.classes, token, occ(expr, via));
        return;
      }
      const { line, character } = sf.getLineAndCharacterOfPosition(expr.getStart(sf));
      refs.dynamicPatterns.push({ kind: 'class', prefix, suffix, file: file.path, line: line + 1, column: character + 1, via });
      evaluateClass(span, via, depth + 1, true);
    });
  };

  const evaluateObjectClasses = (obj: ts.ObjectLiteralExpression, via: string, depth: number) => {
    for (const prop of obj.properties) {
      if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
        const key = propertyNameText(prop.name);
        if (key !== null) addClasses(key, prop.name, `${via}-object-key`);
        else if (ts.isPropertyAssignment(prop) && ts.isComputedPropertyName(prop.name)) evaluateClass(prop.name.expression, via, depth + 1);
        if (ts.isPropertyAssignment(prop)) {
          const init = prop.initializer;
          // cva/tv variant maps and lookup tables have class strings as values; clsx objects have conditions.
          if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init) || ts.isTemplateExpression(init) || ts.isObjectLiteralExpression(init) || ts.isArrayLiteralExpression(init)) {
            evaluateClass(init, via, depth + 1);
          }
        }
      } else if (ts.isSpreadAssignment(prop)) {
        evaluateClass(prop.expression, via, depth + 1);
      }
    }
  };

  const markUnresolved = (expr: ts.Node, via: string) => {
    const { line, character } = sf.getLineAndCharacterOfPosition(expr.getStart(sf));
    refs.unresolved.push({ file: file.path, line: line + 1, column: character + 1, via, snippet: snippet(expr) });
  };

  const evaluateClass = (expr: ts.Expression, via: string, depth = 0, partOfPattern = false): void => {
    if (depth > MAX_DEPTH) return markUnresolved(expr, via);
    const text = staticText(expr);
    if (text !== null) return addClasses(text, expr, via);
    if (ts.isTemplateExpression(expr)) return evaluateTemplate(expr, via, depth);
    if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isNonNullExpression(expr) || ts.isSatisfiesExpression(expr)) {
      return evaluateClass(expr.expression, via, depth + 1, partOfPattern);
    }
    if (ts.isConditionalExpression(expr)) {
      evaluateClass(expr.whenTrue, via, depth + 1, partOfPattern);
      evaluateClass(expr.whenFalse, via, depth + 1, partOfPattern);
      return;
    }
    if (ts.isBinaryExpression(expr)) {
      const op = expr.operatorToken.kind;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken) return evaluateClass(expr.right, via, depth + 1, partOfPattern);
      if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
        evaluateClass(expr.left, via, depth + 1, partOfPattern);
        evaluateClass(expr.right, via, depth + 1, partOfPattern);
        return;
      }
      if (op === ts.SyntaxKind.PlusToken) {
        const values = staticValues(expr, depth + 1);
        if (values) {
          for (const v of values) addClasses(v, expr, via);
          return;
        }
        const left = staticValues(expr.left, depth + 1);
        if (left) {
          const lastLeft = left.length === 1 ? left[0]! : '';
          const words = lastLeft.split(/\s+/).filter(Boolean);
          if (!/\s$/.test(lastLeft) && words.length) {
            const prefix = words.pop()!;
            const { line, character } = sf.getLineAndCharacterOfPosition(expr.getStart(sf));
            refs.dynamicPatterns.push({ kind: 'class', prefix, suffix: '', file: file.path, line: line + 1, column: character + 1, via });
            for (const w of words) addReference(refs.classes, w, occ(expr, via));
            evaluateClass(expr.right, via, depth + 1, true);
            return;
          }
        }
        evaluateClass(expr.left, via, depth + 1, partOfPattern);
        evaluateClass(expr.right, via, depth + 1, partOfPattern);
        return;
      }
      return;
    }
    if (ts.isArrayLiteralExpression(expr)) {
      for (const el of expr.elements) {
        if (ts.isSpreadElement(el)) evaluateClass(el.expression, via, depth + 1);
        else if (ts.isExpression(el)) evaluateClass(el, via, depth + 1);
      }
      return;
    }
    if (ts.isObjectLiteralExpression(expr)) return evaluateObjectClasses(expr, via, depth);
    if (ts.isCallExpression(expr)) {
      const callee = expr.expression;
      // ['a', b && 'c'].join(' ') and friends.
      if (ts.isPropertyAccessExpression(callee) && ['join', 'filter', 'trim', 'concat', 'toString'].includes(callee.name.text)) {
        evaluateClass(callee.expression, via, depth + 1);
        for (const arg of expr.arguments) if (callee.name.text === 'concat') evaluateClass(arg, via, depth + 1);
        return;
      }
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
      const known = CLASS_HELPERS.test(name);
      evaluatedCalls.add(expr);
      for (const arg of expr.arguments) evaluateClass(arg, `${via}-${known ? name : 'call'}`, depth + 1);
      if (!known) markUnresolved(expr, via);
      return;
    }
    if (ts.isIdentifier(expr)) {
      const init = constants.get(expr.text);
      if (init) return evaluateClass(init, via, depth + 1, partOfPattern);
      if (PASS_THROUGH.test(expr.text)) return;
      if (!partOfPattern) markUnresolved(expr, via);
      return;
    }
    if (ts.isPropertyAccessExpression(expr)) {
      if (ts.isIdentifier(expr.expression) && moduleBindings.has(expr.expression.text)) return; // CSS Module access, recorded by the walker
      if (PASS_THROUGH.test(expr.name.text) || (ts.isIdentifier(expr.expression) && PASS_THROUGH.test(expr.expression.text))) return;
      // obj.key where obj is a const object literal: any of its values.
      if (ts.isIdentifier(expr.expression)) {
        const init = constants.get(expr.expression.text);
        if (init && ts.isObjectLiteralExpression(init)) {
          const prop = init.properties.find((p) => p.name && propertyNameText(p.name) === expr.name.text);
          if (prop && ts.isPropertyAssignment(prop)) return evaluateClass(prop.initializer, via, depth + 1);
        }
      }
      if (!partOfPattern) markUnresolved(expr, via);
      return;
    }
    if (ts.isElementAccessExpression(expr)) {
      if (ts.isIdentifier(expr.expression) && moduleBindings.has(expr.expression.text)) return;
      if (ts.isIdentifier(expr.expression)) {
        const init = constants.get(expr.expression.text);
        if (init && ts.isObjectLiteralExpression(init)) {
          for (const p of init.properties) if (ts.isPropertyAssignment(p)) evaluateClass(p.initializer, via, depth + 1);
          return;
        }
        if (init && ts.isArrayLiteralExpression(init)) return evaluateClass(init, via, depth + 1);
      }
      if (!partOfPattern) markUnresolved(expr, via);
      return;
    }
    if (ts.isJsxExpression(expr as ts.Node) && (expr as unknown as ts.JsxExpression).expression) {
      return evaluateClass((expr as unknown as ts.JsxExpression).expression!, via, depth + 1, partOfPattern);
    }
    if (expr.kind === ts.SyntaxKind.NullKeyword || expr.kind === ts.SyntaxKind.FalseKeyword || expr.kind === ts.SyntaxKind.TrueKeyword || expr.kind === ts.SyntaxKind.UndefinedKeyword) return;
    if (!partOfPattern) markUnresolved(expr, via);
  };

  const evaluateId = (expr: ts.Expression, node: ts.Node, via: string) => {
    const values = staticValues(expr);
    if (values) {
      for (const v of values) if (v) addReference(refs.ids, v.trim(), occ(node, via));
      return;
    }
    if (ts.isTemplateExpression(expr) && expr.head.text) {
      const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      refs.dynamicPatterns.push({ kind: 'id', prefix: expr.head.text, suffix: '', file: file.path, line: line + 1, column: character + 1, via });
    }
  };

  /** Extract classes, ids and element names from a selector string passed to DOM APIs. */
  const selectorString = (text: string, node: ts.Node, via: string) => {
    for (const m of text.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) addReference(refs.classes, m[1]!, occ(node, via));
    for (const m of text.matchAll(/#(-?[_a-zA-Z][\w-]*)/g)) addReference(refs.ids, m[1]!, occ(node, via));
    for (const m of text.matchAll(/(?:^|[\s>+~,(])([a-z][a-z0-9-]*)(?=[\s.#[:>+~,)]|$)/g)) addReference(refs.elements, m[1]!, occ(node, via));
    for (const m of text.matchAll(/\[\s*([\w-]+)/g)) addReference(refs.attributes, m[1]!.toLowerCase(), occ(node, via));
  };

  /* Main walk -------------------------------------------------------------- */
  const visit = (node: ts.Node): void => {
    // String literals anywhere are weak evidence that a class name is in use.
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!ts.isImportDeclaration(node.parent) && !ts.isExportDeclaration(node.parent) && !ts.isExternalModuleReference(node.parent)) tokenize(node.text, tokens);
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      tokenize(node.text, tokens);
    }

    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName;
      if (ts.isIdentifier(tag)) {
        if (/^[a-z]/.test(tag.text)) addReference(refs.elements, tag.text.toLowerCase(), occ(tag, 'jsx-element'));
        else if (componentElements.has(tag.text)) addReference(refs.elements, componentElements.get(tag.text)!, occ(tag, 'jsx-component'));
      } else if (ts.isJsxNamespacedName(tag)) {
        addReference(refs.elements, `${tag.namespace.text}:${tag.name.text}`, occ(tag, 'jsx-element'));
      }
      for (const attr of node.attributes.properties) {
        if (!ts.isJsxAttribute(attr)) continue;
        const name = ts.isIdentifier(attr.name) ? attr.name.text : `${attr.name.namespace.text}:${attr.name.name.text}`;
        const init = attr.initializer;
        if (CLASS_PROP.test(name)) {
          if (!init) continue;
          if (ts.isStringLiteral(init)) addClasses(init.text, init, 'jsx-className');
          else if (ts.isJsxExpression(init) && init.expression) evaluateClass(init.expression, 'jsx-className');
          continue;
        }
        const attrName = (JSX_ATTRIBUTE_ALIASES[name] ?? name).toLowerCase();
        addReference(refs.attributes, attrName, occ(attr, 'jsx-attribute'));
        if (name === 'id' && init) {
          if (ts.isStringLiteral(init)) addReference(refs.ids, init.text, occ(init, 'jsx-id'));
          else if (ts.isJsxExpression(init) && init.expression) evaluateId(init.expression, init, 'jsx-id');
        }
      }
    }

    // { className: '...' } in plain objects (component configs, createElement props).
    if (ts.isPropertyAssignment(node) && !ts.isJsxAttributes(node.parent)) {
      const key = propertyNameText(node.name);
      if (key && /^(className|class)$/.test(key)) evaluateClass(node.initializer, 'object-className');
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const args = node.arguments;
      const helper = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
      if (CLASS_HELPERS.test(helper) && !evaluatedCalls.has(node)) evaluateClass(node, 'class-helper');
      if (ts.isPropertyAccessExpression(callee)) {
        const method = callee.name.text;
        const target = callee.expression;
        if (ts.isPropertyAccessExpression(target) && target.name.text === 'classList' && ['add', 'remove', 'toggle', 'replace', 'contains'].includes(method)) {
          for (const arg of method === 'toggle' ? args.slice(0, 1) : args) evaluateClass(arg, 'dom-classList');
        } else if (['querySelector', 'querySelectorAll', 'closest', 'matches'].includes(method) && args[0]) {
          const values = staticValues(args[0]);
          for (const v of values ?? []) selectorString(v, node, 'dom-selector');
        } else if (method === 'getElementById' && args[0]) {
          evaluateId(args[0], node, 'dom-getElementById');
        } else if ((method === 'getElementsByClassName') && args[0]) {
          evaluateClass(args[0], 'dom-getElementsByClassName');
        } else if (method === 'createElement' && args[0]) {
          for (const v of staticValues(args[0]) ?? []) addReference(refs.elements, v.toLowerCase(), occ(node, 'dom-createElement'));
        } else if ((method === 'setAttribute' || method === 'toggleAttribute') && args[0]) {
          const attr = staticText(args[0]);
          if (attr) {
            addReference(refs.attributes, attr.toLowerCase(), occ(node, 'dom-setAttribute'));
            if (attr === 'class' && args[1]) evaluateClass(args[1], 'dom-setAttribute');
            if (attr === 'id' && args[1]) evaluateId(args[1], node, 'dom-setAttribute');
          }
        }
      }
    }

    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left)) {
      const prop = node.left.name.text;
      if (prop === 'className') evaluateClass(node.right, 'dom-className');
      else if (prop === 'id') evaluateId(node.right, node, 'dom-id');
      else if (ts.isPropertyAccessExpression(node.left.expression) && node.left.expression.name.text === 'dataset') {
        addReference(refs.attributes, `data-${prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, occ(node, 'dom-dataset'));
      }
    }

    // CSS Module accesses.
    if (ts.isIdentifier(node) && moduleBindings.has(node.text)) {
      const usage = moduleBindings.get(node.text)!;
      const parent = node.parent;
      if (ts.isImportClause(parent) || ts.isNamespaceImport(parent) || (ts.isVariableDeclaration(parent) && parent.name === node)) {
        // declaration site
      } else if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
        usage.accessed.push(parent.name.text);
      } else if (ts.isElementAccessExpression(parent) && parent.expression === node) {
        const arg = parent.argumentExpression;
        const values = staticValues(arg);
        if (values) usage.accessed.push(...values);
        else if (ts.isTemplateExpression(arg) && arg.head.text) usage.dynamicPrefixes.push(arg.head.text);
        else usage.escaped = true;
      } else if (ts.isVariableDeclaration(parent) && parent.initializer === node && ts.isObjectBindingPattern(parent.name)) {
        for (const el of parent.name.elements) {
          if (el.dotDotDotToken) usage.escaped = true;
          else {
            const key = el.propertyName ? propertyNameText(el.propertyName) : ts.isIdentifier(el.name) ? el.name.text : null;
            if (key) usage.accessed.push(key);
            else usage.escaped = true;
          }
        }
      } else if (ts.isTypeQueryNode(parent) || ts.isQualifiedName(parent)) {
        // typeof styles: type-level only
      } else {
        usage.escaped = true;
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);

  refs.tokens = [...tokens];
  return refs;
}

/** Join a base directory and a relative path, for adapters resolving `<link href>`. */
export function resolveHref(fromFile: string, href: string): string | null {
  if (/^(https?:)?\/\//i.test(href) || href.startsWith('data:')) return null;
  if (href.startsWith('/')) return normalisePath(href.slice(1));
  return resolveRelative(fromFile, href.startsWith('.') ? href : `./${href}`) ?? joinPath(href);
}
