import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api-client';

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
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry, staleTime: 30_000, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}
