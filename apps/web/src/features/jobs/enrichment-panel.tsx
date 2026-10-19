import { Loader2, ShieldCheck, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { ENRICHABLE_FIELD_KEYS, fieldLabel, LANGUAGES, type EnrichableField, type Job, type LanguageCode } from '@catalogcraft/shared';
import { errorMessage } from '@/components/page-states';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { usePermission } from '@/features/auth/use-session';
import { useClient } from '@/features/clients/use-clients';
import { useAiStatus, useStartEnrichment, useUsage } from './use-jobs';

const FIELD_HINTS: Record<EnrichableField, string> = {
  title: 'Clearer product names within the client’s length limit.',
  description: 'Plain-text descriptions written from the product facts.',
  seoTitle: 'Search-friendly page titles (max 60 characters).',
  seoDescription: 'Search result snippets (max 155 characters).',
  tags: 'Short search keywords taken from the facts.',
};

/** Settings for an AI enrichment run: which fields, which language, which rows. */
export function EnrichmentPanel({ job, onCancel }: { job: Job; onCancel?: () => void }) {
  const ai = useAiStatus();
  const client = useClient(job.client.id);
  const canSeeUsage = usePermission('usage:read');
  const usage = useUsage(canSeeUsage);
  const start = useStartEnrichment(job.id);

  const [fields, setFields] = useState<EnrichableField[]>(job.enrichment?.fields ?? ['title', 'description']);
  const [language, setLanguage] = useState<LanguageCode | undefined>(job.enrichment?.language);
  const [includeWarningRows, setIncludeWarningRows] = useState(job.enrichment?.includeWarningRows ?? true);

  const chosenLanguage = language ?? client.data?.brandProfile.defaultLanguage ?? 'en';
  const rowCount = job.counts.validRows + (includeWarningRows ? job.counts.warningRows : 0);
  const remaining = usage.data?.products.limit != null ? Math.max(0, usage.data.products.limit - usage.data.products.used - usage.data.products.reserved) : null;
  const overAllowance = remaining !== null && rowCount > remaining;

  const toggle = (field: EnrichableField) =>
    setFields((current) => (current.includes(field) ? current.filter((f) => f !== field) : [...current, field]));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" aria-hidden />
          Improve with AI
        </CardTitle>
        <CardDescription className="flex items-start gap-1.5">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          Suggestions are written only from the product facts, never change SKUs, prices, stock or other protected fields,
          and are saved for your review — nothing is changed until a person approves it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {ai.data && !ai.data.configured ? (
          <Alert variant="destructive">
            AI enrichment isn’t set up on this server yet. An administrator needs to add an AI API key (AI_API_KEY) to the API’s
            configuration.
          </Alert>
        ) : null}

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Fields to improve</legend>
          {ENRICHABLE_FIELD_KEYS.map((field) => (
            <label key={field} className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-[var(--primary)]"
                checked={fields.includes(field)}
                onChange={() => toggle(field)}
              />
              <span>
                <span className="font-medium">{fieldLabel(field)}</span>
                <span className="block text-muted-foreground">{FIELD_HINTS[field]}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="enrich-language">Language</Label>
            <Select id="enrich-language" value={chosenLanguage} onChange={(event) => setLanguage(event.target.value as LanguageCode)}>
              {LANGUAGES.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          <label className="flex items-start gap-2.5 self-end pb-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-[var(--primary)]"
              checked={includeWarningRows}
              onChange={(event) => setIncludeWarningRows(event.target.checked)}
            />
            <span>Include rows with warnings ({job.counts.warningRows.toLocaleString()})</span>
          </label>
        </div>

        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{rowCount.toLocaleString()} products</span> will be sent.{' '}
          {job.counts.failedRows > 0 ? `${job.counts.failedRows.toLocaleString()} rows with errors are left out. ` : ''}
          {remaining !== null ? `Your plan has ${remaining.toLocaleString()} products left this month.` : ''}
        </p>

        {overAllowance ? (
          <Alert variant="destructive">This is more than your plan has left this month. Leave out rows with warnings, or upgrade.</Alert>
        ) : null}
        {start.isError ? <Alert variant="destructive">{errorMessage(start.error)}</Alert> : null}

        <div className="flex flex-wrap gap-3">
          <Button
            disabled={fields.length === 0 || rowCount === 0 || start.isPending || ai.data?.configured === false || overAllowance}
            onClick={() => start.mutate({ fields, language: chosenLanguage, includeWarningRows })}
          >
            {start.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
            Generate suggestions
          </Button>
          {onCancel ? (
            <Button variant="outline" onClick={onCancel} disabled={start.isPending}>
              Cancel
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
