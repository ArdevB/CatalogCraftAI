import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { useSession } from '@/features/auth/use-session';
import { SystemStatusCard } from '@/features/system/system-status-card';

const WORKFLOW = [
  { step: 'Import', text: 'Upload supplier CSV or Excel files and map their columns.' },
  { step: 'Validate', text: 'Find missing identifiers, duplicate SKUs and invalid prices.' },
  { step: 'Enrich', text: 'Generate title and description suggestions from source facts only.' },
  { step: 'Review', text: 'Approve, edit or reject every suggestion before it is used.' },
  { step: 'Export', text: 'Download a clean CSV with protected values left untouched.' },
];

function CallToAction() {
  const session = useSession();
  if (session.data) {
    return (
      <Button asChild>
        <Link to="/dashboard">Go to dashboard</Link>
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap gap-3">
      <Button asChild>
        <Link to="/register">Create an account</Link>
      </Button>
      <Button asChild variant="outline">
        <Link to="/login">Sign in</Link>
      </Button>
    </div>
  );
}

export function HomePage() {
  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_380px]">
      <section aria-labelledby="intro-heading" className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <h1 id="intro-heading" className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Clean, enrich, review and export ecommerce catalogues in bulk.
          </h1>
          <p className="max-w-2xl text-muted-foreground text-pretty">
            Product facts stay preserved, and every AI-generated change stays under your control.
          </p>
        </div>
        <CallToAction />

        <ol className="grid gap-3 sm:grid-cols-2">
          {WORKFLOW.map(({ step, text }, index) => (
            <li key={step} className="flex gap-3 rounded-lg border bg-card p-4">
              <span
                aria-hidden
                className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
              >
                {index + 1}
              </span>
              <div>
                <p className="text-sm font-medium">{step}</p>
                <p className="text-sm text-muted-foreground">{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <aside aria-label="System status">
        <SystemStatusCard />
      </aside>
    </div>
  );
}
