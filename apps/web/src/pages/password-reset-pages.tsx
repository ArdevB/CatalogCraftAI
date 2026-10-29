import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, Loader2, MailCheck, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import type { z } from 'zod';
import { forgotPasswordSchema, PASSWORD_MIN_LENGTH, PASSWORD_RESET_TTL_MINUTES, resetPasswordSchema } from '@catalogcraft/shared';
import { FormField } from '@/components/form-field';
import { errorMessage, LoadingState } from '@/components/page-states';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { applyServerFieldErrors } from '@/features/auth/apply-server-errors';
import { AuthCard } from '@/features/auth/auth-card';
import { DevEmailNote } from '@/features/auth/dev-email-note';
import { useFeatures, useForgotPassword, useResetPassword, useSession, useVerifyEmail } from '@/features/auth/use-session';

const backToSignIn = (
  <Link to="/login" className="font-medium text-primary hover:underline">
    Back to sign in
  </Link>
);

/** A big icon that pops in, for "done" and "failed" moments. */
function Outcome({ icon: Icon, tone, title, children }: { icon: typeof MailCheck; tone: string; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 py-2 text-center">
      <span className={`grid size-14 place-items-center rounded-2xl ring-1 ring-inset animate-pop ${tone}`}>
        <Icon className="size-7" aria-hidden />
      </span>
      <p className="font-medium">{title}</p>
      <div className="text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

export function ForgotPasswordPage() {
  const features = useFeatures();
  const request = useForgotPassword();
  const form = useForm<z.input<typeof forgotPasswordSchema>, unknown, z.output<typeof forgotPasswordSchema>>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });
  const onSubmit = form.handleSubmit((values) => request.mutate(values, { onError: (error) => applyServerFieldErrors(error, ['email'], form.setError) }));

  return (
    <AuthCard title="Forgot your password?" description="We’ll email you a link to choose a new one." footer={backToSignIn}>
      {features.isPending ? (
        <LoadingState />
      ) : !features.data?.email ? (
        <Alert>Password resets by email aren’t set up on this server. Ask your agency’s administrator to reset your password for you.</Alert>
      ) : request.isSuccess ? (
        <div className="flex flex-col gap-4">
          <Outcome icon={MailCheck} tone="tint-emerald" title="Check your inbox">
            If an account uses {form.getValues('email')}, we’ve sent it a link. It works once, for {PASSWORD_RESET_TTL_MINUTES} minutes. Check your spam folder
            if it doesn’t arrive in a few minutes.
          </Outcome>
          <DevEmailNote />
        </div>
      ) : (
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
          {request.isError ? <Alert variant="destructive">{errorMessage(request.error)}</Alert> : null}
          <FormField label="Email" type="email" autoComplete="email" autoFocus error={form.formState.errors.email?.message} {...form.register('email')} />
          <Button type="submit" disabled={request.isPending}>
            {request.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Email me a reset link
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

export function ResetPasswordPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const reset = useResetPassword();
  const form = useForm<z.input<typeof resetPasswordSchema>, unknown, z.output<typeof resetPasswordSchema>>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token, password: '' },
  });
  const onSubmit = form.handleSubmit((values) =>
    reset.mutate(values, {
      onSuccess: () => void navigate('/login?reset=1', { replace: true }),
      onError: (error) => applyServerFieldErrors(error, ['password'], form.setError),
    }),
  );

  return (
    <AuthCard title="Choose a new password" description="This signs you out on every other device." footer={backToSignIn}>
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        {reset.isError && !form.formState.errors.password ? (
          <Alert variant="destructive">
            {errorMessage(reset.error)}{' '}
            <Link to="/forgot-password" className="font-medium underline">
              Get a new link
            </Link>
          </Alert>
        ) : null}
        <FormField
          label="New password"
          type="password"
          autoComplete="new-password"
          autoFocus
          hint={`At least ${PASSWORD_MIN_LENGTH} characters. A short phrase works well.`}
          error={form.formState.errors.password?.message}
          {...form.register('password')}
        />
        <Button type="submit" disabled={reset.isPending}>
          {reset.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Set new password
        </Button>
      </form>
    </AuthCard>
  );
}

export function VerifyEmailPage() {
  const { token = '' } = useParams();
  const verify = useVerifyEmail(token);
  const session = useSession();
  const next = session.data ? (
    <Button asChild>
      <Link to="/dashboard">Go to your dashboard</Link>
    </Button>
  ) : (
    <Button asChild>
      <Link to="/login">Sign in</Link>
    </Button>
  );

  return (
    <AuthCard title="Confirm your email" description="One moment while we check your link." footer={backToSignIn}>
      {verify.isPending ? (
        <LoadingState label="Confirming your email address…" />
      ) : verify.isError ? (
        <Outcome icon={XCircle} tone="tint-rose" title="This link didn’t work">
          <p>{errorMessage(verify.error)}</p>
          <p className="mt-2">Signed in? You can ask for a new link from the banner at the top of the app.</p>
        </Outcome>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <Outcome icon={CheckCircle2} tone="tint-emerald" title="Email address confirmed">
            Thanks — you’re all set.
          </Outcome>
          {next}
        </div>
      )}
    </AuthCard>
  );
}
