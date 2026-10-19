import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** A placeholder block with a light sweeping shimmer while content loads. */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div aria-hidden className={cn('relative overflow-hidden rounded-lg bg-muted shimmer', className)} {...props} />;
}
