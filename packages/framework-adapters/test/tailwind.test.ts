import { describe, expect, it } from 'vitest';
import { expandBraces, readTailwindSafelist } from '../src/tailwind.js';

describe('Tailwind helpers', () => {
  it('reads safelist strings and pattern prefixes without executing the config', () => {
    const config = `module.exports = { content: ['./src/**/*.tsx'], safelist: ['bg-red-500', 'text-3xl', { pattern: /^bg-(red|green)-(100|200)$/ }] };`;
    expect(readTailwindSafelist(config, 'tailwind.config.js')).toEqual({ classes: ['bg-red-500', 'text-3xl'], patterns: ['bg-'] });
  });

  it('expands @source inline braces and ranges', () => {
    expect(expandBraces('bg-{red,blue}-{100..300..100}')).toEqual(['bg-red-100', 'bg-red-200', 'bg-red-300', 'bg-blue-100', 'bg-blue-200', 'bg-blue-300']);
    expect(expandBraces('plain')).toEqual(['plain']);
  });
});
