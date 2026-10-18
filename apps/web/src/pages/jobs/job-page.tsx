import { Check, Loader2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { Job } from '@catalogcraft/shared';
import { ErrorState, errorMessage, LoadingState } from '@/components/page-states';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { usePermission } from '@/features/auth/use-session';
import { formatBytes, JobStatusBadge } from '@/features/jobs/job-status';
import { MappingStep } from '@/features/jobs/mapping-step';
import { UploadStep } from '@/features/jobs/upload-step';
import { useDeleteJob, useJob } from '@/features/jobs/use-jobs';
import { ValidationReport } from '@/features/jobs/validation-report';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';

const STEPS = ['Upload file', 'Map columns', 'Validate', 'Enrich with AI'] as const;

function currentStep(job: Job): number {
  if (job.status === 'draft') return 0;
  if (job.status === 'uploaded') return 1;
  if (job.status === 'validating' || job.status === 'failed' || job.status === 'ready') return 2;
  return 3;
}

/** Progress indicator only — not navigation, so the steps are not links or buttons. */
function Stepper({ job }: { job: Job }) {
  const current = currentStep(job);
  return (
    <ol className="flex flex-wrap gap-x-6 gap-y-2 text-sm" aria-label="Import progress">
      {STEPS.map((label, index) => {
        const done = index < current || (index === 2 && job.status === 'ready');
        return (
          <li key={label} className="flex items-center gap-2" aria-current={index === current ? 'step' : undefined}>
            <span
              className={cn(
                'flex size-6 items-center justify-center rounded-full border text-xs font-medium',
                done && 'border-success bg-success text-white',
                index === current && !done && 'border-primary text-primary',
                index > current && 'text-muted-foreground',
              )}
            >
              {done ? <Check className="size-3.5" aria-hidden /> : index + 1}
            </span>
            <span className={cn(index > current && 'text-muted-foreground')}>
              {label}
              {index === 3 ? <span className="text-muted-foreground"> (coming next)</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function DeleteJob({ job }: { job: Job }) {
  const [confirming, setConfirming] = useState(false);
  const remove = useDeleteJob(job.id);
  const navigate = useNavigate();

  if (!confirming) {
    return (
      <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
        <Trash2 aria-hidden />
        Delete job
      </Button>
    );
  }
  return (
    <div role="alertdialog" aria-labelledby="delete-job-title" className="flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4">
      <p id="delete-job-title" className="text-sm font-medium">
        Delete “{job.name}”? Its uploaded file and imported rows are permanently removed.
      </p>
      {remove.isError ? <Alert variant="destructive">{errorMessage(remove.error)}</Alert> : null}
      <div className="flex gap-2">
        <Button
          variant="destructive"
          size="sm"
          disabled={remove.isPending}
          onClick={() => remove.mutate(undefined, { onSuccess: () => void navigate(`/clients/${job.client.id}`, { replace: true }) })}
        >
          {remove.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Delete job
        </Button>
        <Button variant="outline" size="sm" disabled={remove.isPending} onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

type View = 'auto' | 'replace-file' | 'edit-mapping';

function JobBody({ job, view, setView }: { job: Job; view: View; setView: (view: View) => void }) {
  const canEdit = usePermission('jobs:edit');
  const back = () => setView('auto');

  if (!canEdit && (job.status === 'draft' || job.status === 'uploaded')) {
    return <Alert>This import hasn’t been validated yet. Owners, admins and editors can upload and map files.</Alert>;
  }
  if (view === 'replace-file') return <UploadStep jobId={job.id} replacing onCancel={back} />;
  if (view === 'edit-mapping') return <MappingStep job={job} onCancel={back} />;

  switch (job.status) {
    case 'draft':
      return <UploadStep jobId={job.id} />;
    case 'uploaded':
      return <MappingStep job={job} />;
    case 'validating':
      return <LoadingState label="Validating rows… this usually takes a few seconds." />;
    default:
      return (
        <div className="flex flex-col gap-6">
          {job.status === 'failed' && job.lastError ? <Alert variant="destructive">{job.lastError}</Alert> : null}
          {canEdit && (job.status === 'ready' || job.status === 'failed') ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setView('edit-mapping')}>
                Edit mapping
              </Button>
              <Button variant="outline" size="sm" onClick={() => setView('replace-file')}>
                Replace file
              </Button>
            </div>
          ) : null}
          {job.counts.totalRows > 0 ? <ValidationReport job={job} /> : null}
          {job.status === 'ready' ? (
            <Card>
              <CardHeader>
                <CardTitle>Next: AI enrichment</CardTitle>
                <CardDescription>
                  Generating title and description suggestions for these rows arrives in the next phase. Your imported data is
                  saved and won’t change.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : null}
        </div>
      );
  }
}

export function JobPage() {
  const { jobId = '' } = useParams();
  const job = useJob(jobId);
  const canEdit = usePermission('jobs:edit');
  // A chosen view (e.g. "edit mapping") applies to the job version it was opened
  // for; once the server returns an update (mapping saved, file replaced), the
  // page goes back to showing the job's current step.
  const [chosen, setChosen] = useState<{ view: View; forVersion: string }>({ view: 'auto', forVersion: '' });

  if (job.isPending) return <LoadingState label="Loading job…" />;
  if (job.isError) {
    const notFound = job.error instanceof ApiError && (job.error.code === 'NOT_FOUND' || job.error.code === 'VALIDATION_ERROR');
    if (notFound) {
      return (
        <section className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
          <h1 className="text-xl font-semibold">Job not found</h1>
          <p className="text-sm text-muted-foreground">It may have been deleted, or the link is wrong.</p>
          <Button asChild variant="outline">
            <Link to="/jobs">Back to jobs</Link>
          </Button>
        </section>
      );
    }
    return <ErrorState title="Could not load this job" error={job.error} onRetry={() => void job.refetch()} isRetrying={job.isFetching} />;
  }

  const data = job.data;
  const view: View = chosen.forVersion === data.updatedAt ? chosen.view : 'auto';
  const setView = (next: View) => setChosen({ view: next, forVersion: data.updatedAt });
  const busy = data.status === 'validating' || data.status === 'processing' || data.status === 'exporting';
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <Link to={`/clients/${data.client.id}`} className="text-sm text-muted-foreground hover:text-foreground">
            ← {data.client.name}
          </Link>
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">
            {data.name} <JobStatusBadge status={data.status} />
          </h1>
          <p className="text-sm text-muted-foreground">
            {data.file ? `${data.file.filename} · ${formatBytes(data.file.sizeBytes)} · ` : ''}
            Created by {data.createdBy.name} on {new Date(data.createdAt).toLocaleDateString()}
          </p>
        </div>
        {canEdit && !busy ? <DeleteJob job={data} /> : null}
      </div>
      <Stepper job={data} />
      <JobBody job={data} view={view} setView={setView} />
    </div>
  );
}
