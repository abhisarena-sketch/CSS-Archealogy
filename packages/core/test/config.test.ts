import { describe, expect, it } from 'vitest';
import { createSafelist, resolveConfig, ruleSetting, validateConfig, ConfigError } from '../src/config.js';

describe('configuration', () => {
  it('applies defaults', () => {
    const config = resolveConfig({});
    expect(config.include).toEqual(['**/*']);
    expect(config.exclude).toContain('node_modules');
    expect(config.analysis.unusedSelectors).toBe(true);
    expect(config.reportFormat).toEqual(['json', 'html']);
    expect(config.failOn).toBe('high');
  });

  it('accepts the documented example', () => {
    const result = validateConfig({
      include: ['src/**/*'],
      exclude: ['node_modules', '.next', 'dist', 'build'],
      framework: 'next',
      analysis: {
        unusedSelectors: true,
        duplicateDeclarations: true,
        specificityConflicts: true,
        overriddenDeclarations: true,
        mediaQueries: true,
        designTokens: true,
        complexity: true,
      },
      safelist: [],
      reportFormat: ['json', 'html'],
    });
    expect(result.ok).toBe(true);
  });

  it('rejects unknown keys and invalid values with paths', () => {
    const result = validateConfig({ framework: 'angular', analysis: { unused: true }, reportFormat: ['pdf'], extra: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const paths = result.issues.map((i) => i.path);
      expect(paths).toEqual(expect.arrayContaining(['framework', 'analysis', 'reportFormat.0', '(root)']));
    }
    expect(() => resolveConfig({ failOn: 'urgent' })).toThrow(ConfigError);
  });

  it('warns about invalid safelist regular expressions', () => {
    const result = validateConfig({ safelist: ['/[unclosed/'] });
    expect(result.ok && result.warnings).toHaveLength(1);
  });

  it('resolves rule settings and severity overrides', () => {
    const config = resolveConfig({
      rules: { 'duplicate-declaration': 'low', 'unused-selector': 'off', 'complex-selector': { severity: 'high', options: { maxCompounds: 3 } } },
    });
    expect(ruleSetting(config, 'duplicate-declaration')).toEqual({ enabled: true, severity: 'low', options: {} });
    expect(ruleSetting(config, 'unused-selector').enabled).toBe(false);
    expect(ruleSetting(config, 'complex-selector')).toEqual({ enabled: true, severity: 'high', options: { maxCompounds: 3 } });
    expect(ruleSetting(config, 'something-else')).toEqual({ enabled: true, options: {} });
  });

  it('matches safelist entries by selector, class, id and regex', () => {
    const safelist = createSafelist(['.keep', 'modal-open', '#root', '/^js-/', '.exact > .selector']);
    expect(safelist.matchesSelector('.x .keep', ['x', 'keep'], [])).toBe(true);
    expect(safelist.matchesSelector('.modal-open', ['modal-open'], [])).toBe(true);
    expect(safelist.matchesSelector('#root > div', [], ['root'])).toBe(true);
    expect(safelist.matchesSelector('.js-toggle', ['js-toggle'], [])).toBe(true);
    expect(safelist.matchesSelector('.exact > .selector', ['exact', 'selector'], [])).toBe(true);
    expect(safelist.matchesSelector('.other', ['other'], [])).toBe(false);
  });
});
