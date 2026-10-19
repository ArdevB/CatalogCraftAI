import type { ComponentProps, CSSProperties } from 'react';
import { cn } from '@/lib/utils';

/**
 * Table primitives with one consistent look: a rounded, bordered card that
 * scrolls sideways on small screens, quiet headers, and rows that highlight on
 * hover and fade in one after another.
 */
export function Table({ className, wrapperClassName, ...props }: ComponentProps<'table'> & { wrapperClassName?: string }) {
  return (
    <div className={cn('overflow-x-auto rounded-xl border bg-card', wrapperClassName)}>
      <table className={cn('w-full text-sm', className)} {...props} />
    </div>
  );
}

export function TableHead({ className, ...props }: ComponentProps<'thead'>) {
  return <thead className={cn('border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground', className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return <tbody className={cn('divide-y', className)} {...props} />;
}

export function TableRow({ className, index, style, ...props }: ComponentProps<'tr'> & { index?: number }) {
  // Only the first rows are staggered, so long tables still appear quickly.
  const delay: CSSProperties | undefined = index === undefined ? undefined : { animationDelay: `${Math.min(index, 12) * 35}ms` };
  return (
    <tr
      className={cn('transition-colors hover:bg-muted/50', index !== undefined && 'animate-rise', className)}
      style={{ ...delay, ...style }}
      {...props}
    />
  );
}

export function TableHeader({ className, ...props }: ComponentProps<'th'>) {
  return <th scope="col" className={cn('px-4 py-3 font-medium', className)} {...props} />;
}

export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return <td className={cn('px-4 py-3', className)} {...props} />;
}
