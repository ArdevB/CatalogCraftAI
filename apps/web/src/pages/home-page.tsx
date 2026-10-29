import { ArrowRight, ClipboardCheck, FileDown, FileUp, ShieldCheck, Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { useSession } from '@/features/auth/use-session';
import { SystemStatusCard } from '@/features/system/system-status-card';

const WORKFLOW = [
  { step: 'Import', text: 'Upload supplier CSV or Excel files and map their columns.', icon: FileUp, tint: 'tint-sky' },
  { step: 'Validate', text: 'Find missing identifiers, duplicate SKUs and invalid prices.', icon: ShieldCheck, tint: 'tint-emerald' },
  { step: 'Enrich', text: 'Generate title and description suggestions from source facts only.', icon: Sparkles, tint: 'tint-violet' },
  { step: 'Review', text: 'Approve, edit or reject every suggestion before it is used.', icon: ClipboardCheck, tint: 'tint-amber' },
  { step: 'Export', text: 'Download a clean CSV with protected values left untouched.', icon: FileDown, tint: 'tint-indigo' },
];

function CallToAction() {
  const session = useSession();
  if (session.data) {
    return (
      <Button asChild size="lg">
        <Link to="/dashboard">
          Go to dashboard <ArrowRight aria-hidden />
        </Link>
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap gap-3">
      <Button asChild size="lg">
        <Link to="/register">Create an account</Link>
      </Button>
      <Button asChild size="lg" variant="outline">
        <Link to="/login">Sign in</Link>
      </Button>
    </div>
  );
}

export function HomePage() {
  return (
    <div className="grid gap-12 lg:grid-cols-[1fr_380px]">
      <section aria-labelledby="intro-heading" className="flex flex-col gap-8">
        <div className="flex flex-col gap-4">
          <p className="inline-flex w-fit items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground animate-rise">
            <span className="relative size-1.5 rounded-full bg-emerald-500 text-emerald-500 animate-pulse-ring" aria-hidden />
            For ecommerce agencies
          </p>
          <h1 id="intro-heading" className="text-4xl font-semibold tracking-tight text-balance animate-rise sm:text-5xl" style={{ animationDelay: '60ms' }}>
            Clean, enrich, review and export{' '}
            <span className="bg-gradient-to-r from-indigo-500 via-violet-500 to-sky-500 bg-clip-text text-transparent">ecommerce catalogues</span> in bulk.
          </h1>
          <p className="max-w-2xl text-lg text-muted-foreground text-pretty animate-rise" style={{ animationDelay: '120ms' }}>
            Product facts stay preserved, and every AI-generated change stays under your control.
          </p>
        </div>
        <div className="animate-rise" style={{ animationDelay: '180ms' }}>
          <CallToAction />
        </div>

        {/* The workflow as a connected timeline. */}
        <ol className="relative flex flex-col gap-3">
          <span aria-hidden className="absolute bottom-6 left-[1.6rem] top-6 w-px bg-gradient-to-b from-sky-400 via-violet-400 to-indigo-400 opacity-50" />
          {WORKFLOW.map(({ step, text, icon: Icon, tint }, index) => (
            <li
              key={step}
              className="relative flex items-center gap-4 rounded-xl border bg-card p-3 pr-4 transition-[transform,box-shadow] duration-300 animate-rise hover:translate-x-1 hover:shadow-md"
              style={{ animationDelay: `${240 + index * 70}ms` }}
            >
              <span className={`grid size-10 shrink-0 place-items-center rounded-xl ring-1 ring-inset ${tint}`}>
                <Icon className="size-5" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-medium">
                  <span className="text-muted-foreground">{index + 1}. </span>
                  {step}
                </p>
                <p className="text-sm text-muted-foreground">{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <aside aria-label="System status" className="animate-rise" style={{ animationDelay: '300ms' }}>
        <SystemStatusCard />
      </aside>
    </div>
  );
}
