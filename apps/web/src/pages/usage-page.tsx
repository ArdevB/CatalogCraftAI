import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/page-states';
import { usePermission } from '@/features/auth/use-session';
import { useUsage } from '@/features/jobs/use-jobs';
import { PLAN_LABELS } from '@/lib/plans';
import type { PlanId } from '@catalogcraft/shared';

function Figure({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {detail ? <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

export function UsagePage() {
  const canSee = usePermission('usage:read');
  const usage = useUsage(canSee);

  if (!canSee) return <Alert>Only owners and admins can see usage and plan details.</Alert>;
  if (usage.isPending) return <LoadingState label="Loading usage…" />;
  if (usage.isError) return <ErrorState title="Could not load usage" error={usage.error} onRetry={() => void usage.refetch()} isRetrying={usage.isFetching} />;

  const data = usage.data;
  const { used, reserved, limit } = data.products;
  const percent = limit ? Math.min(100, Math.round(((used + reserved) / limit) * 100)) : 0;
  const month = new Date(data.period.start).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const planLabel = PLAN_LABELS[data.plan as PlanId] ?? data.plan;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Usage and plan</h1>
        <p className="text-sm text-muted-foreground">
          {planLabel} plan · {month} (resets on the 1st of each month, UTC)
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Products enriched this month</CardTitle>
          <CardDescription>A product counts once each time AI suggestions are generated for it successfully. Failed attempts are free.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-3xl font-semibold tabular-nums">
            {used.toLocaleString()}
            <span className="text-base font-normal text-muted-foreground"> / {limit === null ? 'unlimited' : limit.toLocaleString()}</span>
          </p>
          {limit !== null ? (
            <div role="progressbar" aria-label="Monthly allowance used" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used + reserved} className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className={percent >= 90 ? 'h-full bg-destructive' : 'h-full bg-primary'} style={{ width: `${percent}%` }} />
            </div>
          ) : null}
          {reserved > 0 ? <p className="text-sm text-muted-foreground">{reserved.toLocaleString()} more are reserved by jobs that are running.</p> : null}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure label="AI requests" value={data.aiRequests.toLocaleString()} />
        <Figure label="Failed requests" value={data.failedRequests.toLocaleString()} detail="Not counted against the plan" />
        <Figure label="Tokens" value={(data.inputTokens + data.outputTokens).toLocaleString()} detail={`${data.inputTokens.toLocaleString()} in · ${data.outputTokens.toLocaleString()} out`} />
        <Figure
          label="Estimated AI cost"
          value={data.estimatedCostUsd === null ? '—' : `$${data.estimatedCostUsd.toFixed(2)}`}
          detail={data.estimatedCostUsd === null ? 'Unknown model price' : 'From list prices; see your provider bill'}
        />
      </div>

      <Card>
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
                  <th scope="row" className="py-2.5 pr-4 text-left font-normal">{row.label}</th>
                  <td className={row.limit !== null && row.used >= row.limit ? 'py-2.5 pr-4 text-right font-medium text-destructive tabular-nums' : 'py-2.5 pr-4 text-right tabular-nums'}>
                    {row.used.toLocaleString()}
                  </td>
                  <td className="py-2.5 text-right tabular-nums">{row.limit === null ? 'Unlimited' : row.limit.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI service</CardTitle>
          <CardDescription>
            {data.ai.configured ? `Enabled — model ${data.ai.model}.` : 'Not configured. Add AI_API_KEY to the API’s .env file to enable AI suggestions.'}
          </CardDescription>
        </CardHeader>
      </Card>

      <p className="text-sm text-muted-foreground">
        Plans are changed manually during the pilot — contact CatalogCraft to upgrade. There is no online payment yet.
      </p>
    </div>
  );
}
