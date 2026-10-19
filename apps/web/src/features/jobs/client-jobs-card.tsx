import { FolderKanban, Loader2, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { EmptyState } from '@/components/empty-state';
import { ErrorState, errorMessage } from '@/components/page-states';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermission } from '@/features/auth/use-session';
import { timeAgo } from '@/features/dashboard/format';
import { JobStatusBadge } from './job-status';
import { useCreateJob, useJobList } from './use-jobs';

/** The jobs section of a client's page, with "New import". */
export function ClientJobsCard({ clientId }: { clientId: string }) {
  const canEdit = usePermission('jobs:edit');
  const jobs = useJobList({ page: 1, clientId, pageSize: 10 });
  const create = useCreateJob();
  const navigate = useNavigate();

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="flex flex-col gap-1.5">
          <CardTitle>Catalogue jobs</CardTitle>
          <CardDescription>Each import of a supplier file for this client.</CardDescription>
        </div>
        {canEdit ? (
          <Button
            size="sm"
            disabled={create.isPending}
            onClick={() => create.mutate({ clientId }, { onSuccess: (job) => void navigate(`/jobs/${job.id}`) })}
          >
            {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
            New import
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {create.isError ? <Alert variant="destructive">{errorMessage(create.error)}</Alert> : null}
        {jobs.isPending ? (
          <div role="status" className="flex flex-col gap-2">
            <span className="sr-only">Loading jobs…</span>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : jobs.isError ? (
          <ErrorState title="Could not load jobs" error={jobs.error} onRetry={() => void jobs.refetch()} isRetrying={jobs.isFetching} />
        ) : jobs.data.items.length === 0 ? (
          <EmptyState icon={FolderKanban} title="No imports yet">
            <p className="max-w-xs text-sm text-muted-foreground">
              Upload a supplier CSV or Excel file to start.{canEdit ? ' Start one with “New import”.' : ''}
            </p>
          </EmptyState>
        ) : (
          <ul className="-mx-2 flex flex-col">
            {jobs.data.items.map((job, index) => (
              <li
                key={job.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-sm transition-colors animate-rise hover:bg-muted/60"
                style={{ animationDelay: `${index * 40}ms` }}
              >
                <span className="min-w-0">
                  <Link to={`/jobs/${job.id}`} className="block truncate font-medium hover:text-primary hover:underline">
                    {job.name}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {job.counts.totalRows ? `${job.counts.totalRows.toLocaleString()} rows · ` : ''}
                    {timeAgo(job.updatedAt)}
                  </span>
                </span>
                <JobStatusBadge status={job.status} />
              </li>
            ))}
          </ul>
        )}
        {jobs.data && jobs.data.pagination.totalItems > jobs.data.items.length ? (
          <Link to="/jobs" className="text-sm text-primary hover:underline">
            View all {jobs.data.pagination.totalItems} jobs
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}
