import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  ClipboardCheck,
  FileDown,
  FileSpreadsheet,
  Fingerprint,
  FolderKanban,
  Layers,
  MailWarning,
  Plus,
  Search,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import type { DashboardSummary, JobStatus } from '@catalogcraft/shared';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/page-states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermission, useRequiredSession } from '@/features/auth/use-session';
import { useDashboardSummary } from '@/features/clients/use-clients';
import { AreaChart, HalfGauge, StackedBar, type Segment } from '@/features/dashboard/charts';
import { avatarFor, greeting, timeAgo } from '@/features/dashboard/format';
import { StatCard, weekOverWeek } from '@/features/dashboard/stat-card';
import { JobStatusBadge } from '@/features/jobs/job-status';
import { GettingStarted } from '@/features/onboarding/getting-started';
import { ROLE_LABELS } from '@/features/organization/role-badge';
import { SystemStatusCard } from '@/features/system/system-status-card';
import { apiUrl } from '@/lib/api-client';
import { PLAN_LABELS } from '@/lib/plans';
import { cn } from '@/lib/utils';

/* -------------------------------------------------------------- Building blocks */

function Avatar({ name, className }: { name: string; className?: string }) {
  const { initials, tone } = avatarFor(name);
  return (
    <span className={cn('grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold ring-1 ring-inset', tone, className)} aria-hidden>
      {initials}
    </span>
  );
}

/** The dashboard's card: big rounded corners, no hard border, like the rest of this page. */
function Panel({
  title,
  description,
  action,
  className,
  delay = 0,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  delay?: number;
  children: ReactNode;
}) {
  return (
    <Card className={cn('min-w-0 rounded-3xl border-transparent animate-rise', className)} style={{ animationDelay: `${delay}ms` }}>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0 pb-4">
        <div className="flex flex-col gap-1">
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** A small round "open" button for card corners (like the reference's ↗). */
function CornerLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      aria-label={label}
      title={label}
      className="grid size-9 place-items-center rounded-full bg-muted text-muted-foreground transition-all hover:-translate-y-0.5 hover:bg-primary hover:text-primary-foreground focus-visible:outline-2 focus-visible:outline-ring"
    >
      <ArrowUpRight className="size-4" aria-hidden />
    </Link>
  );
}

/* ------------------------------------------------------------------- Top bar */

function TopBar() {
  const session = useRequiredSession();
  const canEditJobs = usePermission('jobs:edit');
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const q = query.trim();
    void navigate(q ? `/clients?search=${encodeURIComponent(q)}` : '/clients');
  };

  return (
    <div className="flex flex-col gap-4 animate-rise md:flex-row md:items-center md:justify-between">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">
          {greeting()}, {session.user.name.split(' ')[0]}
        </h1>
        <p className="text-sm text-muted-foreground">Here’s what’s happening with your catalogues — {session.organization.name}.</p>
      </div>
      <div className="flex items-center gap-2">
        <form role="search" onSubmit={submit} className="relative flex-1 md:w-72 md:flex-none">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            aria-label="Search clients"
            placeholder="Search clients…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-11 w-full rounded-full border border-transparent bg-card pl-10 pr-12 text-sm shadow-[0_1px_2px_oklch(0.2_0.01_260/0.05)] outline-none transition-all placeholder:text-muted-foreground focus:border-ring focus:ring-4 focus:ring-ring/15"
          />
          <button
            type="submit"
            aria-label="Search"
            className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-foreground text-background transition-transform hover:scale-105"
          >
            <Search className="size-3.5" aria-hidden />
          </button>
        </form>
        {canEditJobs ? (
          <Link
            to="/clients"
            className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-md shadow-primary/30 transition-all hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-ring"
            title="New import"
          >
            <Plus className="size-5" aria-hidden />
            <span className="sr-only">New import</span>
          </Link>
        ) : null}
        <Link to="/settings/account" aria-label="Your account" className="rounded-full focus-visible:outline-2 focus-visible:outline-ring">
          <Avatar name={session.user.name} className="size-11 text-sm transition-transform hover:scale-105" />
        </Link>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Activity */

const SERIES = {
  productsEnriched: { label: 'Products enriched', unit: 'products enriched', colour: 'text-indigo-500', empty: 'Enriched products will appear here.' },
  exports: { label: 'Exports', unit: 'exports', colour: 'text-emerald-500', empty: 'Exports will appear here.' },
} as const;

function ActivityCard({ trend }: { trend: DashboardSummary['trend'] }) {
  const [series, setSeries] = useState<keyof typeof SERIES>('productsEnriched');
  const config = SERIES[series];
  const data = trend.map((day) => ({ date: day.date, value: day[series] }));
  const total = data.reduce((sum, point) => sum + point.value, 0);
  const week = data.slice(-7).reduce((sum, point) => sum + point.value, 0);
  const change = weekOverWeek(data.map((point) => point.value));
  const busiest = data.reduce<(typeof data)[number] | null>((best, point) => (point.value > (best?.value ?? 0) ? point : best), null);

  return (
    <Panel
      title="Activity"
      description={`${total.toLocaleString()} ${config.unit} in the last ${trend.length} days`}
      className="lg:col-span-6"
      delay={200}
      action={
        <div role="radiogroup" aria-label="Chart" className="flex rounded-full bg-muted p-1 text-xs font-medium">
          {(Object.keys(SERIES) as Array<keyof typeof SERIES>).map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={series === key}
              onClick={() => setSeries(key)}
              className={cn(
                'rounded-full px-3 py-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                series === key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {SERIES[key].label}
            </button>
          ))}
        </div>
      }
    >
      <div className="relative">
        {/* Floating chips over the chart, like the reference's callouts. */}
        {total > 0 ? (
          <div aria-hidden className="pointer-events-none absolute left-10 top-0 z-10 flex flex-wrap gap-2">
            <span className="rounded-xl bg-card px-3 py-1.5 text-xs shadow-md ring-1 ring-border/60 animate-rise" style={{ animationDelay: '700ms' }}>
              <span className="text-muted-foreground">This week</span>{' '}
              <span className="font-semibold tabular-nums">{week.toLocaleString()}</span>
              {change !== null ? (
                <span className={cn('ml-1.5 rounded-full px-1.5 py-0.5 font-medium', change >= 0 ? 'tint-emerald' : 'tint-rose')}>
                  {change >= 0 ? '+' : ''}
                  {change}%
                </span>
              ) : null}
            </span>
            {busiest ? (
              <span className="rounded-xl bg-card px-3 py-1.5 text-xs shadow-md ring-1 ring-border/60 animate-rise" style={{ animationDelay: '850ms' }}>
                <span className="text-muted-foreground">Busiest</span>{' '}
                <span className="font-semibold">
                  {new Date(`${busiest.date}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })} ·{' '}
                  {busiest.value.toLocaleString()}
                </span>
              </span>
            ) : null}
          </div>
        ) : null}
        {/* Re-mount on switch so the line draws in again. */}
        <AreaChart key={series} data={data} seriesLabel={config.unit} emptyMessage={config.empty} className={config.colour} />
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------------------- Plan */

function PlanCard({ summary }: { summary: DashboardSummary }) {
  const canSeeUsage = usePermission('usage:read');
  const { products, clients, jobs, plan } = summary;
  const now = new Date();
  const resets = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  const percent = products.limit ? Math.min(100, Math.round((products.used / products.limit) * 100)) : null;
  const row = (label: string, used: number, limit: number | null) => (
    <li className="flex items-center justify-between gap-2 py-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="whitespace-nowrap font-medium tabular-nums">{limit === null ? `${used} · unlimited` : `${used} of ${limit}`}</span>
    </li>
  );

  return (
    <Panel
      title="Plan"
      description={`${PLAN_LABELS[plan]} plan`}
      className="lg:col-span-3"
      delay={260}
      action={canSeeUsage ? <CornerLink to="/usage" label="Usage and plan" /> : null}
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Products enriched{' '}
          <span className="block text-2xl font-semibold tracking-tight text-foreground tabular-nums">{products.used.toLocaleString()}</span>
        </p>
        <HalfGauge
          value={products.used}
          max={products.limit ?? Math.max(products.used, 1)}
          label="Products enriched this month"
          className={percent !== null && percent >= 90 ? 'text-rose-500' : 'text-indigo-500'}
        >
          <p className="text-2xl font-semibold tracking-tight tabular-nums">{percent === null ? '∞' : `${percent}%`}</p>
          <p className="text-xs text-muted-foreground">{products.limit === null ? 'unlimited' : `of ${products.limit.toLocaleString()}`}</p>
        </HalfGauge>
        <p className="text-center text-xs text-muted-foreground">Resets on {resets}</p>
        <ul className="divide-y border-t">
          {row('Client workspaces', clients.used, clients.limit)}
          {row('Jobs in progress', jobs.active, jobs.activeLimit)}
        </ul>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------- Profile */

function ProfileCard({ summary }: { summary: DashboardSummary }) {
  const { user, role } = useRequiredSession();
  const jobs = Object.values(summary.jobsByStatus).reduce((sum, count) => sum + (count ?? 0), 0);
  const exports = summary.trend.reduce((sum, day) => sum + day.exports, 0);
  const stats = [
    { label: 'Clients', value: summary.clients.used },
    { label: 'Jobs', value: jobs },
    { label: 'Exports', value: exports },
  ];
  return (
    <Card className="flex min-w-0 flex-col items-center gap-4 rounded-3xl border-transparent p-6 text-center animate-rise lg:col-span-3" style={{ animationDelay: '320ms' }}>
      <div className="relative">
        <span aria-hidden className="absolute -inset-1.5 rounded-full bg-gradient-to-br from-indigo-500 via-violet-500 to-sky-400 opacity-80 animate-spin [animation-duration:8s]" />
        <span aria-hidden className="absolute -inset-0.5 rounded-full bg-card" />
        <Avatar name={user.name} className="relative size-20 text-2xl" />
      </div>
      <div className="flex flex-col items-center gap-1">
        <p className="text-lg font-semibold">{user.name}</p>
        <p className="flex max-w-full items-center gap-1.5 text-sm text-muted-foreground">
          <span className="truncate">{user.email}</span>
          {user.emailVerified ? (
            <BadgeCheck className="size-4 shrink-0 text-success" aria-label="Email verified" />
          ) : (
            <MailWarning className="size-4 shrink-0 text-warning" aria-label="Email not verified" />
          )}
        </p>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{ROLE_LABELS[role]}</p>
      </div>
      <dl className="mt-auto grid w-full grid-cols-3 divide-x rounded-2xl bg-muted/50 py-3">
        {stats.map((stat) => (
          <div key={stat.label} className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">{stat.label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{stat.value.toLocaleString()}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/* -------------------------------------------------------------- Import promo */

/** The reference's "credit card" spot: a call to start an import, with a playful spreadsheet stack. */
function ImportCard({ clients }: { clients: DashboardSummary['recentClients'] }) {
  const canManage = usePermission('clients:manage');
  const canEditJobs = usePermission('jobs:edit');
  return (
    <Card className="relative grid min-w-0 gap-6 overflow-hidden rounded-3xl border-transparent p-6 animate-rise sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:col-span-5" style={{ animationDelay: '380ms' }}>
      <div className="relative z-10 flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Import a supplier file</h2>
        <p className="text-sm text-muted-foreground">
          CSV or Excel, mapped in seconds. AI suggests better titles and descriptions — you approve every change.
        </p>
        {clients.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recent clients</p>
            <ul className="flex flex-wrap gap-2">
              {clients.slice(0, 4).map((client) => (
                <li key={client.id}>
                  <Link
                    to={`/clients/${client.id}`}
                    className="flex items-center gap-2 rounded-full bg-muted/60 py-1 pl-1 pr-3 text-xs font-medium transition-colors hover:bg-primary hover:text-primary-foreground"
                  >
                    <Avatar name={client.name} className="size-6 text-[10px]" />
                    {client.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : canManage ? null : (
          <p className="text-sm text-muted-foreground">An owner or admin can add client workspaces.</p>
        )}
        <div className="mt-auto pt-2">
          {clients.length === 0 && canManage ? (
            <Button asChild className="rounded-full">
              <Link to="/clients/new">
                Create your first client <ArrowRight aria-hidden />
              </Link>
            </Button>
          ) : canEditJobs && clients.length > 0 ? (
            <Button asChild className="rounded-full">
              <Link to="/clients">
                Start an import <ArrowRight aria-hidden />
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
      {/* Decorative: three spreadsheet cards fanned out, floating gently. */}
      <div aria-hidden className="relative hidden min-h-44 sm:block">
        <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-indigo-500/15 via-violet-500/10 to-sky-400/15" />
        {[
          { rotate: '-rotate-12', offset: 'left-[12%] top-[22%]', tone: 'from-sky-400 to-indigo-500', delay: '0ms' },
          { rotate: '-rotate-3', offset: 'left-[22%] top-[14%]', tone: 'from-indigo-500 to-violet-500', delay: '400ms' },
          { rotate: 'rotate-6', offset: 'left-[32%] top-[8%]', tone: 'from-violet-500 to-fuchsia-500', delay: '800ms' },
        ].map((card, i) => (
          <div key={i} className={cn('absolute w-[58%]', card.offset)}>
            <div className={cn('animate-float', card.rotate)} style={{ animationDelay: card.delay }}>
              <div className={cn('rounded-2xl bg-gradient-to-br p-3 shadow-xl', card.tone)}>
                <div className="mb-2 flex items-center gap-1.5">
                  <FileSpreadsheet className="size-4 text-white/90" />
                  <span className="h-1.5 w-12 rounded-full bg-white/50" />
                </div>
                {[0, 1, 2].map((r) => (
                  <div key={r} className="mt-1.5 grid grid-cols-3 gap-1.5">
                    <span className="h-1.5 rounded-full bg-white/40" />
                    <span className="h-1.5 rounded-full bg-white/30" />
                    <span className="h-1.5 rounded-full bg-white/20" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------- Exports */

function ExportsCard({ exports }: { exports: DashboardSummary['recentExports'] }) {
  return (
    <Panel title="Your exports" className="lg:col-span-4" delay={440} action={exports.length > 0 ? <CornerLink to="/jobs" label="All jobs" /> : null}>
      {exports.length === 0 ? (
        <EmptyState icon={FileSpreadsheet} title="No exports yet">
          <p className="max-w-xs text-sm text-muted-foreground">Review a job’s suggestions, then export it as CSV.</p>
        </EmptyState>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {exports.map((item, index) => (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-2xl px-2 py-2 transition-colors animate-rise hover:bg-muted/60"
              style={{ animationDelay: `${500 + index * 50}ms` }}
            >
              <a
                href={apiUrl(`/exports/${item.id}/download`)}
                aria-label={`Download ${item.filename}`}
                className="grid size-9 shrink-0 place-items-center rounded-full tint-emerald ring-1 ring-inset transition-transform hover:scale-110"
              >
                <FileDown className="size-4" aria-hidden />
              </a>
              <div className="min-w-0 flex-1">
                <Link to={`/jobs/${item.jobId}`} className="block truncate text-sm font-medium hover:text-primary">
                  {item.filename}
                </Link>
                <p className="text-xs text-muted-foreground">{timeAgo(item.createdAt)}</p>
              </div>
              <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums tint-emerald">+{item.rowCount.toLocaleString()} rows</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ Security */

function SecurityCard() {
  const { user } = useRequiredSession();
  return (
    <Card className="flex min-w-0 flex-col items-center justify-center gap-3 rounded-3xl border-transparent p-6 text-center animate-rise lg:col-span-3" style={{ animationDelay: '500ms' }}>
      <span className="relative isolate grid size-20 place-items-center rounded-full tint-indigo ring-1 ring-inset">
        <span aria-hidden className="absolute inset-0 -z-10 rounded-full text-indigo-400 animate-pulse-ring" />
        <Fingerprint className="size-10" aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">Keep your account safe</h2>
        <p className="text-sm text-muted-foreground">
          {user.emailVerified ? 'Your email is confirmed. Use a long, unique password.' : 'Confirm your email so you can always reset your password.'}
        </p>
      </div>
      <Button asChild size="sm" className="rounded-full">
        <Link to="/settings/account">Update your security</Link>
      </Button>
    </Card>
  );
}

/* ------------------------------------------------------------ Jobs, pipeline */

const PIPELINE: Array<{ key: string; label: string; statuses: JobStatus[]; className: string }> = [
  { key: 'setup', label: 'Setting up', statuses: ['draft', 'uploaded', 'validating', 'ready'], className: 'bg-slate-400' },
  { key: 'ai', label: 'Enriching', statuses: ['queued', 'processing'], className: 'bg-sky-500' },
  { key: 'review', label: 'In review', statuses: ['review'], className: 'bg-amber-500' },
  { key: 'done', label: 'Completed', statuses: ['exporting', 'completed'], className: 'bg-emerald-500' },
  { key: 'failed', label: 'Failed', statuses: ['failed'], className: 'bg-rose-500' },
];

function PipelineCard({ jobsByStatus }: { jobsByStatus: DashboardSummary['jobsByStatus'] }) {
  const segments: Segment[] = PIPELINE.map((group) => ({
    key: group.key,
    label: group.label,
    className: group.className,
    value: group.statuses.reduce((sum, status) => sum + (jobsByStatus[status] ?? 0), 0),
  }));
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  return (
    <Panel title="Job pipeline" description={`${total} job${total === 1 ? '' : 's'} in total`} delay={560}>
      <StackedBar segments={segments} label="Jobs by stage" />
    </Panel>
  );
}

function RecentJobsCard({ jobs, canStart }: { jobs: DashboardSummary['recentJobs']; canStart: boolean }) {
  return (
    <Panel
      title="Recent jobs"
      description="Imports across all clients"
      className="lg:col-span-8"
      delay={520}
      action={jobs.length > 0 ? <CornerLink to="/jobs" label="View all jobs" /> : null}
    >
      {jobs.length === 0 ? (
        <EmptyState icon={FolderKanban} title="No imports yet">
          <p className="max-w-xs text-sm text-muted-foreground">Open a client and choose “New import” to upload a supplier file.</p>
          {canStart ? (
            <Button asChild size="sm" variant="outline" className="mt-1 rounded-full">
              <Link to="/clients">Choose a client</Link>
            </Button>
          ) : null}
        </EmptyState>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {jobs.map((job, index) => (
            <li
              key={job.id}
              className="flex items-center gap-3 rounded-2xl px-2 py-2.5 transition-colors animate-rise hover:bg-muted/60"
              style={{ animationDelay: `${580 + index * 50}ms` }}
            >
              <Avatar name={job.clientName} />
              <div className="min-w-0 flex-1">
                <Link to={`/jobs/${job.id}`} className="block truncate text-sm font-medium hover:text-primary hover:underline">
                  {job.name}
                </Link>
                <p className="truncate text-xs text-muted-foreground">
                  {job.clientName} · {timeAgo(job.updatedAt)}
                </p>
              </div>
              <JobStatusBadge status={job.status} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ---------------------------------------------------------------------- Page */

function DashboardSkeleton() {
  return (
    <div role="status" className="grid gap-5 lg:grid-cols-12">
      <span className="sr-only">Loading dashboard…</span>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-32 rounded-3xl lg:col-span-3" />
      ))}
      <Skeleton className="h-80 rounded-3xl lg:col-span-6" />
      <Skeleton className="h-80 rounded-3xl lg:col-span-3" />
      <Skeleton className="h-80 rounded-3xl lg:col-span-3" />
    </div>
  );
}

function Overview() {
  const summary = useDashboardSummary();
  const canEditJobs = usePermission('jobs:edit');
  const canSeeUsage = usePermission('usage:read');

  if (summary.isPending) return <DashboardSkeleton />;
  if (summary.isError) {
    return <ErrorState title="Could not load the dashboard" error={summary.error} onRetry={() => void summary.refetch()} isRetrying={summary.isFetching} />;
  }

  const data = summary.data;
  const enriched = data.trend.map((day) => day.productsEnriched);
  const exported = data.trend.map((day) => day.exports);
  const exports30 = exported.reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-col gap-5">
      <GettingStarted summary={data} />

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-12">
        <div className="lg:col-span-3">
          <StatCard
            label="Products enriched"
            value={data.products.used}
            icon={Sparkles}
            accent="indigo"
            detail={data.products.limit === null ? 'This month · unlimited on your plan' : `This month · of ${data.products.limit.toLocaleString()} on your plan`}
            trend={weekOverWeek(enriched)}
            to={canSeeUsage ? '/usage' : undefined}
          />
        </div>
        <div className="lg:col-span-3">
          <StatCard
            label="Awaiting review"
            value={data.pendingSuggestions}
            icon={ClipboardCheck}
            accent="amber"
            detail={`${data.jobs.needsReview} job${data.jobs.needsReview === 1 ? '' : 's'} in review`}
            to="/jobs"
            delay={60}
          />
        </div>
        <div className="lg:col-span-3">
          <StatCard
            label="Jobs in progress"
            value={data.jobs.active}
            icon={Layers}
            accent="sky"
            detail={
              data.jobs.failed > 0
                ? `${data.jobs.failed} failed — open the job to see why`
                : data.jobs.activeLimit === null
                  ? 'No limit on your plan'
                  : `Up to ${data.jobs.activeLimit} at a time on your plan`
            }
            to="/jobs"
            delay={120}
          />
        </div>
        <div className="lg:col-span-3">
          <StatCard
            label="Exports"
            value={exports30}
            icon={TrendingUp}
            accent="emerald"
            detail="Last 30 days"
            trend={weekOverWeek(exported)}
            spark={exported.slice(-14)}
            featured
            delay={180}
          />
        </div>

        <ActivityCard trend={data.trend} />
        <PlanCard summary={data} />
        <ProfileCard summary={data} />

        <ImportCard clients={data.recentClients} />
        <ExportsCard exports={data.recentExports} />
        <SecurityCard />

        <RecentJobsCard jobs={data.recentJobs} canStart={canEditJobs} />
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-4">
          <PipelineCard jobsByStatus={data.jobsByStatus} />
          <SystemStatusCard />
        </div>
      </div>
    </div>
  );
}

export function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <TopBar />
      <Overview />
    </div>
  );
}
