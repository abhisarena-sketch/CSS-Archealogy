import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide', {
  variants: {
    variant: {
      default: 'border-transparent bg-primary/10 text-primary',
      outline: 'border-border text-muted-foreground',
      high: 'border-severity-high/30 bg-severity-high/10 text-severity-high',
      medium: 'border-severity-medium/30 bg-severity-medium/10 text-severity-medium',
      low: 'border-border bg-muted text-foreground',
      info: 'border-border bg-background text-muted-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
