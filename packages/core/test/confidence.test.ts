import { describe, expect, it } from 'vitest';
import { confidenceLevel, factor, scoreConfidence } from '../src/confidence.js';
import { extractBreakpoints, extractColors, extractLengths, toPx } from '../src/tokens.js';

describe('confidence scoring', () => {
  it('combines base score and factors with clamping', () => {
    expect(scoreConfidence(0.9, [factor('a', -0.2, 'x')])).toEqual({ score: 0.7, level: 'medium' });
    expect(scoreConfidence(0.9, [factor('a', 0.5, 'x')]).score).toBe(0.99);
    expect(scoreConfidence(0.1, [factor('a', -0.5, 'x')]).score).toBe(0.05);
    expect([confidenceLevel(0.75), confidenceLevel(0.45), confidenceLevel(0.44)]).toEqual(['high', 'medium', 'low']);
  });
});

describe('token extraction', () => {
  it('extracts colours, lengths and breakpoints', () => {
    expect(extractColors('1px solid #FFF, rgba(0,0,0,.5) var(--x, red)')).toEqual(['rgba(0, 0, 0, .5)', '#ffffff']);
    expect(extractColors('url(#abc) white')).toEqual(['white']);
    expect(extractLengths('0 12px 1.5rem -4px 0px')).toEqual(['12px', '1.5rem', '-4px']);
    expect(extractBreakpoints('(min-width: 48em) and (max-width: 1023px)')).toEqual([
      { value: '48em', px: 768, bound: 'min' },
      { value: '1023px', px: 1023, bound: 'max' },
    ]);
    expect(extractBreakpoints('(width >= 600px)')).toEqual([{ value: '600px', px: 600, bound: 'min' }]);
    expect(toPx('2rem')).toBe(32);
  });
});
