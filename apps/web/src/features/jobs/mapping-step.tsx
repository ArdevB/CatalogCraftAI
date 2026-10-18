import { AlertTriangle, Loader2, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { STANDARD_FIELDS, type ColumnMapping, type Job, type StandardField } from '@catalogcraft/shared';
import { ErrorState, errorMessage, LoadingState } from '@/components/page-states';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { usePreview, useSaveMapping, useValidateJob } from './use-jobs';

/** Problems the server would also reject, shown before submitting. */
function mappingProblems(mapping: ColumnMapping, headers: string[]): string[] {
  const problems: string[] = [];
  if (mapping.sku === undefined && mapping.productId === undefined) {
    problems.push('Map a SKU or Product ID column so every product can be identified.');
  }
  const byColumn = new Map<number, string[]>();
  for (const { key, label } of STANDARD_FIELDS) {
    const column = mapping[key];
    if (column !== undefined) byColumn.set(column, [...(byColumn.get(column) ?? []), label]);
  }
  for (const [column, labels] of byColumn) {
    if (labels.length > 1) problems.push(`Column “${headers[column]}” is mapped to ${labels.join(' and ')}.`);
  }
  return problems;
}

export function MappingStep({ job, onCancel }: { job: Job; onCancel?: () => void }) {
  const sheets = job.file?.sheets ?? [];
  const isWorkbook = job.file?.fileType === 'xlsx';
  const [sheetName, setSheetName] = useState<string | undefined>(job.importConfig?.sheetName ?? (isWorkbook ? sheets[0] : undefined));
  const [headerRowInput, setHeaderRowInput] = useState(String(job.importConfig?.headerRow ?? 1));
  const debouncedHeaderRow = useDebouncedValue(headerRowInput, 400);
  const headerRow = Number.parseInt(debouncedHeaderRow, 10);
  const headerRowValid = Number.isInteger(headerRow) && headerRow >= 1 && headerRow <= 50;

  const preview = usePreview(job.id, { sheetName, headerRow: headerRowValid ? headerRow : 1 }, headerRowValid);
  const save = useSaveMapping(job.id);
  const validate = useValidateJob(job.id);

  // The user's edits; until they change something we show the saved mapping
  // (if it was made for this sheet/header row) or the automatic suggestion.
  const [edited, setEdited] = useState<ColumnMapping | null>(null);
  const saved = job.importConfig;
  const savedMatches = saved && (saved.sheetName ?? undefined) === sheetName && saved.headerRow === headerRow;
  const mapping: ColumnMapping = edited ?? (savedMatches ? saved.mapping : (preview.data?.suggestedMapping ?? {}));

  const headers = preview.data?.headers ?? [];
  const problems = preview.data ? mappingProblems(mapping, headers) : [];
  const busy = save.isPending || validate.isPending;
  const failure = save.error ?? validate.error;

  const setField = (field: StandardField, value: string) => {
    const next = { ...mapping };
    if (value === '') delete next[field];
    else next[field] = Number(value);
    setEdited(next);
  };

  const submit = async () => {
    await save.mutateAsync({ sheetName: sheetName ?? null, headerRow, mapping });
    await validate.mutateAsync();
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Where are the products?</CardTitle>
          <CardDescription>Pick the worksheet and the row that holds the column names.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {isWorkbook ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sheet">Worksheet</Label>
              <Select
                id="sheet"
                value={sheetName}
                onChange={(event) => {
                  setSheetName(event.target.value);
                  setEdited(null);
                }}
              >
                {sheets.map((sheet) => (
                  <option key={sheet} value={sheet}>
                    {sheet}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="header-row">Header row</Label>
            <Input
              id="header-row"
              type="number"
              min={1}
              max={50}
              value={headerRowInput}
              aria-invalid={headerRowValid ? undefined : true}
              onChange={(event) => {
                setHeaderRowInput(event.target.value);
                setEdited(null);
              }}
            />
            {!headerRowValid ? <p className="text-sm text-destructive">Enter a row number from 1 to 50.</p> : null}
          </div>
        </CardContent>
      </Card>

      {preview.isPending ? (
        <LoadingState label="Reading the file…" />
      ) : preview.isError ? (
        <ErrorState title="Could not read this sheet" error={preview.error} onRetry={() => void preview.refetch()} isRetrying={preview.isFetching} />
      ) : (
        <>
          {preview.data.notices.map((notice) => (
            <Alert key={notice}>
              <AlertTriangle aria-hidden />
              {notice}
            </Alert>
          ))}
          {preview.data.exceedsRowLimit ? (
            <Alert variant="destructive">
              <AlertTriangle aria-hidden />
              This sheet has more than {preview.data.maxRows.toLocaleString()} product rows, the limit for one job. Split the file before validating.
            </Alert>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Map columns</CardTitle>
              <CardDescription>
                {preview.data.totalDataRows.toLocaleString()} product rows found
                {preview.data.skippedEmptyRows > 0 ? ` (${preview.data.skippedEmptyRows} blank rows will be skipped)` : ''}. We
                suggested matches from the column names — check them. Protected fields are never changed by AI.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              {STANDARD_FIELDS.map((field) => {
                const column = mapping[field.key];
                const sample = column !== undefined ? preview.data.sampleRows[0]?.values[column] : undefined;
                return (
                  <div key={field.key} className="flex flex-col gap-1.5">
                    <Label htmlFor={`map-${field.key}`} className="flex items-center gap-1.5">
                      {field.label}
                      {field.protected ? (
                        <ShieldCheck className="size-3.5 text-muted-foreground" aria-label="Protected field" />
                      ) : null}
                    </Label>
                    <Select id={`map-${field.key}`} value={column ?? ''} onChange={(event) => setField(field.key, event.target.value)}>
                      <option value="">— Not mapped —</option>
                      {headers.map((header, index) => (
                        <option key={`${index}-${header}`} value={index}>
                          {header}
                        </option>
                      ))}
                    </Select>
                    {sample ? <p className="truncate text-xs text-muted-foreground">e.g. {sample}</p> : null}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Preview</CardTitle>
              <CardDescription>The first {preview.data.sampleRows.length} rows, exactly as they appear in the file.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60">
                    <tr>
                      <th scope="col" className="px-2 py-1.5 text-left font-medium text-muted-foreground">
                        Row
                      </th>
                      {headers.map((header, index) => (
                        <th key={`${index}-${header}`} scope="col" className="whitespace-nowrap px-2 py-1.5 text-left font-medium">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {preview.data.sampleRows.map((row) => (
                      <tr key={row.rowNumber}>
                        <td className="px-2 py-1.5 text-muted-foreground tabular-nums">{row.rowNumber}</td>
                        {row.values.map((value, index) => (
                          <td key={index} className="max-w-56 truncate whitespace-nowrap px-2 py-1.5" title={value}>
                            {value}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-3">
            {problems.length > 0 ? (
              <Alert variant="destructive">
                <AlertTriangle aria-hidden />
                <ul className="list-disc pl-4">
                  {problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </Alert>
            ) : null}
            {failure ? <Alert variant="destructive">{errorMessage(failure)}</Alert> : null}
            <div className="flex flex-wrap gap-3">
              <Button
                disabled={busy || problems.length > 0 || preview.data.exceedsRowLimit || !headerRowValid}
                onClick={() => void submit().catch(() => undefined)}
              >
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {save.isPending ? 'Saving mapping…' : validate.isPending ? 'Validating rows…' : 'Save mapping and validate'}
              </Button>
              {onCancel ? (
                <Button variant="outline" onClick={onCancel} disabled={busy}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
