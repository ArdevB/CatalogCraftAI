import { zodResolver } from '@hookform/resolvers/zod';
import { Check, Copy, Loader2, MailCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';
import { ASSIGNABLE_ROLES, createInvitationSchema, INVITATION_TTL_DAYS } from '@catalogcraft/shared';
import { FormField, SelectField } from '@/components/form-field';
import { ErrorState, errorMessage, LoadingState } from '@/components/page-states';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { applyServerFieldErrors } from '@/features/auth/apply-server-errors';
import { DevEmailNote } from '@/features/auth/dev-email-note';
import { useFeatures, useRequiredSession } from '@/features/auth/use-session';
import { useUsage } from '@/features/jobs/use-jobs';
import { ROLE_LABELS, RoleBadge } from '@/features/organization/role-badge';
import { useCreateInvitation, useInvitations, useRevokeInvitation } from './use-team';

const ROLE_HELP = {
  admin: 'Admins manage clients, the team and settings.',
  editor: 'Editors import files and run AI enrichment.',
  reviewer: 'Reviewers approve or edit suggestions and export.',
} as const;

/** The link is shown once, right after it's made — only its hash is stored. */
function InvitationLink({ email, link, emailed }: { email: string; link: string; emailed: boolean }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const copy = () =>
    navigator.clipboard.writeText(link).then(
      () => setCopied(true),
      () => setCopied(false),
    );

  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-muted/40 p-3 text-sm animate-rise">
      <p className="flex items-center gap-2 font-medium">
        {emailed ? <MailCheck className="size-4 text-success" aria-hidden /> : null}
        {emailed ? `We emailed the invitation to ${email}. You can also copy the link:` : `Invitation link for ${email}`}
      </p>
      <div className="flex gap-2">
        <Input readOnly value={link} aria-label="Invitation link" onFocus={(event) => event.currentTarget.select()} />
        <Button type="button" variant="outline" onClick={() => void copy()}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      {copied === false ? <p className="text-destructive">Couldn’t copy automatically — select the link and copy it.</p> : null}
      <p className="text-muted-foreground">
        {emailed ? '' : 'Send it to them yourself (email, chat…). '}It works once, only for this email address, and expires in {INVITATION_TTL_DAYS} days.
        You won’t be able to see it again — if it gets lost, invite them again.
      </p>
      {emailed ? <DevEmailNote /> : null}
    </div>
  );
}

export function InviteCard() {
  const { role } = useRequiredSession();
  const create = useCreateInvitation();
  const revoke = useRevokeInvitation();
  const invitations = useInvitations(true);
  const seats = useUsage(true).data?.limits.members;
  const canEmail = useFeatures().data?.email ?? false;
  const roles = ASSIGNABLE_ROLES.filter((option) => role === 'owner' || option !== 'admin');

  const form = useForm<z.input<typeof createInvitationSchema>, unknown, z.output<typeof createInvitationSchema>>({
    resolver: zodResolver(createInvitationSchema),
    defaultValues: { email: '', role: 'editor', sendEmail: true },
  });
  const selectedRole = useWatch({ control: form.control, name: 'role' });
  const sendEmail = useWatch({ control: form.control, name: 'sendEmail' });
  const onSubmit = form.handleSubmit((values) =>
    create.mutate(values, {
      onSuccess: () => form.reset({ email: '', role: values.role, sendEmail: values.sendEmail }),
      onError: (error) => applyServerFieldErrors(error, ['email', 'role'], form.setError),
    }),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite a teammate</CardTitle>
        <CardDescription>
          {seats
            ? `${seats.used} of ${seats.limit ?? 'unlimited'} seats used — pending invitations count too.`
            : 'Create a one-time link for someone to join this organization.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3">
          {create.isError ? <Alert variant="destructive">{errorMessage(create.error)}</Alert> : null}
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <FormField label="Email" type="email" autoComplete="off" error={form.formState.errors.email?.message} {...form.register('email')} />
            <SelectField label="Role" error={form.formState.errors.role?.message} {...form.register('role')}>
              {roles.map((option) => (
                <option key={option} value={option}>
                  {ROLE_LABELS[option]}
                </option>
              ))}
            </SelectField>
          </div>
          <p className="text-sm text-muted-foreground">{ROLE_HELP[selectedRole as keyof typeof ROLE_HELP] ?? ''}</p>
          {canEmail ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-[var(--primary)]" {...form.register('sendEmail')} />
              Email the link to them
            </label>
          ) : null}
          <div>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {canEmail && sendEmail ? 'Send invitation' : 'Create invitation link'}
            </Button>
          </div>
        </form>

        {create.data ? (
          <InvitationLink email={create.data.invitation.email} link={`${window.location.origin}/invite/${create.data.token}`} emailed={create.data.emailed} />
        ) : null}

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Pending invitations</h3>
          {revoke.isError ? <Alert variant="destructive">{errorMessage(revoke.error)}</Alert> : null}
          {invitations.isPending ? (
            <LoadingState label="Loading invitations…" />
          ) : invitations.isError ? (
            <ErrorState title="Could not load invitations" error={invitations.error} onRetry={() => void invitations.refetch()} isRetrying={invitations.isFetching} />
          ) : invitations.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending invitations.</p>
          ) : (
            <ul className="divide-y text-sm">
              {invitations.data.map((invitation) => (
                <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{invitation.email}</span>
                    <RoleBadge role={invitation.role} />
                    <span className="text-muted-foreground">expires {new Date(invitation.expiresAt).toLocaleDateString()}</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={revoke.isPending && revoke.variables === invitation.id}
                    onClick={() => revoke.mutate(invitation.id)}
                    aria-label={`Cancel invitation for ${invitation.email}`}
                  >
                    Cancel
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
