import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { updateOrganizationSchema } from '@catalogcraft/shared';
import { FormField } from '@/components/form-field';
import { errorMessage } from '@/components/page-states';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { applyServerFieldErrors } from '@/features/auth/apply-server-errors';
import { usePermission, useRequiredSession } from '@/features/auth/use-session';
import { ContentRulesCard } from '@/features/organization/content-rules-card';
import { useUpdateOrganization } from '@/features/organization/use-organization';
import { InviteCard } from '@/features/team/invite-card';
import { MembersCard } from '@/features/team/members-card';
import { PLAN_LABELS } from '@/lib/plans';

function OrganizationDetailsCard() {
  const { organization } = useRequiredSession();
  const canEdit = usePermission('organization:update');
  const update = useUpdateOrganization();
  const form = useForm<z.input<typeof updateOrganizationSchema>, unknown, z.output<typeof updateOrganizationSchema>>({
    resolver: zodResolver(updateOrganizationSchema),
    values: { name: organization.name },
  });

  const onSubmit = form.handleSubmit((values) =>
    update.mutate(values, {
      onSuccess: (updated) => form.reset({ name: updated.name }),
      onError: (error) => applyServerFieldErrors(error, ['name'], form.setError),
    }),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Organization</CardTitle>
        <CardDescription>
          {canEdit ? 'Your agency’s name is shown to everyone in your team.' : 'Only owners and admins can change these details.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-muted-foreground">Plan</dt>
            <dd className="mt-1 flex items-center gap-2 font-medium">
              {PLAN_LABELS[organization.plan]}
              <Badge>{organization.subscriptionStatus.replace('_', ' ')}</Badge>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Created</dt>
            <dd className="mt-1 font-medium">{new Date(organization.createdAt).toLocaleDateString()}</dd>
          </div>
        </dl>

        {canEdit ? (
          <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3">
            {update.isError ? <Alert variant="destructive">{errorMessage(update.error)}</Alert> : null}
            {update.isSuccess && !form.formState.isDirty ? (
              <Alert variant="success">
                <CheckCircle2 aria-hidden />
                Organization name saved.
              </Alert>
            ) : null}
            <FormField label="Organization name" error={form.formState.errors.name?.message} {...form.register('name')} />
            <div>
              <Button type="submit" disabled={update.isPending || !form.formState.isDirty}>
                {update.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Save changes
              </Button>
            </div>
          </form>
        ) : (
          <div className="text-sm">
            <p className="text-muted-foreground">Organization name</p>
            <p className="mt-1 font-medium">{organization.name}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function OrganizationSettingsPage() {
  const canManageTeam = usePermission('members:manage');
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Organization settings</h1>
      {/* minmax(0,…) lets wide content (the members table) scroll inside its card instead of widening the page. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="flex flex-col gap-6">
          <OrganizationDetailsCard />
          <ContentRulesCard />
        </div>
        <div className="flex flex-col gap-6">
          <MembersCard />
          {canManageTeam ? <InviteCard /> : null}
        </div>
      </div>
    </div>
  );
}
