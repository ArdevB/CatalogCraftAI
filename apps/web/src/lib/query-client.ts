import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { sessionQueryKey } from '@/features/auth/use-session';
import { ApiError, isUnauthenticated } from './api-client';

/**
 * Retry only failures that might succeed on a second attempt (network
 * problems, 5xx). A 400/401/403/404 will fail the same way every time.
 */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (error instanceof ApiError && error.status !== null && error.status < 500) return false;
  return true;
}

export function createQueryClient(): QueryClient {
  // If any request reports that the session has expired, mark the user as
  // signed out; the route guard then sends them to the login page.
  const handleSessionExpiry = (error: unknown) => {
    if (isUnauthenticated(error)) queryClient.setQueryData(sessionQueryKey, null);
  };

  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: handleSessionExpiry }),
    // (A failed login also reports UNAUTHENTICATED; marking an already
    // signed-out user as signed out is harmless.)
    mutationCache: new MutationCache({ onError: handleSessionExpiry }),
    defaultOptions: {
      queries: { retry: shouldRetry, staleTime: 30_000, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  return queryClient;
}
