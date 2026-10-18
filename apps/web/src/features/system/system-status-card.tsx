import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import type { DatabaseStatus } from '@catalogcraft/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api-client';
import { useHealth } from './use-health';

const DATABASE_LABEL: Record<DatabaseStatus, string> = {
  connected: 'Connected',
  connecting: 'Connecting…',
  disconnecting: 'Disconnecting…',
  disconnected: 'Disconnected',
};

function StatusRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

/** Live status of the API and its database, read from GET /api/v1/health. */
export function SystemStatusCard() {
  const { data, error, isPending, isError, isFetching, refetch, dataUpdatedAt } = useHealth();

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="flex flex-col gap-1.5">
          <CardTitle>System status</CardTitle>
          <CardDescription>Checks the API and database every 30 seconds.</CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refetch()}
          disabled={isFetching}
          aria-label="Check system status again"
        >
          <RefreshCw className={isFetching ? 'animate-spin' : undefined} aria-hidden />
          Refresh
        </Button>
      </CardHeader>

      <CardContent>
        {isPending ? (
          <p role="status" className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Checking system status…
          </p>
        ) : isError ? (
          <div role="alert" className="flex flex-col items-start gap-3 rounded-md border border-destructive/25 bg-destructive/5 p-4">
            <div className="flex items-start gap-2 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
              <div>
                <p className="font-medium text-destructive">API unavailable</p>
                <p className="text-muted-foreground">
                  {error instanceof ApiError ? error.message : 'An unexpected error occurred.'}
                </p>
                <p className="mt-1 text-muted-foreground">
                  Start it with <code className="rounded bg-muted px-1 py-0.5 text-xs">npm run dev</code> from the
                  repository root.
                </p>
              </div>
            </div>
            <Button size="sm" onClick={() => void refetch()} disabled={isFetching}>
              {isFetching ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Try again
            </Button>
          </div>
        ) : (
          <dl className="divide-y">
            <StatusRow label="API">
              <Badge variant="success">Online</Badge>
            </StatusRow>
            <StatusRow label="Database">
              <Badge variant={data.checks.database === 'connected' ? 'success' : 'warning'}>
                {DATABASE_LABEL[data.checks.database]}
              </Badge>
            </StatusRow>
            <StatusRow label="Environment">{data.environment}</StatusRow>
            <StatusRow label="Version">{data.version}</StatusRow>
            <StatusRow label="Last checked">
              <time dateTime={new Date(dataUpdatedAt).toISOString()}>
                {new Date(dataUpdatedAt).toLocaleTimeString()}
              </time>
            </StatusRow>
          </dl>
        )}

        {data && data.checks.database !== 'connected' ? (
          <p className="mt-3 text-sm text-muted-foreground">
            The API is running but cannot reach MongoDB. Check <code className="text-xs">MONGODB_URI</code> in{' '}
            <code className="text-xs">.env</code> and make sure the database is running. The API retries automatically.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
