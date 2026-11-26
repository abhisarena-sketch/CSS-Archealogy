import type { Confidence, ConfidenceFactor } from './types.js';

export const CONFIDENCE_THRESHOLDS = { high: 0.75, medium: 0.45 } as const;

/**
 * Combine a base score with evidence factors. Scores are clamped to 0.05..0.99:
 * static analysis is never certain, and a finding is never reported with zero support.
 */
export function scoreConfidence(base: number, factors: ConfidenceFactor[] = []): { score: number; level: Confidence } {
  let score = base;
  for (const f of factors) score += f.effect;
  score = Math.min(0.99, Math.max(0.05, score));
  score = Math.round(score * 100) / 100;
  return { score, level: confidenceLevel(score) };
}

export function confidenceLevel(score: number): Confidence {
  if (score >= CONFIDENCE_THRESHOLDS.high) return 'high';
  if (score >= CONFIDENCE_THRESHOLDS.medium) return 'medium';
  return 'low';
}

export function factor(name: string, effect: number, detail: string): ConfidenceFactor {
  return { factor: name, effect, detail };
}
