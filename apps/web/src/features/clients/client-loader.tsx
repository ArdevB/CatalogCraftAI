import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import type { Client } from '@catalogcraft/shared';
import { ErrorState, LoadingState } from '@/components/page-states';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';
import { useClient } from './use-clients';

/**
 * Loads the client named in the URL and renders `children` with it, handling
 * loading, not-found (including other agencies' ids) and error states.
 */
export function WithClient({ children }: { children: (client: Client) => ReactNode }) {
  const { clientId = '' } = useParams();
  const client = useClient(clientId);

  if (client.isPending) return <LoadingState label="Loading client…" />;
  if (client.isError) {
    const notFound =
      client.error instanceof ApiError && (client.error.code === 'NOT_FOUND' || client.error.code === 'VALIDATION_ERROR');
    if (notFound) {
      return (
        <section className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
          <h1 className="text-xl font-semibold">Client not found</h1>
          <p className="text-sm text-muted-foreground">It may have been deleted, or the link is wrong.</p>
          <Button asChild variant="outline">
            <Link to="/clients">Back to clients</Link>
          </Button>
        </section>
      );
    }
    return (
      <ErrorState
        title="Could not load this client"
        error={client.error}
        onRetry={() => void client.refetch()}
        isRetrying={client.isFetching}
      />
    );
  }
  return <>{children(client.data)}</>;
}
