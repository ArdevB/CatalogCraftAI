import { fieldLabel, type BrandProfile, type EnrichableField, type ProductValues } from '@catalogcraft/shared';
import { checkSuggestion, type CheckedSuggestion } from './guardrails.js';
import { buildUserMessage, outputSchema, PROMPT_VERSION, selectFacts, SYSTEM_PROMPT } from './prompts/product-enrichment.js';
import type { AiProvider, AiUsage } from './provider.js';

export type SuggestionDraft = CheckedSuggestion & {
  field: EnrichableField;
  model: string;
  promptVersion: string;
  generatedAt: Date;
};

export type EnrichProductResult = {
  /** `done` when at least one usable (non-failed) suggestion was produced. */
  outcome: 'done' | 'failed';
  suggestions: SuggestionDraft[];
  missingFacts: string[];
  notes: string[];
  error: string | null;
  model: string;
  usage: AiUsage;
};

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim()) : [];
}

/**
 * Generates suggestions for one product: builds the prompt from the allowed
 * facts, calls the provider, validates the answer and runs the guardrails.
 *
 * Provider failures (network, bad key…) are thrown as `AiProviderError` so the
 * worker can decide whether to keep going. Bad answers are returned as a
 * `failed` outcome — malformed output is never saved as a suggestion.
 */
export async function enrichProduct(
  provider: AiProvider,
  input: { original: ProductValues; fields: EnrichableField[]; language: string; brandProfile: BrandProfile },
): Promise<EnrichProductResult> {
  const { facts, shortened } = selectFacts(input.original);
  const result = await provider.generateJson({
    system: SYSTEM_PROMPT,
    user: buildUserMessage({ facts, fields: input.fields, language: input.language, brandProfile: input.brandProfile }),
    schema: outputSchema(input.fields),
  });

  const base = { model: result.model, usage: result.usage };
  if (!result.ok) {
    return { ...base, outcome: 'failed', suggestions: [], missingFacts: [], notes: [], error: result.message };
  }

  const data = result.data as Record<string, unknown>;
  const sourceText = Object.values(facts).join('\n');
  const generatedAt = new Date();
  const suggestions: SuggestionDraft[] = [];
  for (const field of input.fields) {
    const raw = data[field];
    // The schema requires every requested field; this guards against anything unexpected.
    if (typeof raw !== 'string' && !Array.isArray(raw)) continue;
    const value = Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : raw;
    suggestions.push({
      field,
      model: result.model,
      promptVersion: PROMPT_VERSION,
      generatedAt,
      ...checkSuggestion({ field, value, original: input.original[field], sourceText, brandProfile: input.brandProfile }),
    });
  }

  const notes = stringList(data.warnings);
  if (shortened.length > 0) {
    notes.push(`${shortened.map(fieldLabel).join(', ')} ${shortened.length === 1 ? 'was' : 'were'} shortened before sending because the text was very long.`);
  }
  const usable = suggestions.some((suggestion) => suggestion.status !== 'failed');
  return {
    ...base,
    outcome: usable ? 'done' : 'failed',
    suggestions,
    missingFacts: stringList(data.missingFacts),
    notes,
    error: usable ? null : (suggestions[0]?.warnings[0] ?? 'The AI did not return any usable suggestions.'),
  };
}
