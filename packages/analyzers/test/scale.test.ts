import { describe, expect, it } from 'vitest';
import { byRule, scan } from './helpers.js';

/**
 * Regression tests for cascade analysis on projects with many CSS Modules that reuse the
 * same local class names. Module classes are file-scoped, so they must neither be compared
 * across files (false positives) nor make the analysis quadratic in the number of modules.
 */
describe('many CSS Modules sharing class names', () => {
  const files: Record<string, string> = {};
  const modules = 1200;
  for (let i = 0; i < modules; i++) {
    files[`src/c${i}.module.css`] = `.root { color: red; padding: 4px; }\n.root { color: blue; }\n.title { margin: 0; }\n`;
  }
  files['src/global.css'] = '.root { color: green; }\nspan { color: black; }';
  files['index.html'] = '<div class="root"><span></span></div>';

  it('finds each in-file override once and never crosses module boundaries', async () => {
    const start = Date.now();
    const result = await scan(files);
    const elapsed = Date.now() - start;
    const overridden = byRule(result.findings, 'overridden-declaration');
    expect(overridden).toHaveLength(modules);
    expect(overridden.every((f) => f.evidence.slice(1).every((e) => e.file === f.file))).toBe(true);
    expect(byRule(result.findings, 'conflicting-declaration')).toHaveLength(0);
    // Generous bound: before file-scoped indexing this took minutes, not seconds.
    expect(elapsed).toBeLessThan(30_000);
  }, 60_000);

  it('still compares unscoped selectors in a module with scoped ones in the same file', async () => {
    const result = await scan({
      'a.module.css': '.wrap .box span { color: red; }\nspan { color: blue; }',
      'index.html': '<span></span>',
    });
    expect(byRule(result.findings, 'specificity-conflict').map((f) => f.selector)).toEqual(['span']);
  });
});
