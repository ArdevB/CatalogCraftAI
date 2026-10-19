import { fieldLabel, type AuditAction, type AuditEntry } from '@catalogcraft/shared';
import { ErrorState, LoadingState } from '@/components/page-states';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { usePermission } from '@/features/auth/use-session';
import { useJobActivity } from './use-jobs';

const VERB: Record<AuditAction, string> = {
  'suggestion.approved': 'approved',
  'suggestion.rejected': 'rejected',
  'suggestion.edited': 'edited',
  'suggestion.reset': 'undid the review of',
  'suggestions.bulk_approved': 'bulk-approved',
  'suggestions.bulk_rejected': 'bulk-rejected',
  'export.created': 'created an export of',
  'export.downloaded': 'downloaded an export',
};

function describe(entry: AuditEntry): string {
  const verb = VERB[entry.action];
  if (entry.action.startsWith('suggestions.')) return `${verb} ${entry.count ?? 0} suggestions`;
  if (entry.action === 'export.created') return `${verb} ${entry.count ?? 0} rows`;
  if (entry.action === 'export.downloaded') return verb;
  return `${verb} the ${entry.field ? fieldLabel(entry.field).toLowerCase() : 'suggestion'} on row ${entry.rowNumber ?? '?'}`;
}

/** Who reviewed and exported what (owners and admins). */
export function ActivityCard({ jobId }: { jobId: string }) {
  const canRead = usePermission('audit:read');
  const activity = useJobActivity(jobId, canRead);
  if (!canRead) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity</CardTitle>
        <CardDescription>Review decisions and exports on this job, newest first.</CardDescription>
      </CardHeader>
      <CardContent>
        {activity.isPending ? (
          <LoadingState label="Loading activity…" />
        ) : activity.isError ? (
          <ErrorState title="Could not load activity" error={activity.error} onRetry={() => void activity.refetch()} isRetrying={activity.isFetching} />
        ) : activity.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <ul className="divide-y text-sm">
            {activity.data.map((entry) => (
              <li key={entry.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{entry.actor.name}</span> {describe(entry)}
                </span>
                <time className="text-muted-foreground" dateTime={entry.createdAt}>
                  {new Date(entry.createdAt).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
