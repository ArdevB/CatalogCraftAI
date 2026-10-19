import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  memberSchema,
  organizationSchema,
  sessionInfoSchema,
  type DeleteAccountInput,
  type DeleteOrganizationInput,
  type SessionInfo,
  type UpdateOrganizationInput,
} from '@catalogcraft/shared';
import { sessionQueryKey } from '@/features/auth/use-session';
import { apiRequest } from '@/lib/api-client';

export const membersQueryKey = ['organization', 'members'] as const;

export function useMembers() {
  return useQuery({
    queryKey: membersQueryKey,
    queryFn: ({ signal }) => apiRequest('/organizations/current/members', z.array(memberSchema), { signal }),
  });
}

export function useUpdateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateOrganizationInput) =>
      apiRequest('/organizations/current', organizationSchema, { method: 'PATCH', body: input }),
    onSuccess: (organization) => {
      // The organization name is shown in the header, which reads the session.
      queryClient.setQueryData<SessionInfo | null>(sessionQueryKey, (session) =>
        session ? { ...session, organization } : session,
      );
    },
  });
}

/**
 * Permanently deletes the current organization. The API answers with the
 * session in another organization the user belongs to, or `null` when they
 * belonged nowhere else (signed out).
 */
export function useDeleteOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DeleteOrganizationInput) =>
      apiRequest('/organizations/current', sessionInfoSchema.nullable(), { method: 'DELETE', body: input }),
    onSuccess: async (session) => {
      queryClient.setQueryData(sessionQueryKey, session);
      // Nothing cached from the deleted organization may be shown again.
      await queryClient.resetQueries({ predicate: (query) => query.queryKey[0] !== sessionQueryKey[0] });
    },
  });
}

export function useDeleteAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DeleteAccountInput) => apiRequest('/me', z.null(), { method: 'DELETE', body: input }),
    onSuccess: () => {
      queryClient.removeQueries();
      queryClient.setQueryData(sessionQueryKey, null);
    },
  });
}
