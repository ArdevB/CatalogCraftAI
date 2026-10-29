import { CheckCircle2, ClipboardCheck, ShieldCheck, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const PROMISES = [
  { icon: ShieldCheck, text: 'SKUs, prices, stock and barcodes are never changed.' },
  { icon: Sparkles, text: 'AI suggests titles and descriptions from your own data.' },
  { icon: ClipboardCheck, text: 'Nothing is exported until a person approves it.' },
];

/** The decorative half of the sign-in screens (wide screens only). */
function Showcase() {
  return (
    <div aria-hidden className="relative hidden overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-violet-600 to-sky-500 p-10 text-white shadow-2xl shadow-indigo-500/20 lg:flex lg:flex-col lg:justify-between">
      <div className="absolute -right-24 -top-24 size-96 rounded-full bg-[radial-gradient(circle,rgb(255_255_255/0.35)_0%,transparent_65%)]  will-change-transform animate-drift-a" />
      <div className="absolute -bottom-32 -left-16 size-[28rem] rounded-full bg-[radial-gradient(circle,var(--color-sky-300)_0%,transparent_65%)] opacity-50 will-change-transform animate-drift-b" />
      {/* A faint grid gives the gradient some texture. */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgb(255_255_255/0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.06)_1px,transparent_1px)] bg-[size:32px_32px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />

      <div className="relative flex flex-col gap-4">
        <p className="text-3xl font-semibold leading-tight tracking-tight text-balance animate-rise">Clean, enrich and export catalogues — safely.</p>
        <ul className="flex flex-col gap-3 text-sm text-white/85">
          {PROMISES.map(({ icon: Icon, text }, i) => (
            <li key={text} className="flex items-start gap-3 animate-rise" style={{ animationDelay: `${150 + i * 90}ms` }}>
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white/15 ring-1 ring-inset ring-white/20">
                <Icon className="size-4" />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </div>

      {/* A tiny before/after: the kind of change CatalogCraft suggests, then approved. */}
      <div className="relative mt-10 rounded-2xl bg-white/95 p-5 text-slate-900 shadow-2xl animate-float">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Original</p>
        <p className="mt-1 text-sm text-slate-500 line-through decoration-rose-400/70">stoneware mug blue 350ml</p>
        <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-indigo-500 animate-rise" style={{ animationDelay: '500ms' }}>
          Suggested
        </p>
        <p className="mt-1 text-sm font-medium animate-rise" style={{ animationDelay: '650ms' }}>
          Blue Stoneware Mug, 350 ml
        </p>
        <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs">
          <span className="text-slate-400">SKU 00042 · €12.50 · unchanged</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 animate-pop" style={{ animationDelay: '1100ms' }}>
            <CheckCircle2 className="size-3.5" />
            Approved
          </span>
        </div>
      </div>
    </div>
  );
}

export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="mx-auto grid w-full max-w-5xl items-stretch gap-10 py-2 lg:grid-cols-2 lg:py-6">
      <Showcase />
      <div className="mx-auto flex w-full max-w-sm flex-col justify-center gap-4 animate-rise">
        <Card className="shadow-xl shadow-indigo-500/5">
          <CardHeader>
            <CardTitle>
              <span className="text-2xl">{title}</span>
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
        <p className="text-center text-sm text-muted-foreground">{footer}</p>
      </div>
    </div>
  );
}
