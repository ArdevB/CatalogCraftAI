import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type Tint = 'indigo' | 'emerald' | 'amber' | 'sky' | 'rose' | 'violet';
export const TINT_CLASS: Record<Tint, string> = {
  indigo: 'tint-indigo',
  emerald: 'tint-emerald',
  amber: 'tint-amber',
  sky: 'tint-sky',
  rose: 'tint-rose',
  violet: 'tint-violet',
};

/** The top of every signed-in page: icon, title, description and actions, easing in together. */
export function PageHeader({
  title,
  description,
  icon: Icon,
  tint = 'indigo',
  eyebrow,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  tint?: Tint;
  /** Small line above the title, e.g. a back link. */
  eyebrow?: ReactNode;
  actions?: ReactNode;
  /** Extra content under the description (badges, meta). */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-4 animate-rise sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="flex min-w-0 flex-col gap-3">
        {eyebrow}
        <div className="flex items-start gap-4">
          {Icon ? (
            <span className={cn('hidden size-12 shrink-0 place-items-center rounded-2xl ring-1 ring-inset sm:grid', TINT_CLASS[tint])}>
              <Icon className="size-6" aria-hidden />
            </span>
          ) : null}
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{title}</h1>
            {description ? <div className="max-w-2xl text-sm text-muted-foreground text-pretty">{description}</div> : null}
            {children}
          </div>
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
