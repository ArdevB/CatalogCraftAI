import { Link, Outlet, useLocation } from 'react-router';
import { BackgroundGlow } from '@/components/background-glow';
import { ThemeSwitchButton } from '@/components/theme-toggle';

export function BrandMark({ to = '/' }: { to?: string }) {
  return (
    <Link
      to={to}
      className="group/brand flex shrink-0 items-center gap-2.5 rounded-lg font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span className="grid size-8 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 shadow-md shadow-indigo-500/25 transition-transform duration-500 group-hover/brand:rotate-[8deg] group-hover/brand:scale-105">
        <svg viewBox="0 0 32 32" className="size-5" aria-hidden>
          {['M9 10h14', 'M9 16h14', 'M9 22h8'].map((d) => (
            <path key={d} d={d} stroke="white" strokeWidth={2.6} strokeLinecap="round" />
          ))}
        </svg>
      </span>
      CatalogCraft AI
    </Link>
  );
}

/** Shell for public pages (landing, sign-in, registration, invitations). */
export function AppLayout() {
  const { pathname } = useLocation();
  return (
    <div className="flex min-h-svh flex-col">
      <BackgroundGlow />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>
      <header>
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <BrandMark />
          <ThemeSwitchButton />
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <div key={pathname} className="animate-page">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
