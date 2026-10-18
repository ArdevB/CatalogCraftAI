import { Building2, Loader2, Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { LANGUAGES, type WorkspaceAllowance } from '@catalogcraft/shared';
import { ErrorState, LoadingState } from '@/components/page-states';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { usePermission, useRequiredSession } from '@/features/auth/use-session';
import { useClientList } from '@/features/clients/use-clients';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { PLAN_LABELS } from '@/lib/plans';

const languageLabel = (code: string) => LANGUAGES.find((l) => l.code === code)?.label ?? code;

function AllowanceText({ allowance }: { allowance: WorkspaceAllowance }) {
  const { organization } = useRequiredSession();
  return (
    <p className="text-sm text-muted-foreground">
      {allowance.limit === null
        ? `${allowance.used} client workspace${allowance.used === 1 ? '' : 's'}`
        : `${allowance.used} of ${allowance.limit} client workspace${allowance.limit === 1 ? '' : 's'} used`}{' '}
      · {PLAN_LABELS[organization.plan]} plan
    </p>
  );
}

function NewClientButton({ allowance }: { allowance: WorkspaceAllowance | undefined }) {
  const canManage = usePermission('clients:manage');
  if (!canManage) return null;

  const atLimit = allowance !== undefined && allowance.limit !== null && allowance.used >= allowance.limit;
  if (atLimit) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button disabled aria-describedby="client-limit-note">
          <Plus aria-hidden />
          New client
        </Button>
        <p id="client-limit-note" className="text-xs text-muted-foreground">
          Plan limit reached — upgrade to add more clients.
        </p>
      </div>
    );
  }
  return (
    <Button asChild>
      <Link to="/clients/new">
        <Plus aria-hidden />
        New client
      </Link>
    </Button>
  );
}

export function ClientsListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const search = searchParams.get('search') ?? '';
  const [searchInput, setSearchInput] = useState(search);
  const debouncedSearch = useDebouncedValue(searchInput.trim());
  const canManage = usePermission('clients:manage');

  // Put the (debounced) search into the URL so it survives reloads and back/forward.
  useEffect(() => {
    if (debouncedSearch === search) return;
    setSearchParams(debouncedSearch ? { search: debouncedSearch } : {}, { replace: true });
  }, [debouncedSearch, search, setSearchParams]);

  const clients = useClientList({ page, search });
  const goToPage = (next: number) => {
    const params = new URLSearchParams(searchParams);
    params.set('page', String(next));
    setSearchParams(params);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          {clients.data ? <AllowanceText allowance={clients.data.allowance} /> : null}
        </div>
        <NewClientButton allowance={clients.data?.allowance} />
      </div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          aria-label="Search clients"
          placeholder="Search by name or reference"
          className="pl-9"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
        />
      </div>

      {clients.isPending ? (
        <LoadingState label="Loading clients…" />
      ) : clients.isError ? (
        <ErrorState
          title="Could not load clients"
          error={clients.error}
          onRetry={() => void clients.refetch()}
          isRetrying={clients.isFetching}
        />
      ) : clients.data.items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Building2 className="size-8 text-muted-foreground" aria-hidden />
            {search ? (
              <>
                <p className="font-medium">No clients match “{search}”</p>
                <Button variant="outline" size="sm" onClick={() => setSearchInput('')}>
                  Clear search
                </Button>
              </>
            ) : (
              <>
                <p className="font-medium">No clients yet</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Create a workspace for each client you manage catalogues for, with their brand tone and rules.
                </p>
                {canManage ? (
                  <Button asChild size="sm">
                    <Link to="/clients/new">Create your first client</Link>
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground">Ask an owner or admin to add one.</p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th scope="col" className="px-4 py-2.5 font-medium">Name</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Reference</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Language</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Last updated</th>
                </tr>
              </thead>
              <tbody className={clients.isPlaceholderData ? 'divide-y opacity-60' : 'divide-y'}>
                {clients.data.items.map((client) => (
                  <tr key={client.id} className="hover:bg-muted/50">
                    <td className="px-4 py-3 font-medium">
                      <Link to={`/clients/${client.id}`} className="text-primary hover:underline">
                        {client.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{client.internalReference ?? '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {languageLabel(client.brandProfile.defaultLanguage)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(client.updatedAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {clients.data.pagination.totalPages > 1 ? (
            <nav aria-label="Pagination" className="flex items-center justify-between border-t px-4 py-3 text-sm">
              <span className="flex items-center gap-2 text-muted-foreground">
                Page {clients.data.pagination.page} of {clients.data.pagination.totalPages}
                {clients.isFetching ? <Loader2 className="size-4 animate-spin" aria-label="Loading" /> : null}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= clients.data.pagination.totalPages}
                  onClick={() => goToPage(page + 1)}
                >
                  Next
                </Button>
              </div>
            </nav>
          ) : null}
        </Card>
      )}
    </div>
  );
}
