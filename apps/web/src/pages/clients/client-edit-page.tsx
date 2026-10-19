import { Pencil } from 'lucide-react';
import { useNavigate } from 'react-router';
import type { Client } from '@catalogcraft/shared';
import { BackLink } from '@/components/back-link';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { usePermission } from '@/features/auth/use-session';
import { ClientForm } from '@/features/clients/client-form';
import { WithClient } from '@/features/clients/client-loader';
import { useUpdateClient } from '@/features/clients/use-clients';

function EditClient({ client }: { client: Client }) {
  const navigate = useNavigate();
  const canManage = usePermission('clients:manage');
  const update = useUpdateClient(client.id);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader eyebrow={<BackLink to={`/clients/${client.id}`}>{client.name}</BackLink>} icon={Pencil} title="Edit client" description="Changes apply to new AI suggestions." />

      {canManage ? (
        <ClientForm
          client={client}
          submitLabel="Save changes"
          pendingLabel="Saving…"
          cancelTo={`/clients/${client.id}`}
          onSubmit={async (values) => {
            await update.mutateAsync({
              name: values.name,
              // An empty field clears the reference.
              internalReference: values.internalReference || null,
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
        <Alert>Only owners and admins can edit client workspaces.</Alert>
      )}
    </div>
  );
}

export function ClientEditPage() {
  return <WithClient>{(client) => <EditClient client={client} />}</WithClient>;
}
