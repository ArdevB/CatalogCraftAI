import { ArrowDownRight, ArrowRight, ArrowUpRight, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Sparkline } from './charts';

const prefersReducedMotion = () =>
  typeof window === 'undefined' || typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A number that counts up to `value`, easing out. It writes each frame
 * straight into its own text node instead of re-rendering React 60 times a
 * second, so several counters at once cost next to nothing. Screen readers
 * get the real number from `aria-label` on the parent.
 */
export function CountUp({ value, durationMs = 900 }: { value: number; durationMs?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [reduce] = useState(prefersReducedMotion);
  useEffect(() => {
    const element = ref.current;
    if (reduce || !element) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      element.textContent = Math.round(value * (1 - (1 - progress) ** 3)).toLocaleString();
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs, reduce]);
  return (
    <span ref={ref} aria-hidden>
      {reduce ? value.toLocaleString() : '0'}
    </span>
  );
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
  featured = false,
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
  /** The one highlighted tile: filled with the brand gradient. */
  featured?: boolean;
  delay?: number;
}) {
  const colours = ACCENTS[accent];
  const body = (
    <Card
      className={cn(
        'group relative flex h-full min-w-0 flex-col gap-3 overflow-hidden rounded-3xl p-5 transition-[transform,box-shadow] duration-300 animate-rise',
        featured ? 'border-transparent bg-gradient-to-br from-indigo-600 via-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-500/25' : 'border-transparent',
        to && 'hover:-translate-y-1 hover:shadow-xl',
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      {featured ? <span aria-hidden className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-[radial-gradient(circle,rgb(255_255_255/0.3)_0%,transparent_65%)]  will-change-transform animate-drift-a" /> : null}
      <div className="relative flex items-center gap-3">
        <span
          className={cn(
            'grid size-11 shrink-0 place-items-center rounded-full ring-1 ring-inset transition-transform duration-300 group-hover:scale-110',
            featured ? 'bg-white/15 text-white ring-white/25' : colours.chip,
          )}
        >
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className={cn('truncate text-sm', featured ? 'text-white/80' : 'text-muted-foreground')}>{label}</p>
          <div className="flex items-center gap-2">
            {/* The accessible text is the real number, not the animation frame. */}
            <p className="text-2xl font-semibold tracking-tight tabular-nums" aria-label={value.toLocaleString()}>
              <CountUp value={value} />
            </p>
            {trend !== undefined && trend !== null ? (
              <span
                className={cn(
                  'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium',
                  featured ? 'bg-white/20 text-white' : trend >= 0 ? 'tint-emerald' : 'tint-rose',
                )}
                title="Last 7 days compared with the 7 days before"
              >
                {trend >= 0 ? <ArrowUpRight className="size-3" aria-hidden /> : <ArrowDownRight className="size-3" aria-hidden />}
                {Math.abs(trend)}%<span className="sr-only"> {trend >= 0 ? 'more' : 'fewer'} than the previous week</span>
              </span>
            ) : null}
          </div>
        </div>
      </div>
      {detail ? <p className={cn('relative text-xs', featured ? 'text-white/75' : 'text-muted-foreground')}>{detail}</p> : null}
      {spark ? <Sparkline values={spark} className={cn('relative mt-auto', featured ? 'text-white' : colours.line)} /> : null}
      {!spark && cta ? (
        <span className={cn('mt-auto inline-flex items-center gap-1 pt-1 text-xs font-medium', featured ? 'text-white' : 'text-primary')}>
          {cta}
          <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </span>
      ) : null}
    </Card>
  );
  return to ? (
    <Link to={to} className="block h-full min-w-0 rounded-3xl focus-visible:outline-2 focus-visible:outline-ring">
      {body}
    </Link>
  ) : (
    body
  );
}
