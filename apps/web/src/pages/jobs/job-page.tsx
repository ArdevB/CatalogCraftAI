import {
  Check,
  ClipboardCheck,
  Columns3,
  FileSpreadsheet,
  Loader2,
  SearchX,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { Job } from '@catalogcraft/shared';
import { BackLink } from '@/components/back-link';
import { ErrorState, errorMessage, LoadingState } from '@/components/page-states';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { usePermission } from '@/features/auth/use-session';
import { ActivityCard } from '@/features/jobs/activity-card';
import { EnrichmentPanel } from '@/features/jobs/enrichment-panel';
import { ExportPanel } from '@/features/jobs/export-panel';
import { EnrichmentProgress } from '@/features/jobs/enrichment-progress';
import { formatBytes, JobStatusBadge } from '@/features/jobs/job-status';
import { MappingStep } from '@/features/jobs/mapping-step';
import { UploadStep } from '@/features/jobs/upload-step';
import { ReviewTable } from '@/features/jobs/review-table';
import { useDeleteJob, useJob } from '@/features/jobs/use-jobs';
import { ValidationReport } from '@/features/jobs/validation-report';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';

const STEPS: Array<{ label: string; icon: LucideIcon }> = [
  { label: 'Upload file', icon: Upload },
  { label: 'Map columns', icon: Columns3 },
  { label: 'Validate', icon: ShieldCheck },
  { label: 'Enrich with AI', icon: Sparkles },
  { label: 'Review & export', icon: ClipboardCheck },
];

/** The step in progress, and how many steps are complete. */
function progress(job: Job): { current: number; completed: number } {
  switch (job.status) {
    case 'draft':
      return { current: 0, completed: 0 };
    case 'uploaded':
      return { current: 1, completed: 1 };
    case 'validating':
      return { current: 2, completed: 2 };
    case 'ready':
      return { current: 3, completed: 3 };
    case 'failed':
      return job.enrichment ? { current: 3, completed: 3 } : { current: 2, completed: 2 };
    case 'queued':
    case 'processing':
      return { current: 3, completed: 3 };
    case 'completed':
      return { current: 4, completed: 5 };
    default:
      return { current: 4, completed: 4 };
  }
}

/**
 * Progress indicator only — not navigation, so the steps are not links or
 * buttons. A gradient track fills up to the current step; the current step
 * pulses and finished steps pop in with a tick.
 */
function Stepper({ job }: { job: Job }) {
  const { current, completed } = progress(job);
  const filled = Math.min(completed, STEPS.length - 1) / (STEPS.length - 1);
  return (
    <div className="rounded-xl border bg-card px-4 py-5 shadow-xs animate-rise sm:px-8" style={{ animationDelay: '60ms' }}>
      <ol className="relative grid grid-cols-5" aria-label="Import progress">
        {/* The track runs between the first and last circle centres. */}
        <div aria-hidden className="absolute inset-x-[10%] top-[18px] h-1 rounded-full bg-muted">
          <div
            className="h-full origin-left rounded-full bg-gradient-to-r from-emerald-500 via-indigo-500 to-violet-500 transition-transform duration-1000 ease-[cubic-bezier(0.2,0.8,0.2,1)] animate-grow-x"
            style={{ transform: `scaleX(${filled})` }}
          />
        </div>
        {STEPS.map(({ label, icon: Icon }, index) => {
          const done = index < completed;
          const active = index === current && !done;
          return (
            <li key={label} className="relative flex flex-col items-center gap-2 text-center" aria-current={index === current ? 'step' : undefined}>
              <span
                className={cn(
                  'relative grid size-10 place-items-center rounded-full border-2 bg-card transition-all duration-500',
                  done && 'border-emerald-500 bg-emerald-500 text-white shadow-md shadow-emerald-500/30',
                  active && 'border-primary text-primary shadow-md shadow-primary/25',
                  !done && !active && 'border-border text-muted-foreground',
                )}
              >
                {active ? <span aria-hidden className="absolute inset-0 rounded-full text-primary animate-pulse-ring" /> : null}
                {done ? <Check className="size-5 animate-pop" aria-hidden /> : <Icon className="size-[18px]" aria-hidden />}
              </span>
              <span className={cn('text-xs font-medium sm:text-sm', index > current ? 'text-muted-foreground' : 'text-foreground')}>{label}</span>
            </li>
          );
        })}
      </ol>
    </div>
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

type View = 'auto' | 'replace-file' | 'edit-mapping' | 'enrich';

function JobBody({ job, view, setView }: { job: Job; view: View; setView: (view: View) => void }) {
  const canEdit = usePermission('jobs:edit');
  const back = () => setView('auto');

  if (!canEdit && (job.status === 'draft' || job.status === 'uploaded')) {
    return <Alert>This import hasn’t been validated yet. Owners, admins and editors can upload and map files.</Alert>;
  }
  if (view === 'replace-file') return <UploadStep jobId={job.id} replacing onCancel={back} />;
  if (view === 'edit-mapping') return <MappingStep job={job} onCancel={back} />;
  if (view === 'enrich') return <EnrichmentPanel job={job} onCancel={back} />;

  switch (job.status) {
    case 'draft':
      return <UploadStep jobId={job.id} />;
    case 'uploaded':
      return <MappingStep job={job} />;
    case 'validating':
      return <LoadingState label="Validating rows… this usually takes a few seconds." />;
    case 'queued':
    case 'processing':
      return <EnrichmentProgress job={job} />;
    case 'review':
    case 'completed':
    case 'exporting':
      return (
        <div className="flex flex-col gap-6">
          {job.lastError ? <Alert variant="destructive">{job.lastError}</Alert> : null}
          {canEdit ? (
            <div>
              <Button variant="outline" size="sm" onClick={() => setView('enrich')}>
                Generate more suggestions
              </Button>
            </div>
          ) : null}
          {job.review ? <ReviewTable job={job} /> : null}
          {job.status !== 'exporting' ? <ExportPanel job={job} /> : <LoadingState label="Creating the export…" />}
          <ActivityCard jobId={job.id} />
          <ValidationReport job={job} />
        </div>
      );
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
          {canEdit && job.counts.totalRows > 0 && (job.status === 'ready' || (job.status === 'failed' && job.enrichment)) ? (
            <EnrichmentPanel job={job} />
          ) : null}
          {job.status === 'ready' ? <ExportPanel job={job} /> : null}
          {job.counts.totalRows > 0 ? <ValidationReport job={job} /> : null}
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
        <section className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center animate-rise">
          <span className="grid size-14 place-items-center rounded-2xl tint-amber ring-1 ring-inset animate-float">
            <SearchX className="size-7" aria-hidden />
          </span>
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
      <PageHeader
        eyebrow={<BackLink to={`/clients/${data.client.id}`}>{data.client.name}</BackLink>}
        icon={FileSpreadsheet}
        tint="sky"
        title={data.name}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <JobStatusBadge status={data.status} />
            <span>
              {data.file ? `${data.file.filename} · ${formatBytes(data.file.sizeBytes)} · ` : ''}
              Created by {data.createdBy.name} on {new Date(data.createdAt).toLocaleDateString()}
            </span>
          </span>
        }
        actions={canEdit && !busy ? <DeleteJob job={data} /> : null}
      />
      <Stepper job={data} />
      <div className="animate-rise" style={{ animationDelay: '120ms' }}>
        <JobBody job={data} view={view} setView={setView} />
      </div>
    </div>
  );
}
