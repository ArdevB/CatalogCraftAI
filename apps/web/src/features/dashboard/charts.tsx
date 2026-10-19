import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Small, dependency-free charts for the dashboard. They draw plain SVG at the
 * container's real pixel width (so lines and text stay crisp), colour
 * themselves from `currentColor` (set a `text-*` class on the parent), and
 * carry a text summary for screen readers.
 */

/** Width of an element, kept up to date as the layout changes. */
function useElementWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(1, Math.round(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

type Point = readonly [x: number, y: number];

/** A smooth curve through the points that never overshoots above `top` or below `bottom`. */
function smoothPath(points: Point[], top: number, bottom: number): string {
  if (points.length === 0) return '';
  const clamp = (y: number) => Math.min(bottom, Math.max(top, y));
  let d = `M${points[0]![0]},${points[0]![1]}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    const c1: Point = [p1[0] + (p2[0] - p0[0]) / 6, clamp(p1[1] + (p2[1] - p0[1]) / 6)];
    const c2: Point = [p2[0] - (p3[0] - p1[0]) / 6, clamp(p2[1] - (p3[1] - p1[1]) / 6)];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  return d;
}

/** A round upper bound for the y-axis: 4, 5, 10, 20, 50, 100… */
function niceMax(value: number): number {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((candidate) => candidate * magnitude >= value)!;
  return step * magnitude;
}

/** A tiny trend line for stat cards. Decorative: the card states the numbers in text. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const [ref, width] = useElementWidth<HTMLDivElement>(120);
  const gradientId = useId();
  const height = 40;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values.map((value, i): Point => [i * step, height - 3 - (value / max) * (height - 8)]);
  const line = smoothPath(points, 2, height - 2);

  return (
    <div ref={ref} className={cn('h-10 w-full min-w-0 overflow-hidden', className)} aria-hidden>
      <svg width={width} height={height} className="overflow-visible">
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity={0.22} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={`${line} L${width},${height} L0,${height} Z`} fill={`url(#${gradientId})`} className="animate-fade-in" />
        <path d={line} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" pathLength={1} className="animate-draw" />
      </svg>
    </div>
  );
}

export type ChartPoint = { date: string; value: number };

const dayLabel = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { ...options, timeZone: 'UTC' });

/**
 * Interactive area chart for daily figures. Hover (or focus it and use the
 * arrow keys) to read individual days.
 */
export function AreaChart({
  data,
  seriesLabel,
  emptyMessage,
  className,
}: {
  data: ChartPoint[];
  /** e.g. "products enriched" — used in the tooltip and the screen-reader summary. */
  seriesLabel: string;
  emptyMessage: string;
  className?: string;
}) {
  // Start narrow: the real width is measured straight away, and a wide guess would stretch phone layouts.
  const [ref, width] = useElementWidth<HTMLDivElement>(320);
  const [active, setActive] = useState<number | null>(null);
  const gradientId = useId();
  const height = 260;
  const pad = { top: 16, right: 12, bottom: 28, left: 36 };
  const plotWidth = Math.max(1, width - pad.left - pad.right);
  const plotHeight = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(0, ...data.map((point) => point.value)));
  const x = (i: number) => pad.left + (data.length > 1 ? (i / (data.length - 1)) * plotWidth : plotWidth / 2);
  const y = (value: number) => pad.top + plotHeight - (value / max) * plotHeight;
  const points = data.map((point, i): Point => [x(i), y(point.value)]);
  const line = smoothPath(points, pad.top, pad.top + plotHeight);
  const total = data.reduce((sum, point) => sum + point.value, 0);
  const busiest = data.reduce<ChartPoint | null>((best, point) => (point.value > (best?.value ?? 0) ? point : best), null);
  // Roughly one date label per 80 px, so they never overlap on narrow screens.
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(plotWidth / 80))));
  const activePoint = active === null ? null : data[active];

  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - box.left - pad.left) / plotWidth;
    setActive(Math.min(data.length - 1, Math.max(0, Math.round(ratio * (data.length - 1)))));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const delta = event.key === 'ArrowLeft' ? -1 : 1;
    setActive((current) => Math.min(data.length - 1, Math.max(0, (current ?? data.length - 1) + delta)));
  };

  return (
    <figure className={cn('relative m-0 min-w-0', className)}>
      <figcaption className="sr-only">
        {`${total.toLocaleString()} ${seriesLabel} in the last ${data.length} days.`}
        {busiest ? ` Busiest day: ${dayLabel(busiest.date, { day: 'numeric', month: 'long' })} with ${busiest.value.toLocaleString()}.` : ''}
      </figcaption>
      <div
        ref={ref}
        role="img"
        aria-label={activePoint ? `${dayLabel(activePoint.date, { weekday: 'long', day: 'numeric', month: 'long' })}: ${activePoint.value} ${seriesLabel}` : `Chart of ${seriesLabel} per day`}
        tabIndex={0}
        className="relative w-full min-w-0 touch-pan-y overflow-hidden rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
      >
        <svg width={width} height={height} className="block overflow-visible">
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.24} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map((fraction) => (
            <g key={fraction}>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={y(max * fraction)}
                y2={y(max * fraction)}
                className="stroke-border"
                strokeDasharray={fraction === 0 ? undefined : '3 4'}
              />
              <text x={pad.left - 8} y={y(max * fraction)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
                {(max * fraction).toLocaleString()}
              </text>
            </g>
          ))}
          {data.map((point, i) =>
            (i % labelEvery === 0 && data.length - 1 - i >= labelEvery / 2) || i === data.length - 1 ? (
              <text key={point.date} x={x(i)} y={height - 8} textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'} className="fill-muted-foreground text-[11px]">
                {dayLabel(point.date, { day: 'numeric', month: 'short' })}
              </text>
            ) : null,
          )}
          <path d={`${line} L${x(data.length - 1)},${pad.top + plotHeight} L${x(0)},${pad.top + plotHeight} Z`} fill={`url(#${gradientId})`} className="animate-fade-in" />
          <path d={line} fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="animate-draw" />
          {activePoint && active !== null ? (
            <g>
              <line x1={x(active)} x2={x(active)} y1={pad.top} y2={pad.top + plotHeight} stroke="currentColor" strokeOpacity={0.25} />
              <circle cx={x(active)} cy={y(activePoint.value)} r={5} className="fill-card" stroke="currentColor" strokeWidth={2.5} />
            </g>
          ) : null}
        </svg>
        {activePoint && active !== null ? (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border bg-card px-3 py-2 text-xs shadow-lg"
            style={{ left: Math.min(width - 70, Math.max(70, x(active))), top: y(activePoint.value) - 12 }}
          >
            <p className="text-muted-foreground">{dayLabel(activePoint.date, { weekday: 'short', day: 'numeric', month: 'short' })}</p>
            <p className="text-sm font-semibold text-foreground tabular-nums">
              {activePoint.value.toLocaleString()} <span className="font-normal text-muted-foreground">{seriesLabel}</span>
            </p>
          </div>
        ) : null}
        {total === 0 ? (
          <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-muted-foreground">{emptyMessage}</p>
        ) : null}
      </div>
    </figure>
  );
}

/** A circular progress meter with content in the middle. */
export function ProgressRing({
  value,
  max,
  size = 132,
  label,
  children,
  className,
}: {
  value: number;
  max: number;
  size?: number;
  /** Accessible name, e.g. "Monthly products used". */
  label: string;
  children?: ReactNode;
  className?: string;
}) {
  const percent = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const stroke = 11;
  const radius = (size - stroke) / 2;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn('relative grid place-items-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" className="stroke-muted" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray="100 100"
          strokeDashoffset={100 - percent}
          className="animate-ring"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

export type Segment = { key: string; label: string; value: number; className: string };

/** A single stacked bar with a legend: how a total splits into parts. */
export function StackedBar({ segments, label }: { segments: Segment[]; label: string }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  return (
    <div className="flex flex-col gap-4">
      <div
        role="img"
        aria-label={`${label}: ${segments.filter((s) => s.value > 0).map((s) => `${s.value} ${s.label.toLowerCase()}`).join(', ') || 'none yet'}`}
        className="flex h-3 w-full gap-1 overflow-hidden rounded-full bg-muted"
      >
        {total > 0
          ? segments
              .filter((segment) => segment.value > 0)
              .map((segment, i) => (
                <div
                  key={segment.key}
                  className={cn('h-full rounded-full animate-grow-x', segment.className)}
                  style={{ width: `${(segment.value / total) * 100}%`, animationDelay: `${i * 90}ms` }}
                />
              ))
          : null}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
        {segments.map((segment) => (
          <li key={segment.key} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-muted-foreground">
              <span className={cn('size-2.5 rounded-full', segment.className)} aria-hidden />
              {segment.label}
            </span>
            <span className="font-medium tabular-nums">{segment.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
