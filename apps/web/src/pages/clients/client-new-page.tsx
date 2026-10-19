import { Building2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { BackLink } from '@/components/back-link';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { usePermission } from '@/features/auth/use-session';
import { ClientForm } from '@/features/clients/client-form';
import { useCreateClient } from '@/features/clients/use-clients';

export function ClientNewPage() {
  const navigate = useNavigate();
  const canManage = usePermission('clients:manage');
  const create = useCreateClient();

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader eyebrow={<BackLink to="/clients">Clients</BackLink>} icon={Building2} title="New client" description="A workspace with the brand rules AI suggestions must follow." />

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
