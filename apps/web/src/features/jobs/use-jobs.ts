import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  jobListSchema,
  jobSchema,
  previewSchema,
  rowListSchema,
  usageSummarySchema,
  type CreateJobInput,
  type Job,
  type JobStatus,
  type RowEnrichment,
  type RowStatus,
  type StartEnrichmentInput,
  type SaveMappingInput,
} from '@catalogcraft/shared';
import { dashboardSummaryKey } from '@/features/clients/use-clients';
import { apiRequest } from '@/lib/api-client';

export const jobKeys = {
  all: ['jobs'] as const,
  list: (params: object) => ['jobs', 'list', params] as const,
  detail: (id: string) => ['jobs', 'detail', id] as const,
  preview: (id: string, params: object) => ['jobs', 'preview', id, params] as const,
  rows: (id: string, params: object) => ['jobs', 'rows', id, params] as const,
};

const jobPath = (jobId: string) => `/jobs/${encodeURIComponent(jobId)}`;

export function useJobList(params: { page: number; clientId?: string; status?: JobStatus; pageSize?: number }) {
  const query = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize ?? 20) });
  if (params.clientId) query.set('clientId', params.clientId);
  if (params.status) query.set('status', params.status);
  return useQuery({
    queryKey: jobKeys.list(params),
    queryFn: ({ signal }) => apiRequest(`/jobs?${query.toString()}`, jobListSchema, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useJob(jobId: string) {
  return useQuery({
    queryKey: jobKeys.detail(jobId),
    queryFn: ({ signal }) => apiRequest(jobPath(jobId), jobSchema, { signal }),
    // While work runs in the background (validation, AI enrichment), keep checking.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'validating' || status === 'queued' || status === 'processing' ? 2_000 : false;
    },
  });
}

/** POST /preview reads the file; it changes nothing, so it is safe to treat as a query. */
export function usePreview(jobId: string, params: { sheetName?: string; headerRow: number }, enabled: boolean) {
  return useQuery({
    queryKey: jobKeys.preview(jobId, params),
    queryFn: ({ signal }) => apiRequest(`${jobPath(jobId)}/preview`, previewSchema, { method: 'POST', body: params, signal }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
}

export function useJobRows(
  jobId: string,
  params: { page: number; status?: RowStatus; field?: string; search?: string; enrichment?: RowEnrichment['status'] },
  enabled = true,
) {
  const query = new URLSearchParams({ page: String(params.page), pageSize: '25' });
  if (params.status) query.set('status', params.status);
  if (params.field) query.set('field', params.field);
  if (params.search) query.set('search', params.search);
  if (params.enrichment) query.set('enrichment', params.enrichment);
  return useQuery({
    queryKey: jobKeys.rows(jobId, params),
    queryFn: ({ signal }) => apiRequest(`${jobPath(jobId)}/rows?${query.toString()}`, rowListSchema, { signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** Stores the server's latest version of a job and refreshes anything derived from it. */
function useJobUpdated() {
  const queryClient = useQueryClient();
  return (job: Job) => {
    queryClient.setQueryData(jobKeys.detail(job.id), job);
    void queryClient.invalidateQueries({ queryKey: ['jobs', 'list'] });
    void queryClient.invalidateQueries({ queryKey: ['jobs', 'rows', job.id] });
    void queryClient.invalidateQueries({ queryKey: dashboardSummaryKey });
  };
}

export function useCreateJob() {
  const onUpdated = useJobUpdated();
  return useMutation({
    mutationFn: (input: CreateJobInput) => apiRequest('/jobs', jobSchema, { method: 'POST', body: input }),
    onSuccess: onUpdated,
  });
}

export function useUploadFile(jobId: string) {
  const queryClient = useQueryClient();
  const onUpdated = useJobUpdated();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return apiRequest(`${jobPath(jobId)}/upload`, jobSchema, { method: 'POST', body: form });
    },
    onSuccess: (job) => {
      // Previews of the old file are no longer valid.
      queryClient.removeQueries({ queryKey: ['jobs', 'preview', jobId] });
      onUpdated(job);
    },
  });
}

export function useSaveMapping(jobId: string) {
  const onUpdated = useJobUpdated();
  return useMutation({
    mutationFn: (input: SaveMappingInput) =>
      apiRequest(`${jobPath(jobId)}/mapping`, jobSchema, { method: 'PUT', body: input }),
    onSuccess: onUpdated,
  });
}

export function useValidateJob(jobId: string) {
  const onUpdated = useJobUpdated();
  return useMutation({
    mutationFn: () => apiRequest(`${jobPath(jobId)}/validate`, jobSchema, { method: 'POST' }),
    onSuccess: onUpdated,
  });
}

export function useDeleteJob(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest(jobPath(jobId), z.null(), { method: 'DELETE' }),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: jobKeys.detail(jobId) });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['jobs', 'list'] }),
        queryClient.invalidateQueries({ queryKey: dashboardSummaryKey }),
      ]);
    },
  });
}

export function useStartEnrichment(jobId: string) {
  const onUpdated = useJobUpdated();
  return useMutation({
    mutationFn: (input: StartEnrichmentInput) =>
      apiRequest(`${jobPath(jobId)}/enrich`, jobSchema, { method: 'POST', body: input }),
    onSuccess: onUpdated,
  });
}

export function useCancelEnrichment(jobId: string) {
  const onUpdated = useJobUpdated();
  return useMutation({
    mutationFn: () => apiRequest(`${jobPath(jobId)}/enrich/cancel`, jobSchema, { method: 'POST' }),
    onSuccess: onUpdated,
  });
}

const aiStatusSchema = z.object({ configured: z.boolean(), model: z.string().nullable() });

/** Whether the server has an AI provider configured (any signed-in role may ask). */
export function useAiStatus() {
  return useQuery({
    queryKey: ['ai', 'status'],
    queryFn: ({ signal }) => apiRequest('/ai/status', aiStatusSchema, { signal }),
    staleTime: 5 * 60_000,
  });
}

/** This month's usage. Owners and admins only — pass `enabled: false` for other roles. */
export function useUsage(enabled = true) {
  return useQuery({
    queryKey: ['usage'],
    queryFn: ({ signal }) => apiRequest('/usage', usageSummarySchema, { signal }),
    enabled,
  });
}
