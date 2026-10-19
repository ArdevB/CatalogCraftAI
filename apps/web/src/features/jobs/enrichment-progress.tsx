import { Loader2, Sparkles } from 'lucide-react';
import type { Job } from '@catalogcraft/shared';
import { errorMessage } from '@/components/page-states';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { usePermission } from '@/features/auth/use-session';
import { useCancelEnrichment } from './use-jobs';

/** Live progress of a queued or running enrichment (the job page polls every 2 s). */
export function EnrichmentProgress({ job }: { job: Job }) {
  const canEdit = usePermission('jobs:edit');
  const cancel = useCancelEnrichment(job.id);
  const progress = job.enrichment;
  const total = progress?.totalRows ?? 0;
  const done = progress?.processedRows ?? 0;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const cancelling = progress?.cancelRequested ?? false;

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-5 space-y-0">
        {/* A spinning colour ring around the AI icon while it works. */}
        <span aria-hidden className="relative grid size-16 shrink-0 place-items-center">
          <span className="absolute inset-0 rounded-full bg-[conic-gradient(from_0deg,var(--color-indigo-500),var(--color-violet-500),var(--color-sky-400),var(--color-emerald-400),var(--color-indigo-500))] animate-spin [animation-duration:2.4s]" />
          <span className="absolute inset-[3px] rounded-full bg-card" />
          <Sparkles className="relative size-7 text-primary animate-float" />
        </span>
        <div className="flex flex-col gap-1.5">
          <CardTitle>
            {job.status === 'queued' ? 'Waiting to start…' : cancelling ? 'Stopping after the current products…' : 'Generating suggestions…'}
          </CardTitle>
          <CardDescription>
            You can leave this page — the work continues in the background and is saved after every product.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div
          role="progressbar"
          aria-label="Enrichment progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          className="h-3 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className="relative h-full overflow-hidden rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-sky-400 shimmer transition-[width] duration-700 ease-out"
            style={{ width: `${Math.max(percent, 2)}%` }}
          />
        </div>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          <span className="text-2xl font-semibold text-foreground tabular-nums">{percent}%</span>{' '}
          · {done.toLocaleString()} of {total.toLocaleString()} products ·{' '}
          {(progress?.succeededRows ?? 0).toLocaleString()} succeeded · {(progress?.failedRows ?? 0).toLocaleString()} failed
        </p>
        {cancel.isError ? <Alert variant="destructive">{errorMessage(cancel.error)}</Alert> : null}
        {canEdit && !cancelling ? (
          <div>
            <Button variant="outline" size="sm" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
              {cancel.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Stop enrichment
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
