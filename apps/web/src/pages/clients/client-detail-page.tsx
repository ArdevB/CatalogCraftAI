import { BookText, Languages, Loader2, Megaphone, Pencil, Ruler, ShieldBan, Trash2, Users, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { LANGUAGES, type Client } from '@catalogcraft/shared';
import { BackLink } from '@/components/back-link';
import { errorMessage } from '@/components/page-states';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { usePermission } from '@/features/auth/use-session';
import { WithClient } from '@/features/clients/client-loader';
import { useDeleteClient } from '@/features/clients/use-clients';
import { avatarFor, timeAgo } from '@/features/dashboard/format';
import { ClientJobsCard } from '@/features/jobs/client-jobs-card';
import { cn } from '@/lib/utils';

function Detail({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
        <dd className="mt-1 text-sm">{children}</dd>
      </div>
    </div>
  );
}

function TermList({ items, emptyText, tone }: { items: string[]; emptyText: string; tone: string }) {
  if (items.length === 0) return <span className="text-muted-foreground">{emptyText}</span>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item, i) => (
        <li key={item} className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset animate-rise', tone)} style={{ animationDelay: `${i * 40}ms` }}>
          {item}
        </li>
      ))}
    </ul>
  );
}

/**
 * Deleting asks for confirmation inline (no browser pop-up), and the API
 * double-checks the permission and organization.
 */
function DeleteClient({ client }: { client: Client }) {
  const [confirming, setConfirming] = useState(false);
  const remove = useDeleteClient(client.id);
  const navigate = useNavigate();

  if (!confirming) {
    return (
      <Button variant="outline" onClick={() => setConfirming(true)}>
        <Trash2 aria-hidden />
        Delete
      </Button>
    );
  }
  return (
    <div role="alertdialog" aria-labelledby="delete-title" className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 animate-rise">
      <p id="delete-title" className="text-sm font-medium">
        Delete “{client.name}”? This permanently removes the client workspace and its brand profile.
      </p>
      {remove.isError ? <Alert variant="destructive">{errorMessage(remove.error)}</Alert> : null}
      <div className="flex gap-2">
        <Button
          variant="destructive"
          size="sm"
          disabled={remove.isPending}
          onClick={() => remove.mutate(undefined, { onSuccess: () => void navigate('/clients', { replace: true }) })}
        >
          {remove.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Delete client
        </Button>
        <Button variant="outline" size="sm" disabled={remove.isPending} onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function ClientDetail({ client }: { client: Client }) {
  const canManage = usePermission('clients:manage');
  const { brandProfile } = client;
  const language = LANGUAGES.find((l) => l.code === brandProfile.defaultLanguage)?.label ?? brandProfile.defaultLanguage;
  const { initials, tone } = avatarFor(client.name);

  return (
    <div className="flex flex-col gap-6">
      <div className="animate-rise">
        <BackLink to="/clients">Clients</BackLink>
      </div>

      {/* Hero: a soft colour banner with the client's avatar overlapping it. */}
      <Card className="overflow-hidden animate-rise">
        <div aria-hidden className="relative h-24 overflow-hidden bg-gradient-to-r from-indigo-500/20 via-violet-500/15 to-sky-500/20">
          <div className="absolute -left-10 -top-16 size-48 rounded-full bg-indigo-400/30 blur-2xl animate-drift-a" />
          <div className="absolute -bottom-20 right-10 size-56 rounded-full bg-sky-400/25 blur-2xl animate-drift-b" />
        </div>
        <div className="flex flex-col gap-4 px-6 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-end gap-4">
            <span className={cn('-mt-10 grid size-20 shrink-0 place-items-center rounded-2xl text-2xl font-semibold shadow-lg ring-4 ring-card', tone)} aria-hidden>
              {initials}
            </span>
            <div className="min-w-0 pb-1">
              <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">{client.name}</h1>
              <p className="text-sm text-muted-foreground">
                {client.internalReference ? `Ref. ${client.internalReference} · ` : ''}
                Updated {timeAgo(client.updatedAt)}
              </p>
            </div>
          </div>
          {canManage ? (
            <div className="flex items-start gap-2">
              <Button asChild variant="outline">
                <Link to={`/clients/${client.id}/edit`}>
                  <Pencil aria-hidden />
                  Edit
                </Link>
              </Button>
              <DeleteClient client={client} />
            </div>
          ) : null}
        </div>
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 animate-rise" style={{ animationDelay: '80ms' }}>
          <ClientJobsCard clientId={client.id} />
        </div>
        <Card className="min-w-0 animate-rise" style={{ animationDelay: '140ms' }}>
          <CardHeader>
            <CardTitle>Brand profile</CardTitle>
            <CardDescription>Rules AI suggestions for this client must follow.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-5">
              <Detail icon={Languages} label="Default language">
                {language}
              </Detail>
              <Detail icon={Ruler} label="Maximum title length">
                {brandProfile.maxTitleLength} characters
              </Detail>
              <Detail icon={Megaphone} label="Brand tone">
                {brandProfile.brandTone || <span className="text-muted-foreground">Not set</span>}
              </Detail>
              <Detail icon={Users} label="Target audience">
                {brandProfile.targetAudience || <span className="text-muted-foreground">Not set</span>}
              </Detail>
              <Detail icon={BookText} label="Preferred terminology">
                <TermList items={brandProfile.preferredTerminology} emptyText="None" tone="tint-sky" />
              </Detail>
              <Detail icon={ShieldBan} label="Prohibited claims">
                <TermList items={brandProfile.prohibitedClaims} emptyText="None" tone="tint-rose" />
              </Detail>
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function ClientDetailPage() {
  return <WithClient>{(client) => <ClientDetail client={client} />}</WithClient>;
}
