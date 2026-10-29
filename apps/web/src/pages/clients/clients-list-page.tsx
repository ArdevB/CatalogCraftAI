import { ArrowUpRight, BookText, Building2, Languages, Loader2, Plus, Search, ShieldBan } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { LANGUAGES, type Client, type WorkspaceAllowance } from '@catalogcraft/shared';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/page-states';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermission, useRequiredSession } from '@/features/auth/use-session';
import { useClientList } from '@/features/clients/use-clients';
import { avatarFor, timeAgo } from '@/features/dashboard/format';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { PLAN_LABELS } from '@/lib/plans';
import { cn } from '@/lib/utils';

const languageLabel = (code: string) => LANGUAGES.find((l) => l.code === code)?.label ?? code;

function AllowanceText({ allowance }: { allowance: WorkspaceAllowance }) {
  const { organization } = useRequiredSession();
  return (
    <span>
      {allowance.limit === null
        ? `${allowance.used} client workspace${allowance.used === 1 ? '' : 's'}`
        : `${allowance.used} of ${allowance.limit} client workspace${allowance.limit === 1 ? '' : 's'} used`}{' '}
      · {PLAN_LABELS[organization.plan]} plan
    </span>
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

function Chip({ icon: Icon, children }: { icon: typeof Languages; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
      <Icon className="size-3" aria-hidden />
      {children}
    </span>
  );
}

function ClientCard({ client, index }: { client: Client; index: number }) {
  const { initials, tone } = avatarFor(client.name);
  const brand = client.brandProfile;
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
  return (
    <li
      className="group relative flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-[0_1px_2px_oklch(0.2_0.01_260/0.04)] transition-[transform,box-shadow,border-color] duration-300 animate-rise focus-within:ring-2 focus-within:ring-ring hover:-translate-y-1 hover:border-primary/30 hover:shadow-lg"
      style={{ animationDelay: `${Math.min(index, 12) * 45}ms` }}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn('grid size-11 shrink-0 place-items-center rounded-xl text-sm font-semibold ring-1 ring-inset transition-transform duration-300 group-hover:scale-105', tone)}
          aria-hidden
        >
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          {/* The link covers the whole card, but is named after the client only. */}
          <Link
            to={`/clients/${client.id}`}
            className="block truncate font-semibold outline-none after:absolute after:inset-0 after:rounded-xl group-hover:text-primary"
          >
            {client.name}
          </Link>
          <p className="truncate text-xs text-muted-foreground">{client.internalReference ?? 'No reference'}</p>
        </div>
        <ArrowUpRight
          className="size-4 shrink-0 text-muted-foreground opacity-0 transition-all duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100"
          aria-hidden
        />
      </div>
      <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">
        {brand.brandTone ? `Tone: ${brand.brandTone}` : 'No brand tone set yet.'}
      </p>
      <div className="mt-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Chip icon={Languages}>{languageLabel(brand.defaultLanguage)}</Chip>
        {brand.prohibitedClaims.length > 0 ? <Chip icon={ShieldBan}>{plural(brand.prohibitedClaims.length, 'banned claim')}</Chip> : null}
        {brand.preferredTerminology.length > 0 ? <Chip icon={BookText}>{plural(brand.preferredTerminology.length, 'term')}</Chip> : null}
        <span className="ml-auto">Updated {timeAgo(client.updatedAt)}</span>
      </div>
    </li>
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
      <PageHeader
        icon={Building2}
        title="Clients"
        description={clients.data ? <AllowanceText allowance={clients.data.allowance} /> : 'Brand profiles for every client you manage.'}
        actions={<NewClientButton allowance={clients.data?.allowance} />}
      />

      <div className="relative max-w-sm animate-rise" style={{ animationDelay: '60ms' }}>
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
        <div role="status" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <span className="sr-only">Loading clients…</span>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : clients.isError ? (
        <ErrorState title="Could not load clients" error={clients.error} onRetry={() => void clients.refetch()} isRetrying={clients.isFetching} />
      ) : clients.data.items.length === 0 ? (
        search ? (
          <EmptyState icon={Search} title={`No clients match “${search}”`}>
            <Button variant="outline" size="sm" onClick={() => setSearchInput('')}>
              Clear search
            </Button>
          </EmptyState>
        ) : (
          <EmptyState icon={Building2} title="No clients yet">
            <p className="max-w-sm text-sm text-muted-foreground">
              Create a workspace for each client you manage catalogues for, with their brand tone and rules.
            </p>
            {canManage ? (
              <Button asChild size="sm" className="mt-1">
                <Link to="/clients/new">Create your first client</Link>
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">Ask an owner or admin to add one.</p>
            )}
          </EmptyState>
        )
      ) : (
        <div className="flex flex-col gap-4">
          <ul className={cn('grid gap-4 transition-opacity sm:grid-cols-2 xl:grid-cols-3', clients.isPlaceholderData && 'opacity-60')}>
            {clients.data.items.map((client, index) => (
              <ClientCard key={client.id} client={client} index={index} />
            ))}
          </ul>
          {clients.data.pagination.totalPages > 1 ? (
            <nav aria-label="Pagination" className="flex items-center justify-between rounded-xl border bg-card px-4 py-3 text-sm">
              <span className="flex items-center gap-2 text-muted-foreground">
                Page {clients.data.pagination.page} of {clients.data.pagination.totalPages}
                {clients.isFetching ? <Loader2 className="size-4 animate-spin" aria-label="Loading" /> : null}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={page >= clients.data.pagination.totalPages} onClick={() => goToPage(page + 1)}>
                  Next
                </Button>
              </div>
            </nav>
          ) : null}
        </div>
      )}
    </div>
  );
}
