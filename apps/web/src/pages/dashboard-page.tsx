import { Building2 } from 'lucide-react';
import { Link } from 'react-router';
import { ErrorState, LoadingState } from '@/components/page-states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { usePermission, useRequiredSession } from '@/features/auth/use-session';
import { useDashboardSummary } from '@/features/clients/use-clients';
import { RoleBadge } from '@/features/organization/role-badge';
import { SystemStatusCard } from '@/features/system/system-status-card';
import { JobStatusBadge } from '@/features/jobs/job-status';
import { PLAN_LABELS } from '@/lib/plans';

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
        {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
      </CardContent>
    </Card>
  );
}

function Summary() {
  const summary = useDashboardSummary();
  const canManageClients = usePermission('clients:manage');

  if (summary.isPending) return <LoadingState label="Loading dashboard…" />;
  if (summary.isError) {
    return (
      <ErrorState
        title="Could not load the dashboard"
        error={summary.error}
        onRetry={() => void summary.refetch()}
        isRetrying={summary.isFetching}
      />
    );
  }

  const { clients, plan, recentClients, jobs, recentJobs, products } = summary.data;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Stat
          label="Client workspaces"
          value={String(clients.used)}
          detail={clients.limit === null ? 'Unlimited on your plan' : `of ${clients.limit} on your plan`}
        />
        <Stat
          label="Active jobs"
          value={String(jobs.active)}
          detail={jobs.activeLimit === null ? `${PLAN_LABELS[plan]} plan` : `of ${jobs.activeLimit} at a time · ${PLAN_LABELS[plan]} plan`}
        />
        <Stat
          label="Products enriched this month"
          value={products.used.toLocaleString()}
          detail={products.limit === null ? 'Unlimited on your plan' : `of ${products.limit.toLocaleString()} on your plan`}
        />
        <Stat label="Jobs needing review" value={String(jobs.needsReview)} />
        <Stat label="Failed jobs" value={String(jobs.failed)} detail={jobs.failed > 0 ? 'Open the job to see why' : undefined} />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
          <div className="flex flex-col gap-1.5">
            <CardTitle>Recent jobs</CardTitle>
            <CardDescription>Imports across all clients.</CardDescription>
          </div>
          {recentJobs.length > 0 ? (
            <Button asChild variant="outline" size="sm">
              <Link to="/jobs">View all</Link>
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {recentJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No imports yet. Open a client and choose “New import” to upload a supplier file.
            </p>
          ) : (
            <ul className="divide-y">
              {recentJobs.map((job) => (
                <li key={job.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0">
                    <Link to={`/jobs/${job.id}`} className="font-medium text-primary hover:underline">
                      {job.name}
                    </Link>
                    <span className="text-muted-foreground"> · {job.clientName}</span>
                  </span>
                  <JobStatusBadge status={job.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
          <div className="flex flex-col gap-1.5">
            <CardTitle>Recently updated clients</CardTitle>
            <CardDescription>Catalogue job statistics will appear here once imports are available.</CardDescription>
          </div>
          {recentClients.length > 0 ? (
            <Button asChild variant="outline" size="sm">
              <Link to="/clients">View all</Link>
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {recentClients.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <Building2 className="size-8 text-muted-foreground" aria-hidden />
              <p className="font-medium">No clients yet</p>
              {canManageClients ? (
                <Button asChild size="sm">
                  <Link to="/clients/new">Create your first client</Link>
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">An owner or admin can add client workspaces.</p>
              )}
            </div>
          ) : (
            <ul className="divide-y">
              {recentClients.map((client) => (
                <li key={client.id} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                  <Link to={`/clients/${client.id}`} className="font-medium text-primary hover:underline">
                    {client.name}
                  </Link>
                  <span className="text-muted-foreground">
                    Updated {new Date(client.updatedAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function DashboardPage() {
  const session = useRequiredSession();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome, {session.user.name}</h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {session.organization.name} <RoleBadge role={session.role} />
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Summary />
        <SystemStatusCard />
      </div>
    </div>
  );
}
