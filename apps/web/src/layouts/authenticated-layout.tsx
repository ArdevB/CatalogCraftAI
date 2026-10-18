import { LogOut, Loader2 } from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { useLogout, useRequiredSession } from '@/features/auth/use-session';
import { cn } from '@/lib/utils';
import { BrandMark } from './app-layout';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/clients', label: 'Clients' },
  { to: '/jobs', label: 'Jobs' },
  { to: '/settings/organization', label: 'Organization' },
];

/** Shell for signed-in pages: navigation, organization name, and sign-out. */
export function AuthenticatedLayout() {
  const session = useRequiredSession();
  const logout = useLogout();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>
      <header className="border-b bg-card">
        {/* On phones the navigation wraps onto its own row below the brand and sign-out. */}
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2 sm:h-14 sm:flex-nowrap sm:py-0 sm:px-6">
          <BrandMark to="/dashboard" />
          <nav aria-label="Main" className="order-last -mx-1 flex w-full items-center gap-1 overflow-x-auto sm:order-none sm:mx-0 sm:w-auto">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
                    isActive && 'bg-muted text-foreground',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right text-xs leading-tight sm:block">
              <p className="font-medium">{session.user.name}</p>
              <p className="text-muted-foreground">{session.organization.name}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={logout.isPending}
              onClick={() => logout.mutate(undefined, { onSuccess: () => void navigate('/login', { replace: true }) })}
            >
              {logout.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <LogOut aria-hidden />}
              Sign out
            </Button>
          </div>
        </div>
        {logout.isError ? (
          <p role="alert" className="mx-auto max-w-6xl px-4 pb-2 text-sm text-destructive sm:px-6">
            Could not sign out: {logout.error.message}
          </p>
        ) : null}
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
