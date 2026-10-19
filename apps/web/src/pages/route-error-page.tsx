import { isRouteErrorResponse, useRouteError } from 'react-router';
import { CloudOff } from 'lucide-react';
import { BackgroundGlow } from '@/components/background-glow';
import { Button } from '@/components/ui/button';
import { BrandMark } from '@/layouts/app-layout';
import { NotFoundPage } from './not-found-page';

/**
 * Shown when rendering a route throws. Without this, React Router displays
 * its developer error screen. The error is logged to the console for
 * debugging but never rendered, since it may contain internal details.
 */
export function RouteErrorPage() {
  const error = useRouteError();

  if (isRouteErrorResponse(error) && error.status === 404) {
    return <NotFoundPage />;
  }

  console.error(error);

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 px-4 text-center">
      <BackgroundGlow />
      <BrandMark />
      <span className="grid size-14 place-items-center rounded-2xl tint-rose ring-1 ring-inset animate-float">
        <CloudOff className="size-7" aria-hidden />
      </span>
      <div className="flex max-w-md flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="text-muted-foreground">
          An unexpected error stopped this page from loading. Reloading usually fixes it.
        </p>
      </div>
      <Button onClick={() => window.location.reload()}>Reload page</Button>
    </div>
  );
}
