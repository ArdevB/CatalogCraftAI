import { Link, Outlet } from 'react-router';

export function BrandMark({ to = '/' }: { to?: string }) {
  return (
    <Link
      to={to}
      className="flex shrink-0 items-center gap-2 rounded-md font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-ring"
    >
      <img src="/favicon.svg" alt="" className="size-6" />
      CatalogCraft AI
    </Link>
  );
}

/** Shell for public pages (landing, sign-in, registration). */
export function AppLayout() {
  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>
      <header className="border-b bg-card">
        <div className="mx-auto flex h-14 max-w-6xl items-center px-4 sm:px-6">
          <BrandMark />
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <Outlet />
      </main>
    </div>
  );
}
