import {
  BarChart3,
  Building2,
  ChevronsLeft,
  FolderKanban,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  Settings2,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { hasPermission, type Permission } from '@catalogcraft/shared';
import { BackgroundGlow } from '@/components/background-glow';
import { ThemeSwitchButton, ThemeToggle } from '@/components/theme-toggle';
import { Select } from '@/components/ui/select';
import { useLogout, useRequiredSession } from '@/features/auth/use-session';
import { VerifyEmailBanner } from '@/features/auth/verify-email-banner';
import { avatarFor } from '@/features/dashboard/format';
import { ROLE_LABELS } from '@/features/organization/role-badge';
import { useSwitchOrganization } from '@/features/team/use-team';
import { cn } from '@/lib/utils';

type NavItem = { to: string; label: string; icon: LucideIcon; permission?: Permission };

const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'Workspace',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/clients', label: 'Clients', icon: Building2 },
      { to: '/jobs', label: 'Jobs', icon: FolderKanban },
    ],
  },
  {
    label: 'Settings',
    items: [
      { to: '/usage', label: 'Usage', icon: BarChart3, permission: 'usage:read' },
      { to: '/settings/organization', label: 'Organization', icon: Settings2 },
      { to: '/settings/account', label: 'Account', icon: UserRound },
    ],
  },
];

const COLLAPSED_KEY = 'catalogcraft:sidebar-collapsed';
const WIDE = 264;
const RAIL = 76;
const EASE = 'ease-[cubic-bezier(0.2,0.8,0.2,1)]';

/** Whether a media query matches; `fallback` where the browser can't tell (e.g. tests). */
function useMediaQuery(query: string, fallback: boolean): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== 'function') return () => {};
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : fallback),
    () => fallback,
  );
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function Avatar({ name, className }: { name: string; className?: string }) {
  const { initials, tone } = avatarFor(name);
  return (
    <span className={cn('grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold', tone, className)} aria-hidden>
      {initials}
    </span>
  );
}

function BrandLink({ rail }: { rail: boolean }) {
  return (
    <Link
      to="/dashboard"
      className="group/brand flex min-w-0 items-center gap-2.5 rounded-lg font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 shadow-md shadow-indigo-500/25 transition-transform duration-500 group-hover/brand:rotate-[8deg] group-hover/brand:scale-105">
        {/* The favicon's three lines, drawn in on load. */}
        <svg viewBox="0 0 32 32" className="size-6" aria-hidden>
          {['M9 10h14', 'M9 16h14', 'M9 22h8'].map((d, i) => (
            <path key={d} d={d} stroke="white" strokeWidth={2.6} strokeLinecap="round" pathLength={1} className="animate-draw" style={{ animationDelay: `${150 + i * 120}ms` }} />
          ))}
        </svg>
      </span>
      <span className={cn('truncate transition-all duration-300', EASE, rail ? 'pointer-events-none w-0 opacity-0' : 'opacity-100')}>CatalogCraft AI</span>
    </Link>
  );
}

/** For people in more than one agency: switches the whole app to another organization. */
function OrganizationBlock({ rail }: { rail: boolean }) {
  const session = useRequiredSession();
  const switchTo = useSwitchOrganization();
  const navigate = useNavigate();
  const several = session.organizations.length > 1;

  return (
    <div className={cn('flex items-center gap-3 rounded-xl border bg-background/60 p-2.5 transition-all duration-300', EASE, rail && 'justify-center border-transparent bg-transparent p-0')}>
      <Avatar name={session.organization.name} className="rounded-lg" />
      <div className={cn('min-w-0 flex-1 transition-opacity duration-200', rail ? 'hidden' : 'opacity-100')}>
        {several ? (
          <Select
            aria-label="Organization"
            className="h-7 border-none bg-transparent px-0 py-0 text-sm font-medium shadow-none focus-visible:ring-0"
            value={session.organization.id}
            disabled={switchTo.isPending}
            onChange={(event) => switchTo.mutate(event.target.value, { onSuccess: () => void navigate('/dashboard') })}
          >
            {session.organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </Select>
        ) : (
          <p className="truncate text-sm font-medium">{session.organization.name}</p>
        )}
        <p className="text-xs text-muted-foreground">{ROLE_LABELS[session.role]}</p>
      </div>
    </div>
  );
}

/**
 * The nav list. A single highlight glides to whichever item is active, instead
 * of each item switching its own background on and off.
 */
function Navigation({ rail, onNavigate }: { rail: boolean; onNavigate: () => void }) {
  const session = useRequiredSession();
  const { pathname } = useLocation();
  const listRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  const placeHighlight = useCallback(() => {
    const list = listRef.current;
    const highlight = highlightRef.current;
    if (!list || !highlight) return;
    const active = list.querySelector<HTMLElement>('a[aria-current="page"]');
    if (!active) {
      highlight.style.opacity = '0';
      return;
    }
    highlight.style.opacity = '1';
    highlight.style.height = `${active.offsetHeight}px`;
    highlight.style.transform = `translateY(${active.offsetTop}px)`;
  }, []);

  useLayoutEffect(placeHighlight, [pathname, rail, placeHighlight]);
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(placeHighlight);
    observer.observe(list);
    return () => observer.disconnect();
  }, [placeHighlight]);

  let index = 0;
  return (
    // The rail lets tooltips stick out to the right; the wide sidebar scrolls if it must.
    <nav aria-label="Main" className={cn('flex-1 px-3 py-2', rail ? 'overflow-visible' : 'overflow-y-auto overflow-x-hidden')}>
      <div ref={listRef} className="relative flex flex-col gap-1">
        <div
          ref={highlightRef}
          aria-hidden
          className={cn('pointer-events-none absolute inset-x-0 top-0 rounded-lg tint-indigo opacity-0 ring-1 ring-inset transition-[transform,height,opacity] duration-500', EASE)}
        >
          <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-indigo-500" />
        </div>
        {NAV_GROUPS.map((group, groupIndex) => {
          const items = group.items.filter((item) => !item.permission || hasPermission(session.role, item.permission));
          return (
            <div key={group.label} className="flex flex-col gap-1">
              <p
                className={cn(
                  'px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80 transition-all duration-300',
                  groupIndex === 0 ? 'pt-1' : 'pt-4',
                  rail && 'h-0 overflow-hidden p-0 opacity-0',
                )}
              >
                {group.label}
              </p>
              {items.map((item) => {
                const delay = 60 + index++ * 45;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'group relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium outline-none transition-colors duration-200 animate-slide-in-left focus-visible:ring-2 focus-visible:ring-ring',
                        isActive ? 'text-indigo-700 dark:text-indigo-200' : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                        rail && 'justify-center px-0',
                      )
                    }
                    style={{ animationDelay: `${delay}ms` }}
                  >
                    <item.icon
                      className="relative size-[18px] shrink-0 transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:scale-110 group-hover:-rotate-3"
                      aria-hidden
                    />
                    {/* In the rail the label becomes a tooltip that slides out on hover or focus. */}
                    <span
                      className={cn(
                        'relative whitespace-nowrap transition-all duration-300',
                        EASE,
                        rail &&
                          'pointer-events-none absolute left-full z-50 ml-4 -translate-x-2 rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background opacity-0 shadow-lg group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100',
                      )}
                    >
                      {item.label}
                    </span>
                  </NavLink>
                );
              })}
            </div>
          );
        })}
      </div>
    </nav>
  );
}

function UserBlock({ rail }: { rail: boolean }) {
  const session = useRequiredSession();
  const logout = useLogout();
  const navigate = useNavigate();
  return (
    <div className="border-t p-3">
      <div className={cn('flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-muted/60', rail && 'flex-col gap-2 p-1')}>
        <Avatar name={session.user.name} />
        <div className={cn('min-w-0 flex-1', rail && 'hidden')}>
          <p className="truncate text-sm font-medium">{session.user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{session.user.email}</p>
        </div>
        <button
          type="button"
          aria-label="Sign out"
          title="Sign out"
          disabled={logout.isPending}
          onClick={() => logout.mutate(undefined, { onSuccess: () => void navigate('/login', { replace: true }) })}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-all duration-200 hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-300 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
        >
          {logout.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <LogOut className="size-4" aria-hidden />}
        </button>
      </div>
      {logout.isError ? (
        <p role="alert" className="mt-2 px-2 text-xs text-destructive">
          Could not sign out: {logout.error.message}
        </p>
      ) : null}
    </div>
  );
}

/** Shell for signed-in pages: a left sidebar (a slide-in drawer on small screens) and the page. */
export function AuthenticatedLayout() {
  const session = useRequiredSession();
  const location = useLocation();
  const isDesktop = useMediaQuery('(min-width: 1024px)', true);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const rail = isDesktop && collapsed;
  const hidden = !isDesktop && !drawerOpen;
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, value ? '0' : '1');
      } catch {
        // Not remembered next time — harmless.
      }
      return !value;
    });
  };

  // The drawer closes with Escape and stops the page behind it from scrolling.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [drawerOpen]);

  return (
    <div className="min-h-svh">
      <BackgroundGlow />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>

      {/* Small screens: a top bar with a menu button. */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-card/80 px-4 backdrop-blur-md lg:hidden">
        <button
          type="button"
          aria-label="Open navigation"
          aria-expanded={drawerOpen}
          aria-controls="sidebar"
          onClick={() => setDrawerOpen(true)}
          className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Menu className="size-5" aria-hidden />
        </button>
        <BrandLink rail={false} />
        <Avatar name={session.user.name} className="ml-auto size-8" />
      </header>

      <div
        aria-hidden
        onClick={closeDrawer}
        className={cn(
          'fixed inset-0 z-40 bg-slate-900/25 backdrop-blur-[2px] transition-opacity duration-300 lg:hidden',
          drawerOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      <aside
        id="sidebar"
        aria-label="Sidebar"
        inert={hidden}
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r bg-card/90 shadow-xl backdrop-blur-xl transition-[transform,width] duration-300 lg:translate-x-0 lg:shadow-none',
          EASE,
          drawerOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        style={isDesktop ? { width: rail ? RAIL : WIDE } : undefined}
      >
        <div className={cn('flex h-16 shrink-0 items-center justify-between gap-2 px-4', rail && 'justify-center px-0')}>
          <BrandLink rail={rail} />
          <button
            type="button"
            aria-label="Close navigation"
            onClick={closeDrawer}
            className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted lg:hidden"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="px-3 pb-2">
          <OrganizationBlock rail={rail} />
        </div>

        <Navigation rail={rail} onNavigate={closeDrawer} />

        <div className={cn('px-3 pb-2', rail && 'flex justify-center')}>
          {rail ? <ThemeSwitchButton /> : <ThemeToggle />}
        </div>

        <div className="hidden px-3 pb-1 lg:block">
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-pressed={rail}
            className={cn(
              'flex h-9 w-full items-center gap-3 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
              rail && 'justify-center px-0',
            )}
          >
            <ChevronsLeft className={cn('size-[18px] shrink-0 transition-transform duration-500', EASE, rail && 'rotate-180')} aria-hidden />
            <span className={cn('whitespace-nowrap', rail && 'hidden')}>Collapse</span>
          </button>
        </div>

        <UserBlock rail={rail} />
      </aside>

      <div className={cn('transition-[padding] duration-300', EASE)} style={isDesktop ? { paddingLeft: rail ? RAIL : WIDE } : undefined}>
        <main id="main" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-10">
          {/* A fresh key per page replays the entrance animation on every navigation. */}
          <VerifyEmailBanner />
          <div key={location.pathname} className="animate-page">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
