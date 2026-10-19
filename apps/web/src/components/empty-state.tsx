import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** A friendly "nothing here yet" panel with an icon that gently floats. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-10 text-center animate-rise', className)}>
      <span className="mb-1 grid size-12 place-items-center rounded-2xl tint-indigo ring-1 ring-inset animate-float">
        <Icon className="size-6" aria-hidden />
      </span>
      <p className="text-sm font-medium">{title}</p>
      {children}
    </div>
  );
}
