import { Loader2, Pencil, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { LANGUAGES, type Client } from '@catalogcraft/shared';
import { errorMessage } from '@/components/page-states';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { usePermission } from '@/features/auth/use-session';
import { WithClient } from '@/features/clients/client-loader';
import { useDeleteClient } from '@/features/clients/use-clients';
import { ClientJobsCard } from '@/features/jobs/client-jobs-card';

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  );
}

function TermList({ items, emptyText }: { items: string[]; emptyText: string }) {
  if (items.length === 0) return <span className="text-muted-foreground">{emptyText}</span>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li key={item}>
          <Badge>{item}</Badge>
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
    <div role="alertdialog" aria-labelledby="delete-title" className="flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4">
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Link to="/clients" className="text-sm text-muted-foreground hover:text-foreground">
            ← Clients
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
          <p className="text-sm text-muted-foreground">
            {client.internalReference ? `Ref. ${client.internalReference} · ` : ''}
            Updated {new Date(client.updatedAt).toLocaleString()}
          </p>
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

      <Card>
        <CardHeader>
          <CardTitle>Brand profile</CardTitle>
          <CardDescription>Rules AI suggestions for this client must follow.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-5 sm:grid-cols-2">
            <Detail label="Default language">{language}</Detail>
            <Detail label="Maximum title length">{brandProfile.maxTitleLength} characters</Detail>
            <Detail label="Brand tone">
              {brandProfile.brandTone || <span className="text-muted-foreground">Not set</span>}
            </Detail>
            <Detail label="Target audience">
              {brandProfile.targetAudience || <span className="text-muted-foreground">Not set</span>}
            </Detail>
            <Detail label="Preferred terminology">
              <TermList items={brandProfile.preferredTerminology} emptyText="None" />
            </Detail>
            <Detail label="Prohibited claims">
              <TermList items={brandProfile.prohibitedClaims} emptyText="None" />
            </Detail>
          </dl>
        </CardContent>
      </Card>

      <ClientJobsCard clientId={client.id} />
    </div>
  );
}

export function ClientDetailPage() {
  return <WithClient>{(client) => <ClientDetail client={client} />}</WithClient>;
}
