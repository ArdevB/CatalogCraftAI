import { Compass } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <section className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <div aria-hidden className="relative animate-rise">
        <p className="bg-gradient-to-br from-indigo-500 via-violet-500 to-sky-400 bg-clip-text text-8xl font-bold tracking-tighter text-transparent animate-float">404</p>
        <span className="absolute -right-6 -top-2 grid size-10 place-items-center rounded-xl tint-violet ring-1 ring-inset animate-float [animation-delay:600ms]">
          <Compass className="size-5 animate-spin [animation-duration:6s]" />
        </span>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight animate-rise" style={{ animationDelay: '80ms' }}>
        Page not found
      </h1>
      <p className="text-muted-foreground animate-rise" style={{ animationDelay: '140ms' }}>
        The page you are looking for does not exist or has moved.
      </p>
      <Button asChild className="animate-rise" style={{ animationDelay: '200ms' }}>
        <Link to="/">Back to home</Link>
      </Button>
    </section>
  );
}
