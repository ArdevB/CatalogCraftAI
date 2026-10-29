import { zodResolver } from '@hookform/resolvers/zod';
import { BadgeCheck, CheckCircle2, Loader2, MailWarning, Trash2, UserRound } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import type { z } from 'zod';
import { changePasswordSchema, deleteAccountSchema, PASSWORD_MIN_LENGTH } from '@catalogcraft/shared';
import { FormField } from '@/components/form-field';
import { PageHeader } from '@/components/page-header';
import { errorMessage } from '@/components/page-states';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { applyServerFieldErrors } from '@/features/auth/apply-server-errors';
import { useChangePassword, useFeatures, useRequiredSession, useResendVerification } from '@/features/auth/use-session';
import { ROLE_LABELS } from '@/features/organization/role-badge';
import { useDeleteAccount } from '@/features/organization/use-organization';
import { avatarFor } from '@/features/dashboard/format';
import { cn } from '@/lib/utils';

/** Whether the address is confirmed, with a way to get a new link if it isn't. */
function EmailStatus() {
  const { user } = useRequiredSession();
  const canEmail = useFeatures().data?.email ?? false;
  const resend = useResendVerification();

  if (user.emailVerified) {
    return (
      <Badge variant="success" className="animate-pop">
        <BadgeCheck className="size-3.5" aria-hidden />
        Verified
      </Badge>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Badge variant="warning">
        <MailWarning className="size-3.5" aria-hidden />
        Not verified
      </Badge>
      {canEmail ? (
        resend.isSuccess ? (
          <span className="text-xs text-success">New link sent — check your inbox.</span>
        ) : (
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={resend.isPending} onClick={() => resend.mutate()}>
            {resend.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Resend link
          </Button>
        )
      ) : null}
      {resend.isError ? <span className="text-xs text-destructive">{errorMessage(resend.error)}</span> : null}
    </span>
  );
}

function ChangePasswordCard() {
  const change = useChangePassword();
  const form = useForm<z.input<typeof changePasswordSchema>, unknown, z.output<typeof changePasswordSchema>>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });
  const onSubmit = form.handleSubmit((values) =>
    change.mutate(values, {
      onSuccess: () => form.reset(),
      onError: (error) => applyServerFieldErrors(error, ['currentPassword', 'newPassword'], form.setError),
    }),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change password</CardTitle>
        <CardDescription>You stay signed in here; every other device is signed out.</CardDescription>
      </CardHeader>
      <CardContent>
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3">
          {change.isError && !form.formState.errors.currentPassword && !form.formState.errors.newPassword ? (
            <Alert variant="destructive">{errorMessage(change.error)}</Alert>
          ) : null}
          {change.isSuccess && !form.formState.isDirty ? (
            <Alert variant="success">
              <CheckCircle2 aria-hidden />
              Password changed. Other devices have been signed out.
            </Alert>
          ) : null}
          <FormField
            label="Current password"
            type="password"
            autoComplete="current-password"
            error={form.formState.errors.currentPassword?.message}
            {...form.register('currentPassword')}
          />
          <FormField
            label="New password"
            type="password"
            autoComplete="new-password"
            hint={`At least ${PASSWORD_MIN_LENGTH} characters. A short phrase works well.`}
            error={form.formState.errors.newPassword?.message}
            {...form.register('newPassword')}
          />
          <div>
            <Button type="submit" disabled={change.isPending}>
              {change.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Change password
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function DeleteAccountCard() {
  const { organizations } = useRequiredSession();
  const remove = useDeleteAccount();
  const navigate = useNavigate();
  const owned = organizations.filter((organization) => organization.role === 'owner');
  const form = useForm<z.input<typeof deleteAccountSchema>, unknown, z.output<typeof deleteAccountSchema>>({
    resolver: zodResolver(deleteAccountSchema),
    defaultValues: { password: '' },
  });
  const onSubmit = form.handleSubmit((values) =>
    remove.mutate(values, {
      onSuccess: () => void navigate('/', { replace: true }),
      onError: (error) => applyServerFieldErrors(error, ['password'], form.setError),
    }),
  );

  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle>Delete account</CardTitle>
        <CardDescription>
          Permanently deletes your login and removes you from every organization. Work you did (jobs, reviews, exports) stays with each
          organization and shows as “Former member”.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {owned.length > 0 ? (
          <Alert>
            You own {owned.map((organization) => `“${organization.name}”`).join(', ')}. An organization can’t be left without its owner, so
            delete {owned.length === 1 ? 'it' : 'them'} first in Organization settings.
          </Alert>
        ) : (
          <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3">
            {remove.isError && !form.formState.errors.password ? <Alert variant="destructive">{errorMessage(remove.error)}</Alert> : null}
            <FormField
              label="Confirm with your password"
              type="password"
              autoComplete="current-password"
              error={form.formState.errors.password?.message}
              {...form.register('password')}
            />
            <div>
              <Button type="submit" variant="destructive" disabled={remove.isPending}>
                {remove.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
                Delete my account
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export function AccountPage() {
  const { user, organizations } = useRequiredSession();
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader icon={UserRound} tint="violet" title="Your account" description="Your profile, password and data." />
      <Card className="animate-rise" style={{ animationDelay: '60ms' }}>
        <CardHeader className="flex-row items-center gap-4 space-y-0">
          <span className={cn('grid size-14 shrink-0 place-items-center rounded-2xl text-lg font-semibold ring-1 ring-inset', avatarFor(user.name).tone)} aria-hidden>
            {avatarFor(user.name).initials}
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <CardTitle>{user.name}</CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-2">
              <span className="truncate">{user.email}</span>
              <EmailStatus />
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <h2 className="mb-2 text-sm font-medium">Organizations</h2>
          <ul className="divide-y text-sm">
            {organizations.map((organization) => (
              <li key={organization.id} className="flex justify-between gap-3 py-2">
                <span>{organization.name}</span>
                <span className="text-muted-foreground">{ROLE_LABELS[organization.role]}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <div className="animate-rise" style={{ animationDelay: '120ms' }}>
        <ChangePasswordCard />
      </div>
      <div className="animate-rise" style={{ animationDelay: '180ms' }}>
        <DeleteAccountCard />
      </div>
    </div>
  );
}
