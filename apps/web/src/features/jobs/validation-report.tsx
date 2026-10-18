import { AlertCircle, AlertTriangle, Info, Search, X } from 'lucide-react';
import { useState } from 'react';
import { fieldLabel, type IssueSeverity, type Job, type RowStatus } from '@catalogcraft/shared';
import { ErrorState, LoadingState } from '@/components/page-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { cn } from '@/lib/utils';
import { useJobRows } from './use-jobs';

const SEVERITY_ICON: Record<IssueSeverity, typeof AlertCircle> = { error: AlertCircle, warning: AlertTriangle, info: Info };
const SEVERITY_CLASS: Record<IssueSeverity, string> = {
  error: 'text-destructive',
  warning: 'text-warning',
  info: 'text-muted-foreground',
};

const issueFieldLabel = (field: string) => (field === 'row' ? 'Whole row' : fieldLabel(field));

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'success' | 'warning' | 'destructive' }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold tabular-nums',
          tone === 'success' && 'text-success',
          tone === 'warning' && value > 0 && 'text-warning',
          tone === 'destructive' && value > 0 && 'text-destructive',
        )}
      >
        {value.toLocaleString()}
      </p>
    </div>
  );
}

const STATUS_TABS: Array<{ value: RowStatus | undefined; label: string }> = [
  { value: undefined, label: 'All rows' },
  { value: 'error', label: 'Errors' },
  { value: 'warning', label: 'Warnings' },
  { value: 'valid', label: 'Valid' },
];

export function ValidationReport({ job }: { job: Job }) {
  const [status, setStatus] = useState<RowStatus | undefined>(undefined);
  const [field, setField] = useState<string | undefined>(undefined);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim());
  const [page, setPage] = useState(1);
  const rows = useJobRows(job.id, { page, status, field, search: search || undefined });
  const { counts } = job;

  const resetPage = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Product rows" value={counts.totalRows} />
        <Stat label="Valid" value={counts.validRows} tone="success" />
        <Stat label="With warnings" value={counts.warningRows} tone="warning" />
        <Stat label="With errors" value={counts.failedRows} tone="destructive" />
        <Stat label="Blank rows skipped" value={counts.skippedEmptyRows} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Issues found</CardTitle>
          <CardDescription>
            Errors mark rows that can’t be used safely (for example, no identifier or a duplicate SKU). Nothing in your file
            has been changed — fix the source file and upload it again, or continue with the valid rows in the next phase.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {job.issueSummary.length === 0 ? (
            <p className="text-sm text-success">No problems found — every row passed validation.</p>
          ) : (
            <ul className="divide-y">
              {job.issueSummary.map((issue) => {
                const Icon = SEVERITY_ICON[issue.severity];
                const active = field === issue.field;
                return (
                  <li key={`${issue.severity}-${issue.field}-${issue.type}`} className="flex items-start gap-3 py-2.5 text-sm">
                    <Icon className={cn('mt-0.5 size-4 shrink-0', SEVERITY_CLASS[issue.severity])} aria-label={issue.severity} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {issueFieldLabel(issue.field)} · {issue.type}{' '}
                        <span className="font-normal text-muted-foreground">
                          — {issue.count.toLocaleString()} row{issue.count === 1 ? '' : 's'}
                        </span>
                      </p>
                      <p className="text-muted-foreground">e.g. {issue.example}</p>
                    </div>
                    {issue.field !== 'row' ? (
                      <Button
                        variant={active ? 'secondary' : 'ghost'}
                        size="sm"
                        aria-pressed={active}
                        onClick={() => resetPage(setField)(active ? undefined : issue.field)}
                      >
                        {active ? 'Showing' : 'Show rows'}
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-4">
          <CardTitle>Rows</CardTitle>
          <div className="flex flex-wrap items-center gap-3">
            <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1">
              {STATUS_TABS.map((tab) => (
                <Button
                  key={tab.label}
                  size="sm"
                  variant={status === tab.value ? 'secondary' : 'ghost'}
                  aria-pressed={status === tab.value}
                  onClick={() => resetPage(setStatus)(tab.value)}
                >
                  {tab.label}
                </Button>
              ))}
            </div>
            {field ? (
              <Badge>
                Field: {issueFieldLabel(field)}
                <button type="button" aria-label="Clear field filter" onClick={() => resetPage(setField)(undefined)}>
                  <X className="size-3" aria-hidden />
                </button>
              </Badge>
            ) : null}
            <div className="relative ml-auto w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                type="search"
                aria-label="Search rows by SKU or title"
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
            <LoadingState label="Loading rows…" />
          ) : rows.isError ? (
            <ErrorState title="Could not load rows" error={rows.error} onRetry={() => void rows.refetch()} isRetrying={rows.isFetching} />
          ) : rows.data.items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No rows match these filters.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className={cn('w-full text-sm', rows.isPlaceholderData && 'opacity-60')}>
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th scope="col" className="py-2 pr-3 font-medium">Row</th>
                      <th scope="col" className="py-2 pr-3 font-medium">SKU / ID</th>
                      <th scope="col" className="py-2 pr-3 font-medium">Title</th>
                      <th scope="col" className="py-2 pr-3 font-medium">Price</th>
                      <th scope="col" className="py-2 font-medium">Issues</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.data.items.map((row) => (
                      <tr key={row.id} className="align-top">
                        <td className="py-2.5 pr-3 tabular-nums text-muted-foreground">{row.rowNumber}</td>
                        <td className="whitespace-nowrap py-2.5 pr-3 font-medium">{row.sourceIdentifier ?? <span className="text-destructive">—</span>}</td>
                        <td className="max-w-64 py-2.5 pr-3">
                          <span className="line-clamp-2">{row.original.title || <span className="text-muted-foreground">—</span>}</span>
                        </td>
                        <td className="py-2.5 pr-3 tabular-nums">{row.original.price ?? ''}</td>
                        <td className="py-2.5">
                          {row.issues.length === 0 ? (
                            <Badge variant="success">Valid</Badge>
                          ) : (
                            <ul className="flex flex-col gap-1">
                              {row.issues.map((issue, index) => {
                                const Icon = SEVERITY_ICON[issue.severity];
                                return (
                                  <li key={index} className="flex items-start gap-1.5">
                                    <Icon className={cn('mt-0.5 size-3.5 shrink-0', SEVERITY_CLASS[issue.severity])} aria-label={issue.severity} />
                                    <span>{issue.message}</span>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <nav aria-label="Row pagination" className="mt-4 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {rows.data.pagination.totalItems.toLocaleString()} rows · page {rows.data.pagination.page} of{' '}
                  {Math.max(1, rows.data.pagination.totalPages)}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= rows.data.pagination.totalPages}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </Button>
                </div>
              </nav>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
