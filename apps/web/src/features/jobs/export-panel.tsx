import { Download, FileDown, Loader2, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { columnMappingSchema, EXPORT_RETENTION_DAYS, STANDARD_FIELDS, type Job, type StandardField } from '@catalogcraft/shared';
import { ErrorState, errorMessage, LoadingState } from '@/components/page-states';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { usePermission } from '@/features/auth/use-session';
import { apiUrl } from '@/lib/api-client';
import { formatBytes } from './job-status';
import { useCreateExport, useJobExports } from './use-jobs';

/** Mapped fields, plus content fields that have AI suggestions (they can be added as new columns). */
function availableFields(job: Job): StandardField[] {
  const mapping = columnMappingSchema.parse(job.importConfig?.mapping ?? {});
  const enriched = new Set<string>(job.enrichment?.fields ?? []);
  return STANDARD_FIELDS.map((field) => field.key).filter((key) => mapping[key] !== undefined || enriched.has(key));
}

export function ExportPanel({ job }: { job: Job }) {
  const canExport = usePermission('exports:create');
  const exports = useJobExports(job.id);
  const create = useCreateExport(job.id);
  const fields = availableFields(job);
  const [chosen, setChosen] = useState<StandardField[]>(fields);
  const [includeUnmappedColumns, setIncludeUnmapped] = useState(true);
  const [includeErrorRows, setIncludeErrorRows] = useState(false);
  const pendingSuggestions = job.review?.pending ?? 0;

  const toggle = (field: StandardField) =>
    setChosen((current) => (current.includes(field) ? current.filter((f) => f !== field) : [...current, field]));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileDown className="size-4 text-primary" aria-hidden />
          Export CSV
        </CardTitle>
        <CardDescription className="flex items-start gap-1.5">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          Columns keep the supplier file’s order. Only approved or edited text replaces content; SKUs, prices, stock, barcodes
          and every other value are exported exactly as imported. Cells that could run as spreadsheet formulas are made safe.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {canExport ? (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Fields</legend>
              <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {fields.map((field) => (
                  <label key={field} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--primary)]"
                      checked={chosen.includes(field)}
                      onChange={() => toggle(field)}
                    />
                    {STANDARD_FIELDS.find((f) => f.key === field)?.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-col gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={includeUnmappedColumns} onChange={(e) => setIncludeUnmapped(e.target.checked)} />
                Also include the supplier’s other (unmapped) columns, unchanged
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={includeErrorRows} onChange={(e) => setIncludeErrorRows(e.target.checked)} />
                Include rows with validation errors ({job.counts.failedRows.toLocaleString()})
              </label>
            </div>
            {pendingSuggestions > 0 ? (
              <Alert>{pendingSuggestions} suggestion{pendingSuggestions === 1 ? ' is' : 's are'} still pending and won’t be included until approved.</Alert>
            ) : null}
            {create.isError ? <Alert variant="destructive">{errorMessage(create.error)}</Alert> : null}
            {create.isSuccess ? (
              <Alert variant="success">
                Export ready: {create.data.rowCount.toLocaleString()} rows, {create.data.changedCells.toLocaleString()} improved cells.{' '}
                <a className="font-medium text-primary hover:underline" href={apiUrl(`/exports/${create.data.id}/download`)}>
                  Download {create.data.filename}
                </a>
              </Alert>
            ) : null}
            <div>
              <Button
                disabled={create.isPending || chosen.length === 0}
                onClick={() => create.mutate({ fields: chosen, includeUnmappedColumns, includeErrorRows })}
              >
                {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <FileDown aria-hidden />}
                Create export
              </Button>
            </div>
          </>
        ) : null}

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Previous exports</h3>
          <p className="text-xs text-muted-foreground">
            Files are kept for {EXPORT_RETENTION_DAYS} days, then deleted. Your reviewed data stays, so you can export again at any time.
          </p>
          {exports.isPending ? (
            <LoadingState label="Loading exports…" />
          ) : exports.isError ? (
            <ErrorState title="Could not load exports" error={exports.error} onRetry={() => void exports.refetch()} isRetrying={exports.isFetching} />
          ) : exports.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">No exports yet.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {exports.data.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{item.filename}</span>
                    <span className="text-muted-foreground">
                      {item.rowCount.toLocaleString()} rows · {item.changedCells.toLocaleString()} improved cells · {formatBytes(item.sizeBytes)} ·{' '}
                      {item.createdBy.name}, {new Date(item.createdAt).toLocaleString()} · kept until{' '}
                      {new Date(item.expiresAt).toLocaleDateString()}
                    </span>
                  </span>
                  <Button asChild size="sm" variant="outline">
                    <a href={apiUrl(`/exports/${item.id}/download`)} aria-label={`Download ${item.filename}`}>
                      <Download aria-hidden />
                      Download
                    </a>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
