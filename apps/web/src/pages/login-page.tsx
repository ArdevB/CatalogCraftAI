import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { z } from 'zod';
import { loginSchema } from '@catalogcraft/shared';
import { FormField } from '@/components/form-field';
import { errorMessage } from '@/components/page-states';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { applyServerFieldErrors } from '@/features/auth/apply-server-errors';
import { AuthCard } from '@/features/auth/auth-card';
import { safeRedirectPath } from '@/features/auth/route-guards';
import { useLogin } from '@/features/auth/use-session';

type LoginForm = z.input<typeof loginSchema>;

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const login = useLogin();
  const form = useForm<LoginForm, unknown, z.output<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit((values) =>
    login.mutate(values, {
      onSuccess: () => void navigate(safeRedirectPath(searchParams.get('next')), { replace: true }),
      onError: (error) => applyServerFieldErrors(error, ['email', 'password'], form.setError),
    }),
  );

  return (
    <AuthCard
      title="Sign in"
      description="Welcome back to CatalogCraft AI."
      footer={
        <>
          New to CatalogCraft?{' '}
          <Link to="/register" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        {login.isError && login.error ? <Alert variant="destructive">{errorMessage(login.error)}</Alert> : null}
        <FormField
          label="Email"
          type="email"
          autoComplete="email"
          autoFocus
          error={errors.email?.message}
          {...form.register('email')}
        />
        <FormField
          label="Password"
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...form.register('password')}
        />
        <Button type="submit" disabled={login.isPending} className="mt-2">
          {login.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthCard>
  );
}
