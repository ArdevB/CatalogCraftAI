import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  featuresSchema,
  hasPermission,
  sessionInfoSchema,
  type ForgotPasswordInput,
  type ResetPasswordInput,
  type ChangePasswordInput,
  type LoginInput,
  type Permission,
  type RegisterInput,
  type SessionInfo,
} from '@catalogcraft/shared';
import { apiRequest, isUnauthenticated } from '@/lib/api-client';
import { useRequiredSession } from './session-context';

export const sessionQueryKey = ['auth', 'session'] as const;

/**
 * The signed-in user, or `null` when signed out.
 *
 * The browser cannot read the httpOnly session cookie, so asking the API
 * (`GET /me`) is the only way to know who is signed in. A 401 is a normal
 * answer here ("nobody"), not an error.
 */
export function useSession() {
  return useQuery({
    queryKey: sessionQueryKey,
    queryFn: async ({ signal }): Promise<SessionInfo | null> => {
      try {
        return await apiRequest('/me', sessionInfoSchema, { signal });
      } catch (error) {
        if (isUnauthenticated(error)) return null;
        throw error;
      }
    },
    staleTime: 5 * 60_000,
  });
}

export { useRequiredSession } from './session-context';

/** Whether the signed-in user's role grants `permission`. Only inside <RequireAuth>. */
export function usePermission(permission: Permission): boolean {
  return hasPermission(useRequiredSession().role, permission);
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => apiRequest('/auth/login', sessionInfoSchema, { method: 'POST', body: input }),
    onSuccess: (session) => queryClient.setQueryData(sessionQueryKey, session),
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterInput) =>
      apiRequest('/auth/register', sessionInfoSchema, { method: 'POST', body: input }),
    onSuccess: (session) => queryClient.setQueryData(sessionQueryKey, session),
  });
}

/** Changes the password; the API signs out every other device and keeps this session. */
export function useChangePassword() {
  return useMutation({
    mutationFn: (input: ChangePasswordInput) => apiRequest('/auth/change-password', z.null(), { method: 'POST', body: input }),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest('/auth/logout', z.null(), { method: 'POST' }),
    onSuccess: () => {
      // Drop every cached response from the previous user before showing anything else.
      queryClient.removeQueries();
      queryClient.setQueryData(sessionQueryKey, null);
    },
  });
}

/** What this server offers (e.g. whether it can send email). Public, cached for the visit. */
export function useFeatures() {
  return useQuery({
    queryKey: ['features'],
    queryFn: ({ signal }) => apiRequest('/features', featuresSchema, { signal }),
    staleTime: Infinity,
    retry: false,
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: (input: ForgotPasswordInput) => apiRequest('/auth/forgot-password', z.null(), { method: 'POST', body: input }),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (input: ResetPasswordInput) => apiRequest('/auth/reset-password', z.null(), { method: 'POST', body: input }),
  });
}

/** Confirms the address from an emailed link (runs once when the page opens). */
export function useVerifyEmail(token: string) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ['verify-email', token],
    queryFn: async () => {
      await apiRequest('/auth/verify-email', z.null(), { method: 'POST', body: { token } });
      // A signed-in session should stop showing the "please confirm" banner.
      await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
      return true;
    },
    retry: false,
    staleTime: Infinity,
  });
}

export function useResendVerification() {
  return useMutation({
    mutationFn: () => apiRequest('/auth/resend-verification', z.null(), { method: 'POST' }),
  });
}
