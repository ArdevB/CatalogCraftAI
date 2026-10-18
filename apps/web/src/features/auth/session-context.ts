import { createContext, useContext } from 'react';
import type { SessionInfo } from '@catalogcraft/shared';

/**
 * Provided by <RequireAuth> to the pages it guards. Reading the session from
 * here (instead of the query cache directly) means guarded pages never see a
 * "signed out" state: when the session ends, the guard swaps them for a
 * redirect before they could render without a user.
 */
export const SignedInSessionContext = createContext<SessionInfo | null>(null);

/** The signed-in session. Only for components rendered inside <RequireAuth>. */
export function useRequiredSession(): SessionInfo {
  const session = useContext(SignedInSessionContext);
  if (!session) throw new Error('useRequiredSession must be used inside <RequireAuth>.');
  return session;
}
