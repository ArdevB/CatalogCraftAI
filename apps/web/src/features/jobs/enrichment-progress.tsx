import { Loader2 } from 'lucide-react';
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
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
          {job.status === 'queued' ? 'Waiting to start…' : cancelling ? 'Stopping after the current products…' : 'Generating suggestions…'}
        </CardTitle>
        <CardDescription>
          You can leave this page — the work continues in the background and is saved after every product.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div
          role="progressbar"
          aria-label="Enrichment progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
        </div>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {done.toLocaleString()} of {total.toLocaleString()} products ({percent}%) ·{' '}
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
