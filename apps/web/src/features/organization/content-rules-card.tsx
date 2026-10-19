import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { contentRulesSchema } from '@catalogcraft/shared';
import { TextareaField } from '@/components/form-field';
import { errorMessage } from '@/components/page-states';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { applyServerFieldErrors } from '@/features/auth/apply-server-errors';
import { usePermission, useRequiredSession } from '@/features/auth/use-session';
import { linesToList } from '@/lib/utils';
import { useUpdateOrganization } from './use-organization';

const formSchema = z.object({
  prohibitedClaims: z.string().transform(linesToList).pipe(contentRulesSchema.shape.prohibitedClaims),
});

/** Agency-wide rules, added to every client's brand profile. */
export function ContentRulesCard() {
  const { organization } = useRequiredSession();
  const canEdit = usePermission('organization:update');
  const update = useUpdateOrganization();
  const claims = organization.contentRules.prohibitedClaims;
  const form = useForm<z.input<typeof formSchema>, unknown, z.output<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    values: { prohibitedClaims: claims.join('\n') },
  });

  const onSubmit = form.handleSubmit((values) =>
    update.mutate(
      { contentRules: values },
      {
        onSuccess: (updated) => form.reset({ prohibitedClaims: updated.contentRules.prohibitedClaims.join('\n') }),
        onError: (error) => applyServerFieldErrors(error, ['prohibitedClaims'], form.setError, () => 'prohibitedClaims'),
      },
    ),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Content rules</CardTitle>
        <CardDescription>
          Words and claims never allowed for any client — for example “guaranteed”, “cures” or “#1”. Each client’s brand profile can add more.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {canEdit ? (
          <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3">
            {update.isError ? <Alert variant="destructive">{errorMessage(update.error)}</Alert> : null}
            {update.isSuccess && !form.formState.isDirty ? (
              <Alert variant="success">
                <CheckCircle2 aria-hidden />
                Content rules saved. They apply to new AI suggestions and reviewer edits.
              </Alert>
            ) : null}
            <TextareaField
              label="Prohibited claims"
              hint="One per line. AI suggestions that use one are blocked, and reviewers can’t type them either."
              rows={5}
              error={form.formState.errors.prohibitedClaims?.message}
              {...form.register('prohibitedClaims')}
            />
            <div>
              <Button type="submit" disabled={update.isPending || !form.formState.isDirty}>
                {update.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Save rules
              </Button>
            </div>
          </form>
        ) : claims.length === 0 ? (
          <p className="text-sm text-muted-foreground">No agency-wide rules yet. Owners and admins can add them.</p>
        ) : (
          <ul className="flex flex-wrap gap-2 text-sm">
            {claims.map((claim) => (
              <li key={claim} className="rounded-md border px-2 py-0.5">
                {claim}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
