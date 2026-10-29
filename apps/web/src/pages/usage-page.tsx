import { AlertTriangle, BarChart3, Bot, Coins, DollarSign, Gauge, type LucideIcon } from 'lucide-react';
import type { PlanId } from '@catalogcraft/shared';
import { ErrorState } from '@/components/page-states';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermission } from '@/features/auth/use-session';
import { ProgressRing } from '@/features/dashboard/charts';
import { CountUp } from '@/features/dashboard/stat-card';
import { useUsage } from '@/features/jobs/use-jobs';
import { PLAN_LABELS } from '@/lib/plans';
import { cn } from '@/lib/utils';

function Figure({ label, value, detail, icon: Icon, tint, delay }: { label: string; value: string; detail?: string; icon: LucideIcon; tint: string; delay: number }) {
  return (
    <Card className="flex flex-col gap-2 p-4 animate-rise" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        <span className={cn('grid size-8 place-items-center rounded-lg ring-1 ring-inset', tint)}>
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
    </Card>
  );
}

/** A usage bar that turns amber near the limit and red at it. */
function LimitBar({ used, limit }: { used: number; limit: number | null }) {
  if (limit === null) return <div aria-hidden className="mt-2 h-1.5 rounded-full bg-gradient-to-r from-emerald-400/60 to-emerald-400/0" />;
  const percent = Math.min(100, limit > 0 ? (used / limit) * 100 : 0);
  return (
    <div aria-hidden className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn('h-full rounded-full animate-grow-x', percent >= 100 ? 'bg-rose-500' : percent >= 80 ? 'bg-amber-500' : 'bg-indigo-500')}
        style={{ width: `${Math.max(percent, 2)}%` }}
      />
    </div>
  );
}

export function UsagePage() {
  const canSee = usePermission('usage:read');
  const usage = useUsage(canSee);

  if (!canSee) return <Alert>Only owners and admins can see usage and plan details.</Alert>;
  if (usage.isPending) {
    return (
      <div role="status" className="flex flex-col gap-6">
        <span className="sr-only">Loading usage…</span>
        <Skeleton className="h-16 w-72" />
        <Skeleton className="h-52 rounded-xl" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }
  if (usage.isError) return <ErrorState title="Could not load usage" error={usage.error} onRetry={() => void usage.refetch()} isRetrying={usage.isFetching} />;

  const data = usage.data;
  const { used, reserved, limit } = data.products;
  const percent = limit ? Math.min(100, Math.round(((used + reserved) / limit) * 100)) : 0;
  const month = new Date(data.period.start).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const planLabel = PLAN_LABELS[data.plan as PlanId] ?? data.plan;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={BarChart3}
        tint="violet"
        title="Usage and plan"
        description={`${planLabel} plan · ${month} (resets on the 1st of each month, UTC)`}
      />

      <Card className="animate-rise" style={{ animationDelay: '60ms' }}>
        <CardHeader>
          <CardTitle>Products enriched this month</CardTitle>
          <CardDescription>A product counts once each time AI suggestions are generated for it successfully. Failed attempts are free.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-6 sm:flex-row">
          <ProgressRing value={used + reserved} max={limit ?? Math.max(used, 1)} label="Monthly products used" className={percent >= 90 ? 'text-rose-500' : 'text-indigo-500'}>
            <div>
              <p className="text-2xl font-semibold text-foreground tabular-nums">{limit === null ? '∞' : `${percent}%`}</p>
              <p className="text-xs text-muted-foreground">used</p>
            </div>
          </ProgressRing>
          <div className="flex flex-1 flex-col gap-3 self-stretch sm:justify-center">
            <p className="text-4xl font-semibold tracking-tight tabular-nums" aria-label={used.toLocaleString()}>
              <CountUp value={used} />
              <span className="text-base font-normal text-muted-foreground"> / {limit === null ? 'unlimited' : limit.toLocaleString()}</span>
            </p>
            {limit !== null ? (
              <div role="progressbar" aria-label="Monthly allowance used" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used + reserved} className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn('relative h-full overflow-hidden rounded-full shimmer animate-grow-x', percent >= 90 ? 'bg-rose-500' : 'bg-gradient-to-r from-indigo-500 to-violet-500')}
                  style={{ width: `${percent}%` }}
                />
              </div>
            ) : null}
            {reserved > 0 ? <p className="text-sm text-muted-foreground">{reserved.toLocaleString()} more are reserved by jobs that are running.</p> : null}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure label="AI requests" value={data.aiRequests.toLocaleString()} icon={Bot} tint="tint-indigo" delay={120} />
        <Figure label="Failed requests" value={data.failedRequests.toLocaleString()} detail="Not counted against the plan" icon={AlertTriangle} tint="tint-amber" delay={170} />
        <Figure
          label="Tokens"
          value={(data.inputTokens + data.outputTokens).toLocaleString()}
          detail={`${data.inputTokens.toLocaleString()} in · ${data.outputTokens.toLocaleString()} out`}
          icon={Coins}
          tint="tint-sky"
          delay={220}
        />
        <Figure
          label="Estimated AI cost"
          value={data.estimatedCostUsd === null ? '—' : `$${data.estimatedCostUsd.toFixed(2)}`}
          detail={data.estimatedCostUsd === null ? 'Unknown model price' : 'From list prices; see your provider bill'}
          icon={DollarSign}
          tint="tint-emerald"
          delay={270}
        />
      </div>

      <Card className="animate-rise" style={{ animationDelay: '320ms' }}>
        <CardHeader>
          <CardTitle>Plan limits</CardTitle>
          <CardDescription>What your {planLabel} plan includes, and how much of it is in use right now.</CardDescription>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th scope="col" className="py-2 pr-4 font-medium">Limit</th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">In use</th>
                <th scope="col" className="py-2 text-right font-medium">Included</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {[
                { label: 'Products enriched this month', used: used + reserved, limit },
                { label: 'Client workspaces', ...data.limits.clientWorkspaces },
                { label: 'Team members (incl. pending invitations)', ...data.limits.members },
                { label: 'Jobs in progress at once', ...data.limits.activeJobs },
              ].map((row) => (
                <tr key={row.label}>
                  <th scope="row" className="py-3 pr-4 text-left font-normal">
                    {row.label}
                    <LimitBar used={row.used} limit={row.limit} />
                  </th>
                  <td className={cn('py-3 pr-4 text-right align-top tabular-nums', row.limit !== null && row.used >= row.limit && 'font-medium text-destructive')}>
                    {row.used.toLocaleString()}
                  </td>
                  <td className="py-3 text-right align-top tabular-nums">{row.limit === null ? 'Unlimited' : row.limit.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card className="animate-rise" style={{ animationDelay: '380ms' }}>
        <CardHeader className="flex-row items-center gap-4 space-y-0">
          <span className={cn('relative grid size-10 shrink-0 place-items-center rounded-xl ring-1 ring-inset', data.ai.configured ? 'tint-emerald' : 'tint-amber')}>
            <Gauge className="size-5" aria-hidden />
            {data.ai.configured ? <span aria-hidden className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-emerald-500 text-emerald-500 animate-pulse-ring" /> : null}
          </span>
          <div className="flex flex-col gap-1">
            <CardTitle>AI service</CardTitle>
            <CardDescription>
              {data.ai.configured ? `Enabled — model ${data.ai.model}.` : 'Not configured. Add AI_API_KEY to the API’s .env file to enable AI suggestions.'}
            </CardDescription>
          </div>
        </CardHeader>
      </Card>

      <p className="text-sm text-muted-foreground">
        Plans are changed manually during the pilot — contact CatalogCraft to upgrade. There is no online payment yet.
      </p>
    </div>
  );
}
