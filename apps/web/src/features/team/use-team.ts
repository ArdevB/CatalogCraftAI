import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  createdInvitationSchema,
  invitationPreviewSchema,
  invitationSchema,
  sessionInfoSchema,
  type AssignableRole,
  type CreateInvitationInput,
  type RegisterFromInvitationInput,
  type SessionInfo,
  type SignInFromInvitationInput,
} from '@catalogcraft/shared';
import { sessionQueryKey } from '@/features/auth/use-session';
import { membersQueryKey } from '@/features/organization/use-organization';
import { apiRequest } from '@/lib/api-client';

export const invitationsQueryKey = ['organization', 'invitations'] as const;

/**
 * After joining or switching organization, everything cached belongs to the
 * old one. Keep the new session and reset the rest, so no page can show the
 * previous agency's data even for a moment.
 */
async function enterOrganization(queryClient: QueryClient, session: SessionInfo) {
  queryClient.setQueryData(sessionQueryKey, session);
  await queryClient.resetQueries({ predicate: (query) => query.queryKey[0] !== sessionQueryKey[0] });
}

export function useInvitations(enabled: boolean) {
  return useQuery({
    queryKey: invitationsQueryKey,
    queryFn: ({ signal }) => apiRequest('/organizations/current/invitations', z.array(invitationSchema), { signal }),
    enabled,
  });
}

export function useCreateInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInvitationInput) =>
      apiRequest('/organizations/current/invitations', createdInvitationSchema, { method: 'POST', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: invitationsQueryKey });
      void queryClient.invalidateQueries({ queryKey: ['usage'] });
    },
  });
}

export function useRevokeInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest(`/organizations/current/invitations/${id}`, z.null(), { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: invitationsQueryKey });
      void queryClient.invalidateQueries({ queryKey: ['usage'] });
    },
  });
}

export function useChangeMemberRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ membershipId, role }: { membershipId: string; role: AssignableRole }) =>
      apiRequest(`/organizations/current/members/${membershipId}`, z.null(), { method: 'PATCH', body: { role } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: membersQueryKey }),
  });
}

/** Removes a member, or — for your own membership — leaves the organization. */
export function useRemoveMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ membershipId }: { membershipId: string; self: boolean }) =>
      apiRequest(`/organizations/current/members/${membershipId}`, z.null(), { method: 'DELETE' }),
    onSuccess: async (_data, { self }) => {
      if (self) {
        // The server moves the session to another organization (or ends it).
        await queryClient.resetQueries();
        return;
      }
      void queryClient.invalidateQueries({ queryKey: membersQueryKey });
      void queryClient.invalidateQueries({ queryKey: ['usage'] });
    },
  });
}

export function useSwitchOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (organizationId: string) =>
      apiRequest('/auth/switch-organization', sessionInfoSchema, { method: 'POST', body: { organizationId } }),
    onSuccess: (session) => enterOrganization(queryClient, session),
    // Most likely the membership was removed meanwhile: refresh the list of organizations.
    onError: () => queryClient.invalidateQueries({ queryKey: sessionQueryKey }),
  });
}

/* ------------------------------------------------- The public invite page */

export function useInvitationPreview(token: string) {
  return useQuery({
    queryKey: ['invitation', token],
    queryFn: ({ signal }) => apiRequest(`/invitations/${token}`, invitationPreviewSchema, { signal }),
    retry: false,
  });
}

export function useAcceptInvitation(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest(`/invitations/${token}/accept`, sessionInfoSchema, { method: 'POST' }),
    onSuccess: (session) => enterOrganization(queryClient, session),
  });
}

export function useRegisterFromInvitation(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterFromInvitationInput) =>
      apiRequest(`/invitations/${token}/register`, sessionInfoSchema, { method: 'POST', body: input }),
    onSuccess: (session) => enterOrganization(queryClient, session),
  });
}

export function useSignInFromInvitation(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SignInFromInvitationInput) =>
      apiRequest(`/invitations/${token}/sign-in`, sessionInfoSchema, { method: 'POST', body: input }),
    onSuccess: (session) => enterOrganization(queryClient, session),
  });
}
