import type { Finding } from '@css-archaeology/core';
import { Badge } from '@/components/ui/badge';

export function SeverityBadge({ severity }: { severity: Finding['severity'] }) {
  return <Badge variant={severity}>{severity}</Badge>;
}

export function ConfidenceLabel({ finding }: { finding: Pick<Finding, 'confidence' | 'confidenceScore'> }) {
  return (
    <span className="text-xs">
      <span className="font-medium text-primary">{finding.confidence}</span> <span className="text-muted-foreground">{finding.confidenceScore.toFixed(2)}</span>
    </span>
  );
}

export const specificityText = (s: [number, number, number]) => `(${s[0]},${s[1]},${s[2]})`;
