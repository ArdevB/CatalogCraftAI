import { FileSpreadsheet } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { JOB_STATUSES, type JobStatus } from '@catalogcraft/shared';
import { ErrorState, LoadingState } from '@/components/page-states';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { JOB_STATUS_LABELS, JobStatusBadge } from '@/features/jobs/job-status';
import { useJobList } from '@/features/jobs/use-jobs';

export function JobsListPage() {
  const [status, setStatus] = useState<JobStatus | ''>('');
  const [page, setPage] = useState(1);
  const jobs = useJobList({ page, status: status || undefined });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Catalogue jobs</h1>
          <p className="text-sm text-muted-foreground">Every import across your clients. Start a new import from a client’s page.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="status-filter">Status</Label>
          <Select
            id="status-filter"
            className="w-48"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as JobStatus | '');
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {JOB_STATUSES.map((value) => (
              <option key={value} value={value}>
                {JOB_STATUS_LABELS[value]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {jobs.isPending ? (
        <LoadingState label="Loading jobs…" />
      ) : jobs.isError ? (
        <ErrorState title="Could not load jobs" error={jobs.error} onRetry={() => void jobs.refetch()} isRetrying={jobs.isFetching} />
      ) : jobs.data.items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <FileSpreadsheet className="size-8 text-muted-foreground" aria-hidden />
            <p className="font-medium">{status ? 'No jobs with this status' : 'No catalogue jobs yet'}</p>
            {!status ? (
              <Button asChild size="sm">
                <Link to="/clients">Choose a client to import for</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th scope="col" className="px-4 py-2.5 font-medium">Job</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Client</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Rows</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Errors</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className={jobs.isPlaceholderData ? 'divide-y opacity-60' : 'divide-y'}>
                {jobs.data.items.map((job) => (
                  <tr key={job.id} className="hover:bg-muted/50">
                    <td className="px-4 py-3 font-medium">
                      <Link to={`/jobs/${job.id}`} className="text-primary hover:underline">
                        {job.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{job.client.name}</td>
                    <td className="px-4 py-3">
                      <JobStatusBadge status={job.status} />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{job.counts.totalRows || '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{job.counts.totalRows ? job.counts.failedRows : '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{new Date(job.updatedAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {jobs.data.pagination.totalPages > 1 ? (
            <nav aria-label="Pagination" className="flex items-center justify-between border-t px-4 py-3 text-sm">
              <span className="text-muted-foreground">
                Page {jobs.data.pagination.page} of {jobs.data.pagination.totalPages}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={page >= jobs.data.pagination.totalPages} onClick={() => setPage(page + 1)}>
                  Next
                </Button>
              </div>
            </nav>
          ) : null}
        </Card>
      )}
    </div>
  );
}
