import { AlertTriangle, Check, Info, Loader2, Pencil, RotateCcw, Search, X } from 'lucide-react';
import { useState } from 'react';
import {
  fieldLabel,
  REVIEW_TEXT_MAX,
  type CatalogRow,
  type Job,
  type Suggestion,
  type SuggestionStatus,
} from '@catalogcraft/shared';
import { ErrorState, errorMessage, LoadingState } from '@/components/page-states';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { usePermission } from '@/features/auth/use-session';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { cn } from '@/lib/utils';
import { useBulkReview, useJobRows, useReviewSuggestion } from './use-jobs';

const STATUS_LABEL: Record<SuggestionStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  edited: 'Edited',
  rejected: 'Rejected',
  failed: 'Blocked',
};
const STATUS_VARIANT: Record<SuggestionStatus, 'neutral' | 'success' | 'warning' | 'destructive'> = {
  pending: 'warning',
  approved: 'success',
  edited: 'success',
  rejected: 'neutral',
  failed: 'destructive',
};
const FILTERS: SuggestionStatus[] = ['pending', 'approved', 'edited', 'rejected', 'failed'];

/** One field's suggestion with its review controls. */
function SuggestionReview({ job, row, suggestion, canReview }: { job: Job; row: CatalogRow; suggestion: Suggestion; canReview: boolean }) {
  const review = useReviewSuggestion(job.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(suggestion.editedValue ?? suggestion.value);
  const blocked = suggestion.status === 'failed';
  const finalText = suggestion.status === 'edited' ? suggestion.editedValue : suggestion.value;
  const act = (action: 'approve' | 'reject' | 'reset' | 'edit', value?: string) =>
    review.mutate(
      { rowId: row.id, field: suggestion.field, action, ...(value === undefined ? {} : { value }) },
      { onSuccess: () => setEditing(false) },
    );

  return (
    <div className="grid gap-2 rounded-md border p-3 text-sm md:grid-cols-[8rem_1fr_1fr]">
      <div className="flex flex-wrap items-start gap-2 font-medium">
        {fieldLabel(suggestion.field)}
        <Badge variant={STATUS_VARIANT[suggestion.status]}>{STATUS_LABEL[suggestion.status]}</Badge>
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Original</p>
        <p className="whitespace-pre-line">{row.original[suggestion.field] || <span className="text-muted-foreground">(empty)</span>}</p>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {suggestion.status === 'edited' ? 'Your version' : 'Suggested'}
        </p>
        {editing ? (
          <div className="flex flex-col gap-2">
            <Textarea
              aria-label={`Edit ${fieldLabel(suggestion.field)}`}
              value={draft}
              maxLength={REVIEW_TEXT_MAX}
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className="flex gap-2">
              <Button size="sm" disabled={review.isPending || draft.trim() === ''} onClick={() => act('edit', draft)}>
                {review.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Save & use this
              </Button>
              <Button size="sm" variant="outline" disabled={review.isPending} onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p className={cn('whitespace-pre-line', (blocked || suggestion.status === 'rejected') && 'text-muted-foreground line-through')}>
            {finalText}
          </p>
        )}
        {suggestion.warnings.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {suggestion.warnings.map((warning) => (
              <li key={warning} className="flex items-start gap-1.5 text-warning">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {warning}
              </li>
            ))}
          </ul>
        ) : null}
        {review.isError ? <p className="text-destructive">{errorMessage(review.error)}</p> : null}
        {canReview && !editing ? (
          <div className="flex flex-wrap gap-1.5">
            {suggestion.status !== 'approved' && !blocked ? (
              <Button size="sm" variant="outline" disabled={review.isPending} onClick={() => act('approve')} aria-label={`Approve ${fieldLabel(suggestion.field)} for ${row.sourceIdentifier ?? `row ${row.rowNumber}`}`}>
                <Check aria-hidden />
                Approve
              </Button>
            ) : null}
            <Button size="sm" variant="outline" disabled={review.isPending} onClick={() => setEditing(true)} aria-label={`Edit ${fieldLabel(suggestion.field)} for ${row.sourceIdentifier ?? `row ${row.rowNumber}`}`}>
              <Pencil aria-hidden />
              Edit
            </Button>
            {suggestion.status !== 'rejected' ? (
              <Button size="sm" variant="ghost" disabled={review.isPending} onClick={() => act('reject')} aria-label={`Reject ${fieldLabel(suggestion.field)} for ${row.sourceIdentifier ?? `row ${row.rowNumber}`}`}>
                <X aria-hidden />
                Reject
              </Button>
            ) : null}
            {suggestion.status !== 'pending' && suggestion.status !== 'failed' ? (
              <Button size="sm" variant="ghost" disabled={review.isPending} onClick={() => act('reset')} aria-label={`Undo review of ${fieldLabel(suggestion.field)} for ${row.sourceIdentifier ?? `row ${row.rowNumber}`}`}>
                <RotateCcw aria-hidden />
                Undo
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ProductReview({
  job,
  row,
  canReview,
  selected,
  onToggle,
}: {
  job: Job;
  row: CatalogRow;
  canReview: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {canReview ? (
          <input
            type="checkbox"
            className="size-4 accent-[var(--primary)]"
            aria-label={`Select ${row.sourceIdentifier ?? `row ${row.rowNumber}`}`}
            checked={selected}
            onChange={onToggle}
          />
        ) : null}
        <span className="font-medium">{row.sourceIdentifier ?? '—'}</span>
        <span className="text-muted-foreground">Row {row.rowNumber}</span>
        {row.issues.some((issue) => issue.severity === 'warning') ? <Badge variant="warning">Validation warnings</Badge> : null}
      </div>
      {row.suggestions.map((suggestion) => (
        <SuggestionReview key={suggestion.field} job={job} row={row} suggestion={suggestion} canReview={canReview} />
      ))}
      {row.enrichment && (row.enrichment.missingFacts.length > 0 || row.enrichment.notes.length > 0) ? (
        <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {row.enrichment.missingFacts.length > 0 ? `Missing facts: ${row.enrichment.missingFacts.join(', ')}. ` : ''}
            {row.enrichment.notes.join(' ')}
          </span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Review AI suggestions: approve, edit, reject or undo each one, or approve in
 * bulk. Only approved and edited text is ever exported.
 */
export function ReviewTable({ job }: { job: Job }) {
  const canReview = usePermission('suggestions:review');
  const [filter, setFilter] = useState<SuggestionStatus | undefined>('pending');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim());
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const rows = useJobRows(job.id, { page, suggestion: filter ?? 'any', search: search || undefined });
  const bulk = useBulkReview(job.id);
  const summary = job.review;

  const toggle = (rowId: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  const runBulk = (action: 'approve' | 'reject', rowIds?: string[]) =>
    bulk.mutate({ action, ...(rowIds ? { rowIds } : {}) }, { onSuccess: () => setSelected(new Set()) });

  return (
    <Card>
      <CardHeader className="gap-3">
        <CardTitle>Review suggestions</CardTitle>
        <CardDescription>
          Only approved and edited text goes into the export — everything else keeps the original value.
          {summary
            ? ` ${summary.pending} pending · ${summary.approved + summary.edited} accepted · ${summary.rejected} rejected · ${summary.failed} blocked.`
            : ''}
        </CardDescription>
        {canReview && summary ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={bulk.isPending || summary.eligibleForBulkApproval === 0} onClick={() => runBulk('approve')}>
              {bulk.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
              Approve all without warnings ({summary.eligibleForBulkApproval})
            </Button>
            {selected.size > 0 ? (
              <>
                <Button size="sm" variant="outline" disabled={bulk.isPending} onClick={() => runBulk('approve', [...selected])}>
                  Approve selected ({selected.size})
                </Button>
                <Button size="sm" variant="outline" disabled={bulk.isPending} onClick={() => runBulk('reject', [...selected])}>
                  Reject selected ({selected.size})
                </Button>
              </>
            ) : null}
            {summary.pending > summary.eligibleForBulkApproval ? (
              <span className="text-xs text-muted-foreground">Suggestions with warnings must be approved one by one.</span>
            ) : null}
          </div>
        ) : null}
        {bulk.isError ? <Alert variant="destructive">{errorMessage(bulk.error)}</Alert> : null}
        {bulk.isSuccess ? (
          <Alert variant="success" role="status">
            {bulk.data.updated} suggestion{bulk.data.updated === 1 ? '' : 's'} updated.
          </Alert>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label="Filter by review status" className="flex flex-wrap gap-1">
            {[undefined, ...FILTERS].map((value) => (
              <Button
                key={value ?? 'all'}
                size="sm"
                variant={filter === value ? 'secondary' : 'ghost'}
                aria-pressed={filter === value}
                onClick={() => {
                  setFilter(value);
                  setPage(1);
                  setSelected(new Set());
                }}
              >
                {value ? STATUS_LABEL[value] : 'All'}
              </Button>
            ))}
          </div>
          <div className="relative ml-auto w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              aria-label="Search suggestions by SKU or title"
              placeholder="Search SKU or title"
              className="pl-9"
              value={searchInput}
              onChange={(event) => {
                setSearchInput(event.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {rows.isPending ? (
          <LoadingState label="Loading suggestions…" />
        ) : rows.isError ? (
          <ErrorState title="Could not load suggestions" error={rows.error} onRetry={() => void rows.refetch()} isRetrying={rows.isFetching} />
        ) : rows.data.items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No products in this group.</p>
        ) : (
          <>
            <div className={cn('divide-y', rows.isPlaceholderData && 'opacity-60')}>
              {rows.data.items.map((row) => (
                <ProductReview key={row.id} job={job} row={row} canReview={canReview} selected={selected.has(row.id)} onToggle={() => toggle(row.id)} />
              ))}
            </div>
            <nav aria-label="Review pagination" className="mt-4 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {rows.data.pagination.totalItems.toLocaleString()} products · page {rows.data.pagination.page} of{' '}
                {Math.max(1, rows.data.pagination.totalPages)}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={page >= rows.data.pagination.totalPages} onClick={() => setPage(page + 1)}>
                  Next
                </Button>
              </div>
            </nav>
          </>
        )}
      </CardContent>
    </Card>
  );
}
