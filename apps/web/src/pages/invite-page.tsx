import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, MailWarning } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import type { z } from 'zod';
import {
  PASSWORD_MIN_LENGTH,
  registerFromInvitationSchema,
  signInFromInvitationSchema,
  type InvitationPreview,
  type SessionInfo,
} from '@catalogcraft/shared';
import { FormField } from '@/components/form-field';
import { ErrorState, errorMessage, LoadingState } from '@/components/page-states';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { applyServerFieldErrors } from '@/features/auth/apply-server-errors';
import { AuthCard } from '@/features/auth/auth-card';
import { useLogout, useSession } from '@/features/auth/use-session';
import { ROLE_LABELS } from '@/features/organization/role-badge';
import {
  useAcceptInvitation,
  useInvitationPreview,
  useRegisterFromInvitation,
  useSignInFromInvitation,
} from '@/features/team/use-team';
import { ApiError } from '@/lib/api-client';

const STATUS_MESSAGES: Record<Exclude<InvitationPreview['status'], 'pending'>, string> = {
  accepted: 'This invitation has already been used. If it was you, sign in to continue.',
  revoked: 'This invitation was cancelled. Ask the person who invited you for a new link.',
  expired: 'This invitation has expired. Ask the person who invited you for a new link.',
};

function CreateAccountForm({ token, onDone }: { token: string; onDone: () => void }) {
  const register = useRegisterFromInvitation(token);
  const form = useForm<z.input<typeof registerFromInvitationSchema>, unknown, z.output<typeof registerFromInvitationSchema>>({
    resolver: zodResolver(registerFromInvitationSchema),
    defaultValues: { name: '', password: '' },
  });
  const { errors } = form.formState;
  const onSubmit = form.handleSubmit((values) =>
    register.mutate(values, {
      onSuccess: onDone,
      onError: (error) => applyServerFieldErrors(error, ['name', 'password'], form.setError),
    }),
  );

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      {register.isError ? <Alert variant="destructive">{errorMessage(register.error)}</Alert> : null}
      <FormField label="Your name" autoComplete="name" autoFocus error={errors.name?.message} {...form.register('name')} />
      <FormField
        label="Choose a password"
        type="password"
        autoComplete="new-password"
        hint={`At least ${PASSWORD_MIN_LENGTH} characters. A short phrase works well.`}
        error={errors.password?.message}
        {...form.register('password')}
      />
      <Button type="submit" disabled={register.isPending}>
        {register.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Create account and join
      </Button>
    </form>
  );
}

function SignInForm({ token, onDone }: { token: string; onDone: () => void }) {
  const signIn = useSignInFromInvitation(token);
  const form = useForm<z.input<typeof signInFromInvitationSchema>, unknown, z.output<typeof signInFromInvitationSchema>>({
    resolver: zodResolver(signInFromInvitationSchema),
    defaultValues: { password: '' },
  });
  const onSubmit = form.handleSubmit((values) =>
    signIn.mutate(values, {
      onSuccess: onDone,
      onError: (error) => applyServerFieldErrors(error, ['password'], form.setError),
    }),
  );

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      {signIn.isError ? <Alert variant="destructive">{errorMessage(signIn.error)}</Alert> : null}
      <FormField
        label="Password"
        type="password"
        autoComplete="current-password"
        autoFocus
        error={form.formState.errors.password?.message}
        {...form.register('password')}
      />
      <Button type="submit" disabled={signIn.isPending}>
        {signIn.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Sign in and join
      </Button>
    </form>
  );
}

function SignedInChoice({ token, invitation, session, onDone }: { token: string; invitation: InvitationPreview; session: SessionInfo; onDone: () => void }) {
  const accept = useAcceptInvitation(token);
  const logout = useLogout();

  if (session.user.email.toLowerCase() !== invitation.email) {
    return (
      <div className="flex flex-col gap-4">
        <Alert>
          <MailWarning aria-hidden />
          This invitation is for {invitation.email}, but you’re signed in as {session.user.email}.
        </Alert>
        <Button variant="outline" disabled={logout.isPending} onClick={() => logout.mutate()}>
          {logout.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Sign out and continue as {invitation.email}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {accept.isError ? <Alert variant="destructive">{errorMessage(accept.error)}</Alert> : null}
      <Button disabled={accept.isPending} onClick={() => accept.mutate(undefined, { onSuccess: onDone })}>
        {accept.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Join {invitation.organizationName}
      </Button>
    </div>
  );
}

/** Public page behind an invitation link: shows the invitation and lets the person join. */
export function InvitePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const session = useSession();
  const preview = useInvitationPreview(token);
  const [mode, setMode] = useState<'create' | 'sign-in'>('create');
  const done = () => void navigate('/dashboard', { replace: true });

  if (preview.isPending || session.isPending) return <LoadingState label="Opening your invitation…" />;
  if (preview.isError) {
    const invalid = preview.error instanceof ApiError && (preview.error.status === 404 || preview.error.status === 400);
    return (
      <div className="mx-auto max-w-md py-10">
        {invalid ? (
          <Alert variant="destructive">This invitation link is not valid. Check that you copied all of it.</Alert>
        ) : (
          <ErrorState title="Could not open the invitation" error={preview.error} onRetry={() => void preview.refetch()} isRetrying={preview.isFetching} />
        )}
      </div>
    );
  }

  const invitation = preview.data;
  const description = `${invitation.invitedByName} invited ${invitation.email} to join ${invitation.organizationName} as ${ROLE_LABELS[invitation.role].toLowerCase()}.`;

  if (invitation.status !== 'pending') {
    return (
      <AuthCard
        title="Invitation unavailable"
        description={description}
        footer={
          <Link to={session.data ? '/dashboard' : '/login'} className="font-medium text-primary hover:underline">
            {session.data ? 'Go to your dashboard' : 'Sign in'}
          </Link>
        }
      >
        <Alert>{STATUS_MESSAGES[invitation.status]}</Alert>
      </AuthCard>
    );
  }

  const signedIn = session.data ?? null;
  return (
    <AuthCard
      title={`Join ${invitation.organizationName}`}
      description={description}
      footer={
        signedIn ? (
          `The link expires on ${new Date(invitation.expiresAt).toLocaleDateString()}.`
        ) : mode === 'create' ? (
          <>
            Already have a CatalogCraft account?{' '}
            <button type="button" className="font-medium text-primary hover:underline" onClick={() => setMode('sign-in')}>
              Sign in instead
            </button>
          </>
        ) : (
          <>
            New to CatalogCraft?{' '}
            <button type="button" className="font-medium text-primary hover:underline" onClick={() => setMode('create')}>
              Create an account
            </button>
          </>
        )
      }
    >
      {signedIn ? (
        <SignedInChoice token={token} invitation={invitation} session={signedIn} onDone={done} />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm">
            Email: <span className="font-medium">{invitation.email}</span>
          </p>
          {mode === 'create' ? <CreateAccountForm token={token} onDone={done} /> : <SignInForm token={token} onDone={done} />}
        </div>
      )}
    </AuthCard>
  );
}
