import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';

export function LoadingState({ label = 'Loading…', fullPage = false }: { label?: string; fullPage?: boolean }) {
  return (
    <div
      role="status"
      className={
        fullPage
          ? 'flex min-h-svh items-center justify-center gap-2 text-sm text-muted-foreground'
          : 'flex items-center gap-2 py-8 text-sm text-muted-foreground'
      }
    >
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'An unexpected error occurred.';
}

export function ErrorState({
  title = 'Something went wrong',
  error,
  onRetry,
  isRetrying = false,
}: {
  title?: string;
  error: unknown;
  onRetry?: () => void;
  isRetrying?: boolean;
}) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-md border border-destructive/25 bg-destructive/5 p-4">
      <div className="flex items-start gap-2 text-sm">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        <div>
          <p className="font-medium text-destructive">{title}</p>
          <p className="text-muted-foreground">{errorMessage(error)}</p>
        </div>
      </div>
      {onRetry ? (
        <Button size="sm" onClick={onRetry} disabled={isRetrying}>
          {isRetrying ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Try again
        </Button>
      ) : null}
    </div>
  );
}
