import type { JobStatus } from '@catalogcraft/shared';
import { Badge } from '@/components/ui/badge';

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  draft: 'Awaiting file',
  uploaded: 'Needs mapping',
  validating: 'Validating',
  ready: 'Validated',
  queued: 'Queued',
  processing: 'Enriching',
  review: 'In review',
  exporting: 'Exporting',
  completed: 'Completed',
  failed: 'Failed',
};

const VARIANT: Record<JobStatus, 'neutral' | 'success' | 'warning' | 'destructive'> = {
  draft: 'neutral',
  uploaded: 'warning',
  validating: 'neutral',
  ready: 'success',
  queued: 'neutral',
  processing: 'neutral',
  review: 'warning',
  exporting: 'neutral',
  completed: 'success',
  failed: 'destructive',
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  return <Badge variant={VARIANT[status]}>{JOB_STATUS_LABELS[status]}</Badge>;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
