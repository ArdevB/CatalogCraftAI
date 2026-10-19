import { ArrowDownRight, ArrowRight, ArrowUpRight, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Sparkline } from './charts';

const prefersReducedMotion = () =>
  typeof window === 'undefined' || typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Counts up to `target` once, easing out. Shows the final number straight away if motion is reduced. */
export function useCountUp(target: number, durationMs = 900): number {
  const [reduce] = useState(prefersReducedMotion);
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (reduce) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      setValue(Math.round(target * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs, reduce]);
  return reduce ? target : value;
}

/** Last 7 days against the 7 before them, as a rounded percentage (null when there's nothing to compare). */
export function weekOverWeek(values: number[]): number | null {
  const current = values.slice(-7).reduce((a, b) => a + b, 0);
  const previous = values.slice(-14, -7).reduce((a, b) => a + b, 0);
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export const ACCENTS = {
  indigo: { chip: 'tint-indigo', line: 'text-indigo-500' },
  amber: { chip: 'tint-amber', line: 'text-amber-500' },
  sky: { chip: 'tint-sky', line: 'text-sky-500' },
  emerald: { chip: 'tint-emerald', line: 'text-emerald-500' },
} as const;

export function StatCard({
  label,
  value,
  icon: Icon,
  accent,
  detail,
  trend,
  spark,
  to,
  cta,
  delay = 0,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  accent: keyof typeof ACCENTS;
  detail?: ReactNode;
  /** Week-over-week change in percent. */
  trend?: number | null;
  spark?: number[];
  to?: string;
  /** Shown at the bottom of cards without a sparkline, e.g. "Review now". */
  cta?: string;
  delay?: number;
}) {
  const shown = useCountUp(value);
  const colours = ACCENTS[accent];
  const body = (
    <Card
      className={cn('group relative flex h-full min-w-0 flex-col gap-3 overflow-hidden p-5 transition-all animate-rise', to && 'hover:-translate-y-0.5 hover:shadow-lg')}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <span className={cn('grid size-9 place-items-center rounded-lg ring-1 ring-inset', colours.chip)}>
          <Icon className="size-[18px]" aria-hidden />
        </span>
      </div>
      <div className="flex items-end gap-2">
        {/* The accessible text is the real number, not the animation frame. */}
        <p className="text-3xl font-semibold tracking-tight tabular-nums" aria-label={value.toLocaleString()}>
          <span aria-hidden>{shown.toLocaleString()}</span>
        </p>
        {trend !== undefined && trend !== null ? (
          <span
            className={cn(
              'mb-1 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium',
              trend >= 0 ? 'tint-emerald' : 'tint-rose',
            )}
            title="Last 7 days compared with the 7 days before"
          >
            {trend >= 0 ? <ArrowUpRight className="size-3" aria-hidden /> : <ArrowDownRight className="size-3" aria-hidden />}
            {Math.abs(trend)}%<span className="sr-only"> {trend >= 0 ? 'more' : 'fewer'} than the previous week</span>
          </span>
        ) : null}
      </div>
      {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
      {spark ? <Sparkline values={spark} className={cn('mt-auto', colours.line)} /> : null}
      {!spark && cta ? (
        <span className="mt-auto inline-flex items-center gap-1 pt-2 text-xs font-medium text-primary">
          {cta}
          <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </span>
      ) : null}
    </Card>
  );
  return to ? (
    <Link to={to} className="block min-w-0 rounded-xl focus-visible:outline-2 focus-visible:outline-ring">
      {body}
    </Link>
  ) : (
    body
  );
}
