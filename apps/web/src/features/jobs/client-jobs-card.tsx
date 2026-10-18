import { Loader2, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { ErrorState, errorMessage, LoadingState } from '@/components/page-states';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { usePermission } from '@/features/auth/use-session';
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
          <LoadingState label="Loading jobs…" />
        ) : jobs.isError ? (
          <ErrorState title="Could not load jobs" error={jobs.error} onRetry={() => void jobs.refetch()} isRetrying={jobs.isFetching} />
        ) : jobs.data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No imports yet.{canEdit ? ' Start one with “New import”.' : ''}
          </p>
        ) : (
          <ul className="divide-y">
            {jobs.data.items.map((job) => (
              <li key={job.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                <Link to={`/jobs/${job.id}`} className="font-medium text-primary hover:underline">
                  {job.name}
                </Link>
                <span className="flex items-center gap-3 text-muted-foreground">
                  {job.counts.totalRows ? `${job.counts.totalRows.toLocaleString()} rows` : null}
                  <JobStatusBadge status={job.status} />
                </span>
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
