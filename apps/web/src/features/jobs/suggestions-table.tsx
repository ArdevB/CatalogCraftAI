import { AlertTriangle, Info } from 'lucide-react';
import { useState } from 'react';
import { fieldLabel, type CatalogRow, type Job, type RowEnrichment } from '@catalogcraft/shared';
import { ErrorState, LoadingState } from '@/components/page-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useJobRows } from './use-jobs';

const FILTERS: Array<{ value: RowEnrichment['status'] | undefined; label: string }> = [
  { value: 'done', label: 'With suggestions' },
  { value: 'failed', label: 'Failed' },
  { value: 'skipped', label: 'Skipped' },
];

function ProductSuggestions({ row }: { row: CatalogRow }) {
  return (
    <div className="flex flex-col gap-3 py-4">
      <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
        <span className="font-medium">{row.sourceIdentifier ?? '—'}</span>
        <span className="text-muted-foreground">Row {row.rowNumber}</span>
      </div>
      {row.enrichment?.status === 'failed' ? (
        <p className="flex items-start gap-1.5 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {row.enrichment.error ?? 'No suggestion could be generated.'}
        </p>
      ) : null}
      {row.suggestions.map((suggestion) => (
        <div key={suggestion.field} className="grid gap-2 rounded-md border p-3 text-sm md:grid-cols-[8rem_1fr_1fr]">
          <div className="flex items-start gap-2 font-medium">
            {fieldLabel(suggestion.field)}
            {suggestion.status === 'failed' ? <Badge variant="destructive">Blocked</Badge> : <Badge>{suggestion.status}</Badge>}
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Original</p>
            <p className="whitespace-pre-line">{row.original[suggestion.field] || <span className="text-muted-foreground">(empty)</span>}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Suggested</p>
            <p className={cn('whitespace-pre-line', suggestion.status === 'failed' && 'text-muted-foreground line-through')}>
              {suggestion.value}
            </p>
            {suggestion.warnings.length > 0 ? (
              <ul className="mt-1.5 flex flex-col gap-1">
                {suggestion.warnings.map((warning) => (
                  <li key={warning} className="flex items-start gap-1.5 text-warning">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    {warning}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
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

/** AI suggestions beside the original values. Read-only for now: approving and editing come with the review step. */
export function SuggestionsTable({ job }: { job: Job }) {
  const [filter, setFilter] = useState<RowEnrichment['status'] | undefined>('done');
  const [page, setPage] = useState(1);
  const rows = useJobRows(job.id, { page, enrichment: filter });
  const progress = job.enrichment;

  return (
    <Card>
      <CardHeader className="gap-3">
        <CardTitle>AI suggestions</CardTitle>
        <CardDescription>
          {progress
            ? `${progress.succeededRows.toLocaleString()} products have suggestions, ${progress.failedRows.toLocaleString()} failed (model ${progress.model}). `
            : ''}
          These are proposals only — the original values are unchanged. Approving, editing and rejecting suggestions comes in the
          next step.
        </CardDescription>
        <div role="group" aria-label="Filter suggestions" className="flex flex-wrap gap-1">
          {FILTERS.map((option) => (
            <Button
              key={option.label}
              size="sm"
              variant={filter === option.value ? 'secondary' : 'ghost'}
              aria-pressed={filter === option.value}
              onClick={() => {
                setFilter(option.value);
                setPage(1);
              }}
            >
              {option.label}
            </Button>
          ))}
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
                <ProductSuggestions key={row.id} row={row} />
              ))}
            </div>
            <nav aria-label="Suggestion pagination" className="mt-4 flex items-center justify-between text-sm">
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
