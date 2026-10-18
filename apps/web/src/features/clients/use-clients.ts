import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  clientListSchema,
  clientSchema,
  dashboardSummarySchema,
  type CreateClientInput,
  type UpdateClientInput,
} from '@catalogcraft/shared';
import { apiRequest } from '@/lib/api-client';

export const clientKeys = {
  all: ['clients'] as const,
  list: (params: { page: number; search: string }) => ['clients', 'list', params] as const,
  detail: (id: string) => ['clients', 'detail', id] as const,
};
export const dashboardSummaryKey = ['dashboard', 'summary'] as const;

export function useClientList(params: { page: number; search: string }) {
  const query = new URLSearchParams({ page: String(params.page), pageSize: '20' });
  if (params.search) query.set('search', params.search);
  return useQuery({
    queryKey: clientKeys.list(params),
    queryFn: ({ signal }) => apiRequest(`/clients?${query.toString()}`, clientListSchema, { signal }),
    // Keep showing the current page while the next one loads (no flicker when paging).
    placeholderData: keepPreviousData,
  });
}

export function useClient(clientId: string) {
  return useQuery({
    queryKey: clientKeys.detail(clientId),
    queryFn: ({ signal }) => apiRequest(`/clients/${encodeURIComponent(clientId)}`, clientSchema, { signal }),
  });
}

export function useDashboardSummary() {
  return useQuery({
    queryKey: dashboardSummaryKey,
    queryFn: ({ signal }) => apiRequest('/dashboard/summary', dashboardSummarySchema, { signal }),
  });
}

/** After any change, refetch client lists and dashboard figures. */
function useInvalidateClients() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: clientKeys.all }),
      queryClient.invalidateQueries({ queryKey: dashboardSummaryKey }),
    ]);
}

export function useCreateClient() {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: (input: CreateClientInput) => apiRequest('/clients', clientSchema, { method: 'POST', body: input }),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateClient(clientId: string) {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: (input: UpdateClientInput) =>
      apiRequest(`/clients/${encodeURIComponent(clientId)}`, clientSchema, { method: 'PATCH', body: input }),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteClient(clientId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: () => apiRequest(`/clients/${encodeURIComponent(clientId)}`, z.null(), { method: 'DELETE' }),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: clientKeys.detail(clientId) });
      await invalidate();
    },
  });
}
