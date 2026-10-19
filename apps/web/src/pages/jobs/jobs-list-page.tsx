import { FileSpreadsheet, Filter, FolderKanban } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { JOB_STATUSES, type JobStatus } from '@catalogcraft/shared';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/page-states';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { avatarFor, timeAgo } from '@/features/dashboard/format';
import { JOB_STATUS_LABELS, JobStatusBadge } from '@/features/jobs/job-status';
import { useJobList } from '@/features/jobs/use-jobs';
import { cn } from '@/lib/utils';

export function JobsListPage() {
  const [status, setStatus] = useState<JobStatus | ''>('');
  const [page, setPage] = useState(1);
  const jobs = useJobList({ page, status: status || undefined });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={FolderKanban}
        tint="sky"
        title="Catalogue jobs"
        description="Every import across your clients. Start a new import from a client’s page."
        actions={
          <div className="flex items-center gap-2 rounded-xl border bg-card px-3 py-1.5 shadow-xs">
            <Filter className="size-4 text-muted-foreground" aria-hidden />
            <Label htmlFor="status-filter" className="text-muted-foreground">
              Status
            </Label>
            <Select
              id="status-filter"
              className="h-8 w-44 border-none shadow-none"
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
        }
      />

      {jobs.isPending ? (
        <div role="status" className="flex flex-col gap-2">
          <span className="sr-only">Loading jobs…</span>
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : jobs.isError ? (
        <ErrorState title="Could not load jobs" error={jobs.error} onRetry={() => void jobs.refetch()} isRetrying={jobs.isFetching} />
      ) : jobs.data.items.length === 0 ? (
        <EmptyState icon={FileSpreadsheet} title={status ? 'No jobs with this status' : 'No catalogue jobs yet'}>
          {!status ? (
            <Button asChild size="sm" className="mt-1">
              <Link to="/clients">Choose a client to import for</Link>
            </Button>
          ) : null}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-3 animate-rise" style={{ animationDelay: '80ms' }}>
          <Table className={cn(jobs.isPlaceholderData && 'opacity-60')}>
            <TableHead>
              <tr>
                <TableHeader>Job</TableHeader>
                <TableHeader>Client</TableHeader>
                <TableHeader>Status</TableHeader>
                <TableHeader className="text-right">Rows</TableHeader>
                <TableHeader className="text-right">Errors</TableHeader>
                <TableHeader>Updated</TableHeader>
              </tr>
            </TableHead>
            <TableBody>
              {jobs.data.items.map((job, index) => {
                const { initials, tone } = avatarFor(job.client.name);
                return (
                  <TableRow key={job.id} index={index}>
                    <TableCell className="font-medium">
                      <Link to={`/jobs/${job.id}`} className="hover:text-primary hover:underline">
                        {job.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <span className={cn('grid size-6 shrink-0 place-items-center rounded-md text-[10px] font-semibold', tone)} aria-hidden>
                          {initials}
                        </span>
                        {job.client.name}
                      </span>
                    </TableCell>
                    <TableCell>
                      <JobStatusBadge status={job.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{job.counts.totalRows || '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {job.counts.totalRows ? (
                        <span className={cn(job.counts.failedRows > 0 && 'rounded-full px-2 py-0.5 font-medium tint-rose')}>{job.counts.failedRows}</span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{timeAgo(job.updatedAt)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {jobs.data.pagination.totalPages > 1 ? (
            <nav aria-label="Pagination" className="flex items-center justify-between rounded-xl border bg-card px-4 py-3 text-sm">
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
        </div>
      )}
    </div>
  );
}
