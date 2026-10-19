import { FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { useId, useRef, useState, type DragEvent } from 'react';
import { errorMessage } from '@/components/page-states';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatBytes } from './job-status';
import { useUploadFile } from './use-jobs';

/** The server enforces the real limit; this only avoids uploading obviously oversized files. */
const BROWSER_MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED = ['.csv', '.xlsx'];

function checkFile(file: File): string | null {
  const name = file.name.toLowerCase();
  if (!ACCEPTED.some((extension) => name.endsWith(extension))) return 'Choose a .csv or .xlsx file.';
  if (file.size > BROWSER_MAX_BYTES) return `This file is ${formatBytes(file.size)}; the limit is 10 MB.`;
  return null;
}

export function UploadStep({ jobId, replacing = false, onCancel }: { jobId: string; replacing?: boolean; onCancel?: () => void }) {
  const upload = useUploadFile(jobId);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const send = (file: File | undefined) => {
    if (!file) return;
    const problem = checkFile(file);
    setLocalError(problem);
    if (!problem) upload.mutate(file, { onSuccess: () => onCancel?.() });
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    send(event.dataTransfer.files[0]);
  };

  const error = localError ?? (upload.isError ? errorMessage(upload.error) : null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{replacing ? 'Replace the file' : 'Upload a catalogue file'}</CardTitle>
        <CardDescription>
          CSV or Excel (.xlsx), up to 10 MB and 2,000 products. Formulas and macros are never run.
          {replacing ? ' Replacing the file discards the current mapping and validation results.' : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-all duration-300',
            dragging ? 'scale-[1.01] border-primary bg-primary/5 shadow-lg shadow-primary/10' : 'border-border hover:border-primary/40 hover:bg-muted/40',
          )}
        >
          {upload.isPending ? (
            <>
              <Loader2 className="size-8 animate-spin text-primary" aria-hidden />
              <p className="text-sm" role="status">
                Uploading and checking the file…
              </p>
            </>
          ) : (
            <>
              <span className={cn('grid size-14 place-items-center rounded-2xl tint-indigo ring-1 ring-inset transition-transform duration-300', dragging ? '-translate-y-1 scale-110' : 'animate-float')}>
                <FileSpreadsheet className="size-7" aria-hidden />
              </span>
              <p className="text-sm">
                Drag a file here, or{' '}
                <label htmlFor={inputId} className="cursor-pointer font-medium text-primary hover:underline">
                  browse
                </label>
              </p>
              <input
                id={inputId}
                ref={inputRef}
                type="file"
                accept={ACCEPTED.join(',')}
                className="sr-only"
                aria-label="Catalogue file"
                onChange={(event) => {
                  send(event.target.files?.[0]);
                  event.target.value = ''; // allow choosing the same file again after an error
                }}
              />
              <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
                <Upload aria-hidden />
                Choose file
              </Button>
            </>
          )}
        </div>
        {onCancel ? (
          <div>
            <Button variant="ghost" size="sm" onClick={onCancel} disabled={upload.isPending}>
              Cancel
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
