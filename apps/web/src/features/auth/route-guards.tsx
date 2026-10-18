import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router';
import { ErrorState, LoadingState } from '@/components/page-states';
import { SignedInSessionContext } from './session-context';
import { useSession } from './use-session';

/**
 * Only allows same-site paths as a post-login destination. Without this,
 * `/login?next=https://evil.example` would be an "open redirect" phishing aid.
 */
export function safeRedirectPath(next: string | null, fallback = '/dashboard'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next;
}

/** Renders child routes only for signed-in users; otherwise sends them to /login. */
export function RequireAuth() {
  const session = useSession();
  const location = useLocation();

  if (session.isPending) return <LoadingState label="Checking your session…" fullPage />;
  if (session.isError) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <ErrorState
          title="Could not check your session"
          error={session.error}
          onRetry={() => void session.refetch()}
          isRetrying={session.isFetching}
        />
      </div>
    );
  }
  if (!session.data) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return (
    <SignedInSessionContext.Provider value={session.data}>
      <Outlet />
    </SignedInSessionContext.Provider>
  );
}

/** Login/registration pages: signed-in users skip straight to where they were going. */
export function RedirectIfAuthenticated() {
  const session = useSession();
  const [searchParams] = useSearchParams();

  if (session.isPending) return <LoadingState label="Checking your session…" fullPage />;
  if (session.data) return <Navigate to={safeRedirectPath(searchParams.get('next'))} replace />;
  // On a network error, still show the form: submitting it will surface the error clearly.
  return <Outlet />;
}
