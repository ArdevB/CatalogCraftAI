import { Link, useNavigate } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { usePermission } from '@/features/auth/use-session';
import { ClientForm } from '@/features/clients/client-form';
import { useCreateClient } from '@/features/clients/use-clients';

export function ClientNewPage() {
  const navigate = useNavigate();
  const canManage = usePermission('clients:manage');
  const create = useCreateClient();

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link to="/clients" className="text-sm text-muted-foreground hover:text-foreground">
          ← Clients
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">New client</h1>
      </div>

      {canManage ? (
        <ClientForm
          submitLabel="Create client"
          pendingLabel="Creating…"
          cancelTo="/clients"
          onSubmit={async (values) => {
            const client = await create.mutateAsync({
              name: values.name,
              internalReference: values.internalReference || undefined,
              brandProfile: {
                brandTone: values.brandTone,
                targetAudience: values.targetAudience,
                preferredTerminology: values.preferredTerminology,
                prohibitedClaims: values.prohibitedClaims,
                defaultLanguage: values.defaultLanguage,
                maxTitleLength: values.maxTitleLength,
              },
            });
            await navigate(`/clients/${client.id}`, { replace: true });
          }}
        />
      ) : (
        <Alert>Only owners and admins can create client workspaces.</Alert>
      )}
    </div>
  );
}
