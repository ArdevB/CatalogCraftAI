import { useQuery } from '@tanstack/react-query';
import { healthSchema } from '@catalogcraft/shared';
import { apiRequest } from '@/lib/api-client';

export const healthQueryKey = ['system', 'health'] as const;

export function useHealth() {
  return useQuery({
    queryKey: healthQueryKey,
    queryFn: ({ signal }) => apiRequest('/health', healthSchema, { signal }),
    refetchInterval: 30_000,
    staleTime: 0,
  });
}
