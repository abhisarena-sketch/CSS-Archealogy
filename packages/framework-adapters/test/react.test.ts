import { describe, expect, it } from 'vitest';
import { resolveConfig, type AdapterContext } from '@css-archaeology/core';
import { extractFromScript } from '../src/js-extractor.js';

const ctx = (paths: string[] = []): AdapterContext => ({ config: resolveConfig({}), fileExists: (p) => paths.includes(p), paths });
const run = (code: string, path = 'src/App.tsx', paths: string[] = []) => extractFromScript({ path, content: code }, ctx(paths), { adapter: 'react' });
const classes = (code: string) => Object.keys(run(code).classes).sort();

describe('React class references', () => {
  it('reads static className and class props', () => {
    expect(classes('export const A = () => <div className="card  card--big"><span class="label" /></div>;')).toEqual(['card', 'card--big', 'label']);
  });

  it('reads conditional and logical expressions', () => {
    expect(classes('const A = ({on}) => <div className={on ? "is-on" : "is-off"}><b className={on && "bold"} /><i className={x || "fallback"} /></div>;')).toEqual(['bold', 'fallback', 'is-off', 'is-on']);
  });

  it('reads clsx / classnames / cn calls with objects and arrays', () => {
    const code = `import clsx from 'clsx';
const A = ({ active, size }) => <button className={clsx('btn', { 'btn--active': active, disabled: !active }, [size === 'lg' && 'btn--lg'], cn('x'))} />;`;
    expect(classes(code)).toEqual(['btn', 'btn--active', 'btn--lg', 'disabled', 'x']);
  });

  it('reads cva variant maps and lookup tables', () => {
    const code = `const button = cva('btn', { variants: { intent: { primary: 'btn-primary', secondary: ['btn-secondary', 'shadow'] } } });
const sizes = { sm: 'text-sm', lg: 'text-lg' } as const;
const A = ({ s }) => <a className={sizes[s]} />;`;
    expect(classes(code)).toEqual(expect.arrayContaining(['btn', 'btn-primary', 'btn-secondary', 'shadow', 'text-sm', 'text-lg']));
  });

  it('resolves const identifiers and string concatenation', () => {
    const code = `const base = 'panel';
const variant = base + ' panel--wide';
const A = () => <section className={variant} />;`;
    expect(classes(code)).toEqual(['panel', 'panel--wide']);
  });

  it('records template literal prefixes as dynamic patterns', () => {
    const refs = run('const A = ({ tone, size }) => <p className={`alert alert-${tone} size-${size}-x`} />;');
    expect(Object.keys(refs.classes)).toEqual(['alert']);
    expect(refs.dynamicPatterns.map((p) => [p.prefix, p.suffix])).toEqual([
      ['alert-', ''],
      ['size-', '-x'],
    ]);
  });

  it('expands template literals with finite values', () => {
    const refs = run('const A = ({ on }) => <p className={`tab ${on ? "tab--on" : "tab--off"}`} />;');
    expect(Object.keys(refs.classes).sort()).toEqual(['tab', 'tab--off', 'tab--on']);
    expect(refs.dynamicPatterns).toHaveLength(0);
  });

  it('records unresolved expressions but not className pass-through', () => {
    const refs = run('const A = ({ className, theme }) => <div className={theme.box}><span className={className} /><i className={getCls()} /></div>;');
    expect(refs.unresolved.map((u) => u.snippet)).toEqual(['theme.box', 'getCls()']);
  });

  it('collects elements, attributes, ids and known component elements', () => {
    const code = `import Link from 'next/link';
import { NavLink } from 'react-router-dom';
const A = () => <main id="root" data-state="open" aria-expanded="true"><Link href="/">x</Link><NavLink to="/" /><Foo /><label htmlFor="x" /></main>;`;
    const refs = run(code);
    expect(Object.keys(refs.elements).sort()).toEqual(['a', 'label', 'main']);
    expect(Object.keys(refs.ids)).toEqual(['root']);
    expect(Object.keys(refs.attributes)).toEqual(expect.arrayContaining(['data-state', 'aria-expanded', 'for', 'href']));
  });

  it('reads DOM APIs', () => {
    const code = `el.classList.add('is-visible', 'fade');
el.classList.toggle('open', flag);
document.querySelector('.menu > #nav li[data-x]');
document.getElementById('app');
el.className = 'reset';
el.setAttribute('class', 'via-attr');
el.dataset.userId = '1';
document.createElement('dialog');`;
    const refs = run(code, 'src/dom.js');
    expect(Object.keys(refs.classes).sort()).toEqual(['fade', 'is-visible', 'menu', 'open', 'reset', 'via-attr']);
    expect(Object.keys(refs.ids).sort()).toEqual(['app', 'nav']);
    expect(Object.keys(refs.elements).sort()).toEqual(['dialog', 'li']);
    expect(Object.keys(refs.attributes)).toEqual(expect.arrayContaining(['data-x', 'data-user-id', 'class']));
  });

  it('collects every string literal as weak tokens', () => {
    const refs = run('const config = { variant: "hero-banner", list: ["md:grid-cols-2"] };');
    expect(refs.tokens).toEqual(expect.arrayContaining(['hero-banner', 'md:grid-cols-2']));
  });

  it('records global stylesheet imports in order', () => {
    const refs = run("import './globals.css';\nimport '@/styles/theme.css';\nimport 'pkg/dist.css';", 'app/layout.tsx', ['app/globals.css', 'styles/theme.css']);
    expect(refs.stylesheetImports.map((i) => [i.stylesheet, i.position])).toEqual([
      ['app/globals.css', 0],
      ['styles/theme.css', 1],
    ]);
  });
});

describe('CSS Modules usage', () => {
  it('tracks property, element and destructured access', () => {
    const code = `import styles from './Button.module.css';
const { icon, label: lbl } = styles;
const A = () => <button className={styles.button + ' ' + styles['button--primary']} />;`;
    const [usage] = run(code, 'src/Button.tsx').cssModules;
    expect(usage!.module).toBe('src/Button.module.css');
    expect(usage!.accessed.sort()).toEqual(['button', 'button--primary', 'icon', 'label']);
    expect(usage!.escaped).toBe(false);
  });

  it('marks modules used dynamically as escaped and keeps template prefixes', () => {
    const escaped = run(`import s from './a.module.css';\nconst A = (p) => <div className={s[p.kind]} {...s} />;`).cssModules[0]!;
    expect(escaped.escaped).toBe(true);
    const prefixed = run('import * as s from "./a.module.css";\nconst A = (p) => <div className={s[`size-${p.size}`]} />;').cssModules[0]!;
    expect(prefixed.dynamicPrefixes).toEqual(['size-']);
    expect(prefixed.escaped).toBe(false);
  });

  it('supports require() and named imports', () => {
    const req = run("const styles = require('./x.module.scss');\nstyles.title;", 'src/x.js').cssModules[0]!;
    expect(req.accessed).toEqual(['title']);
    const named = run("import { title } from './y.module.css';").cssModules[0]!;
    expect(named.accessed).toEqual(['title']);
  });
});
