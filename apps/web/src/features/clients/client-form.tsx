import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { z } from 'zod';
import {
  brandProfileSchema,
  clientNameSchema,
  internalReferenceSchema,
  LANGUAGES,
  TITLE_LENGTH_MAX,
  TITLE_LENGTH_MIN,
  type Client,
} from '@catalogcraft/shared';
import { FormField, SelectField, TextareaField } from '@/components/form-field';
import { errorMessage } from '@/components/page-states';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { applyServerFieldErrors } from '@/features/auth/apply-server-errors';
import { IdCard, Palette, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { linesToList } from '@/lib/utils';

function SectionTitle({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <CardTitle className="flex items-center gap-2.5">
      <span className="grid size-8 place-items-center rounded-lg tint-indigo ring-1 ring-inset">
        <Icon className="size-4" aria-hidden />
      </span>
      {children}
    </CardTitle>
  );
}

const brand = brandProfileSchema.shape;

/** Form-shaped version of the shared client schema (lists edited as text). */
const clientFormSchema = z.object({
  name: clientNameSchema,
  internalReference: internalReferenceSchema,
  defaultLanguage: brand.defaultLanguage,
  maxTitleLength: brand.maxTitleLength,
  brandTone: brand.brandTone,
  targetAudience: brand.targetAudience,
  preferredTerminology: z.string().transform(linesToList).pipe(brand.preferredTerminology),
  prohibitedClaims: z.string().transform(linesToList).pipe(brand.prohibitedClaims),
});

type ClientFormInput = z.input<typeof clientFormSchema>;
export type ClientFormValues = z.output<typeof clientFormSchema>;

const FIELDS = [
  'name',
  'internalReference',
  'defaultLanguage',
  'maxTitleLength',
  'brandTone',
  'targetAudience',
  'preferredTerminology',
  'prohibitedClaims',
] as const;

/** `body.brandProfile.prohibitedClaims.3` → `prohibitedClaims` */
const apiPathToField = (path: string) => path.replace(/^body\.(brandProfile\.)?/, '').split('.')[0] ?? path;

function toFormDefaults(client?: Client): ClientFormInput {
  return {
    name: client?.name ?? '',
    internalReference: client?.internalReference ?? '',
    defaultLanguage: client?.brandProfile.defaultLanguage ?? 'en',
    maxTitleLength: client?.brandProfile.maxTitleLength ?? 150,
    brandTone: client?.brandProfile.brandTone ?? '',
    targetAudience: client?.brandProfile.targetAudience ?? '',
    preferredTerminology: client?.brandProfile.preferredTerminology.join('\n') ?? '',
    prohibitedClaims: client?.brandProfile.prohibitedClaims.join('\n') ?? '',
  };
}

export function ClientForm({
  client,
  submitLabel,
  pendingLabel,
  cancelTo,
  onSubmit,
}: {
  client?: Client;
  submitLabel: string;
  pendingLabel: string;
  cancelTo: string;
  /** Should reject with the API error on failure, so it can be shown here. */
  onSubmit: (values: ClientFormValues) => Promise<unknown>;
}) {
  const form = useForm<ClientFormInput, unknown, ClientFormValues>({
    resolver: zodResolver(clientFormSchema),
    defaultValues: toFormDefaults(client),
  });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    try {
      await onSubmit(values);
    } catch (error) {
      applyServerFieldErrors(error, FIELDS, form.setError, apiPathToField);
      form.setError('root.server', { message: errorMessage(error) });
    }
  });

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-6">
      {errors.root?.server ? <Alert variant="destructive">{errors.root.server.message}</Alert> : null}

      <Card className="animate-rise" style={{ animationDelay: '60ms' }}>
        <CardHeader>
          <SectionTitle icon={IdCard}>Client details</SectionTitle>
          <CardDescription>How your team identifies this client.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField label="Client name" autoFocus error={errors.name?.message} {...form.register('name')} />
          <FormField
            label="Internal reference (optional)"
            hint="E.g. your CRM or contract number."
            error={errors.internalReference?.message}
            {...form.register('internalReference')}
          />
        </CardContent>
      </Card>

      <Card className="animate-rise" style={{ animationDelay: '120ms' }}>
        <CardHeader>
          <SectionTitle icon={Palette}>Brand profile</SectionTitle>
          <CardDescription>
            AI suggestions for this client follow these rules. They never add facts that aren’t in the product data.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Default language"
            error={errors.defaultLanguage?.message}
            {...form.register('defaultLanguage')}
          >
            {LANGUAGES.map((language) => (
              <option key={language.code} value={language.code}>
                {language.label}
              </option>
            ))}
          </SelectField>
          <FormField
            label="Maximum title length"
            type="number"
            inputMode="numeric"
            min={TITLE_LENGTH_MIN}
            max={TITLE_LENGTH_MAX}
            hint={`Characters, ${TITLE_LENGTH_MIN}–${TITLE_LENGTH_MAX}.`}
            error={errors.maxTitleLength?.message}
            {...form.register('maxTitleLength', { valueAsNumber: true })}
          />
          <TextareaField
            label="Brand tone"
            placeholder="E.g. warm, practical, no hype"
            error={errors.brandTone?.message}
            {...form.register('brandTone')}
          />
          <TextareaField
            label="Target audience"
            placeholder="E.g. home cooks furnishing a first kitchen"
            error={errors.targetAudience?.message}
            {...form.register('targetAudience')}
          />
          <TextareaField
            label="Preferred terminology"
            hint="One per line."
            placeholder={'sofa (not couch)\nstoneware'}
            error={errors.preferredTerminology?.message}
            {...form.register('preferredTerminology')}
          />
          <TextareaField
            label="Prohibited claims"
            hint="One per line. The AI must never use these."
            placeholder={'eco-friendly\nbest in class'}
            error={errors.prohibitedClaims?.message}
            {...form.register('prohibitedClaims')}
          />
        </CardContent>
      </Card>

      {/* Stays in reach at the bottom of the screen while the form scrolls. */}
      <div className="sticky bottom-4 z-10 flex gap-3 rounded-xl border bg-card/85 p-3 shadow-lg backdrop-blur-md animate-rise" style={{ animationDelay: '180ms' }}>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {isSubmitting ? pendingLabel : submitLabel}
        </Button>
        <Button asChild variant="outline">
          <Link to={cancelTo}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
