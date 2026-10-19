import {
  ArrowRight,
  Building2,
  ClipboardCheck,
  Download,
  FileDown,
  FileSpreadsheet,
  FolderKanban,
  Layers,
  Plus,
  Sparkles,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { DashboardSummary, JobStatus } from '@catalogcraft/shared';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/page-states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { usePermission, useRequiredSession } from '@/features/auth/use-session';
import { useDashboardSummary } from '@/features/clients/use-clients';
import { AreaChart, ProgressRing, StackedBar, type Segment } from '@/features/dashboard/charts';
import { avatarFor, greeting, timeAgo } from '@/features/dashboard/format';
import { StatCard, weekOverWeek } from '@/features/dashboard/stat-card';
import { JobStatusBadge } from '@/features/jobs/job-status';
import { GettingStarted } from '@/features/onboarding/getting-started';
import { SystemStatusCard } from '@/features/system/system-status-card';
import { apiUrl } from '@/lib/api-client';
import { PLAN_LABELS } from '@/lib/plans';
import { cn } from '@/lib/utils';

function Avatar({ name }: { name: string }) {
  const { initials, tone } = avatarFor(name);
  return (
    <span className={cn('grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold', tone)} aria-hidden>
      {initials}
    </span>
  );
}

/** Card with a title row (and optional action) used across the dashboard. */
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
    <Card className={cn('min-w-0 animate-rise', className)} style={{ animationDelay: `${delay}ms` }}>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-4 space-y-0 pb-4">
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

/* ---------------------------------------------------------------- Activity */

const SERIES = {
  productsEnriched: { label: 'Products enriched', unit: 'products enriched', colour: 'text-indigo-500', empty: 'Enriched products will appear here.' },
  exports: { label: 'Exports', unit: 'exports', colour: 'text-emerald-500', empty: 'Exports will appear here.' },
} as const;

function ActivityCard({ trend }: { trend: DashboardSummary['trend'] }) {
  const [series, setSeries] = useState<keyof typeof SERIES>('productsEnriched');
  const config = SERIES[series];
  const data = trend.map((day) => ({ date: day.date, value: day[series] }));
  const total = data.reduce((sum, point) => sum + point.value, 0);

  return (
    <Panel
      title="Activity"
      description={`${total.toLocaleString()} ${config.unit} in the last ${trend.length} days`}
      className="lg:col-span-2"
      delay={240}
      action={
        <div role="radiogroup" aria-label="Chart" className="flex rounded-lg bg-muted p-1 text-xs font-medium">
          {(Object.keys(SERIES) as Array<keyof typeof SERIES>).map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={series === key}
              onClick={() => setSeries(key)}
              className={cn(
                'rounded-md px-3 py-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                series === key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {SERIES[key].label}
            </button>
          ))}
        </div>
      }
    >
      {/* Re-mount on switch so the line draws in again. */}
      <AreaChart key={series} data={data} seriesLabel={config.unit} emptyMessage={config.empty} className={config.colour} />
    </Panel>
  );
}

/* -------------------------------------------------------------------- Plan */

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
  const limitRow = (label: string, used: number, limit: number | null) => (
    <li className="flex items-center justify-between gap-3 py-2.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{limit === null ? `${used} · unlimited` : `${used} of ${limit}`}</span>
    </li>
  );

  return (
    <Panel
      title="Plan"
      description={`${PLAN_LABELS[plan]} plan`}
      delay={300}
      action={
        canSeeUsage ? (
          <Button asChild variant="ghost" size="sm">
            <Link to="/usage">
              Usage <ArrowRight aria-hidden />
            </Link>
          </Button>
        ) : null
      }
    >
      <div className="flex flex-col items-center gap-4">
        <ProgressRing
          value={products.used}
          max={products.limit ?? Math.max(products.used, 1)}
          label="Products enriched this month"
          className={percent !== null && percent >= 90 ? 'text-rose-500' : 'text-indigo-500'}
        >
          <div>
            <p className="text-2xl font-semibold tracking-tight text-foreground tabular-nums">{percent === null ? '∞' : `${percent}%`}</p>
            <p className="text-xs text-muted-foreground">used</p>
          </div>
        </ProgressRing>
        <p className="text-center text-sm text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">{products.used.toLocaleString()}</span>
          {products.limit === null ? ' products this month · unlimited' : ` of ${products.limit.toLocaleString()} products this month`}
          <br />
          Resets on {resets}
        </p>
      </div>
      <ul className="mt-4 divide-y border-t">
        {limitRow('Client workspaces', clients.used, clients.limit)}
        {limitRow('Jobs in progress', jobs.active, jobs.activeLimit)}
      </ul>
    </Panel>
  );
}

/* ---------------------------------------------------------------- Pipeline */

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
    <Panel title="Job pipeline" description={`${total} job${total === 1 ? '' : 's'} in total`} delay={420}>
      <StackedBar segments={segments} label="Jobs by stage" />
    </Panel>
  );
}

/* ------------------------------------------------------------------- Lists */

function RecentJobsCard({ jobs, canStart }: { jobs: DashboardSummary['recentJobs']; canStart: boolean }) {
  return (
    <Panel
      title="Recent jobs"
      description="Imports across all clients"
      className="lg:col-span-2"
      delay={360}
      action={
        jobs.length > 0 ? (
          <Button asChild variant="ghost" size="sm">
            <Link to="/jobs">
              View all <ArrowRight aria-hidden />
            </Link>
          </Button>
        ) : null
      }
    >
      {jobs.length === 0 ? (
        <EmptyState icon={FolderKanban} title="No imports yet">
          <p className="max-w-xs text-sm text-muted-foreground">Open a client and choose “New import” to upload a supplier file.</p>
          {canStart ? (
            <Button asChild size="sm" variant="outline" className="mt-1">
              <Link to="/clients">Choose a client</Link>
            </Button>
          ) : null}
        </EmptyState>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {jobs.map((job) => (
            <li key={job.id} className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/60">
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

function RecentExportsCard({ exports }: { exports: DashboardSummary['recentExports'] }) {
  return (
    <Panel title="Recent exports" description="Clean CSV files, ready to download" className="lg:col-span-2" delay={480}>
      {exports.length === 0 ? (
        <EmptyState icon={FileSpreadsheet} title="No exports yet">
          <p className="max-w-xs text-sm text-muted-foreground">Review a job’s suggestions, then export it as CSV.</p>
        </EmptyState>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {exports.map((item) => (
            <li key={item.id} className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/60">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg tint-emerald ring-1 ring-inset" aria-hidden>
                <FileSpreadsheet className="size-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                <Link to={`/jobs/${item.jobId}`} className="block truncate text-sm font-medium hover:text-primary hover:underline">
                  {item.filename}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {item.rowCount.toLocaleString()} rows · {timeAgo(item.createdAt)}
                </p>
              </div>
              <Button asChild variant="ghost" size="sm">
                <a href={apiUrl(`/exports/${item.id}/download`)} aria-label={`Download ${item.filename}`}>
                  <Download aria-hidden />
                  <span className="hidden sm:inline">Download</span>
                </a>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ClientsCard({ clients, canManage }: { clients: DashboardSummary['recentClients']; canManage: boolean }) {
  return (
    <Panel
      title="Clients"
      description="Recently updated"
      delay={540}
      action={
        clients.length > 0 ? (
          <Button asChild variant="ghost" size="sm">
            <Link to="/clients">
              View all <ArrowRight aria-hidden />
            </Link>
          </Button>
        ) : null
      }
    >
      {clients.length === 0 ? (
        <EmptyState icon={Building2} title="No clients yet">
          {canManage ? (
            <Button asChild size="sm" className="mt-1">
              <Link to="/clients/new">Create your first client</Link>
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">An owner or admin can add client workspaces.</p>
          )}
        </EmptyState>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {clients.map((client) => (
            <li key={client.id}>
              <Link to={`/clients/${client.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60">
                <Avatar name={client.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{client.name}</span>
                  <span className="block text-xs text-muted-foreground">Updated {timeAgo(client.updatedAt)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------- Page */

function DashboardSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-6">
      <span className="sr-only">Loading dashboard…</span>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-40 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="h-80 animate-pulse rounded-xl bg-muted lg:col-span-2" />
        <div className="h-80 animate-pulse rounded-xl bg-muted" />
      </div>
    </div>
  );
}

function Overview() {
  const summary = useDashboardSummary();
  const canManageClients = usePermission('clients:manage');
  const canEditJobs = usePermission('jobs:edit');
  const canSeeUsage = usePermission('usage:read');

  if (summary.isPending) return <DashboardSkeleton />;
  if (summary.isError) {
    return (
      <ErrorState title="Could not load the dashboard" error={summary.error} onRetry={() => void summary.refetch()} isRetrying={summary.isFetching} />
    );
  }

  const data = summary.data;
  const enriched = data.trend.map((day) => day.productsEnriched);
  const exported = data.trend.map((day) => day.exports);
  const exports30 = exported.reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-col gap-6">
      <GettingStarted summary={data} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Products enriched"
          value={data.products.used}
          icon={Sparkles}
          accent="indigo"
          detail={data.products.limit === null ? 'This month · unlimited on your plan' : `This month · of ${data.products.limit.toLocaleString()} on your plan`}
          trend={weekOverWeek(enriched)}
          spark={enriched.slice(-14)}
          to={canSeeUsage ? '/usage' : undefined}
        />
        <StatCard
          label="Awaiting review"
          value={data.pendingSuggestions}
          icon={ClipboardCheck}
          accent="amber"
          detail={`${data.jobs.needsReview} job${data.jobs.needsReview === 1 ? '' : 's'} in review`}
          to="/jobs"
          cta={data.pendingSuggestions > 0 ? 'Review now' : 'View jobs'}
          delay={60}
        />
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
          cta="View jobs"
          delay={120}
        />
        <StatCard
          label="Exports"
          value={exports30}
          icon={FileDown}
          accent="emerald"
          detail="Last 30 days"
          trend={weekOverWeek(exported)}
          spark={exported.slice(-14)}
          delay={180}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <ActivityCard trend={data.trend} />
        <PlanCard summary={data} />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <RecentJobsCard jobs={data.recentJobs} canStart={canEditJobs} />
        <div className="flex min-w-0 flex-col gap-6">
          <PipelineCard jobsByStatus={data.jobsByStatus} />
          <ClientsCard clients={data.recentClients} canManage={canManageClients} />
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <RecentExportsCard exports={data.recentExports} />
        <div className="min-w-0">
          <SystemStatusCard />
        </div>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const session = useRequiredSession();
  const canEditJobs = usePermission('jobs:edit');
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4 animate-rise sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium text-muted-foreground">{today}</p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {greeting()}, {session.user.name.split(' ')[0]}
          </h1>
        </div>
        {canEditJobs ? (
          <Button asChild className="self-start shadow-sm sm:self-auto">
            <Link to="/clients">
              <Plus aria-hidden />
              New import
            </Link>
          </Button>
        ) : null}
      </div>
      <Overview />
    </div>
  );
}
