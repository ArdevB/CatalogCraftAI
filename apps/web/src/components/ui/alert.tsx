import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const alertVariants = cva('flex gap-2 rounded-lg border p-3 text-sm animate-rise [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0', {
  variants: {
    variant: {
      info: 'border-border bg-muted/60 text-foreground',
      success: 'border-success/25 bg-success/10 text-foreground [&_svg]:text-success',
      destructive: 'border-destructive/25 bg-destructive/5 text-foreground [&_svg]:text-destructive',
    },
  },
  defaultVariants: { variant: 'info' },
});

type AlertProps = ComponentProps<'div'> & VariantProps<typeof alertVariants>;

export function Alert({ className, variant, role, ...props }: AlertProps) {
  return (
    <div
      role={role ?? (variant === 'destructive' ? 'alert' : 'status')}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}
