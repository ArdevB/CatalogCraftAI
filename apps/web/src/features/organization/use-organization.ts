import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { memberSchema, organizationSchema, type SessionInfo, type UpdateOrganizationInput } from '@catalogcraft/shared';
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
