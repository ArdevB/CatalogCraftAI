import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import type { z } from 'zod';
import { PASSWORD_MIN_LENGTH, registerSchema } from '@catalogcraft/shared';
import { FormField } from '@/components/form-field';
import { errorMessage } from '@/components/page-states';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { applyServerFieldErrors } from '@/features/auth/apply-server-errors';
import { AuthCard } from '@/features/auth/auth-card';
import { useRegister } from '@/features/auth/use-session';

type RegisterForm = z.input<typeof registerSchema>;
const FIELDS = ['name', 'email', 'password', 'organizationName'] as const;

export function RegisterPage() {
  const navigate = useNavigate();
  const register = useRegister();
  const form = useForm<RegisterForm, unknown, z.output<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '', organizationName: '' },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit((values) =>
    register.mutate(values, {
      onSuccess: () => void navigate('/dashboard', { replace: true }),
      onError: (error) => applyServerFieldErrors(error, FIELDS, form.setError),
    }),
  );

  return (
    <AuthCard
      title="Create your agency account"
      description="You’ll be the owner of a new organization. You can invite your team later."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        {register.isError && register.error ? (
          <Alert variant="destructive">{errorMessage(register.error)}</Alert>
        ) : null}
        <FormField
          label="Your name"
          autoComplete="name"
          autoFocus
          error={errors.name?.message}
          {...form.register('name')}
        />
        <FormField
          label="Work email"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...form.register('email')}
        />
        <FormField
          label="Password"
          type="password"
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN_LENGTH} characters. A short phrase works well.`}
          error={errors.password?.message}
          {...form.register('password')}
        />
        <FormField
          label="Agency / organization name"
          autoComplete="organization"
          error={errors.organizationName?.message}
          {...form.register('organizationName')}
        />
        <Button type="submit" disabled={register.isPending} className="mt-2">
          {register.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {register.isPending ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthCard>
  );
}
