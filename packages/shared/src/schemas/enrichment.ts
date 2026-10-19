import { z } from 'zod';
import { languageCodeSchema } from './language.js';

/**
 * The only fields AI may write suggestions for. Identifiers, prices, stock,
 * barcodes, measurements and URLs are deliberately absent: there is no way to
 * even ask the AI to change them. (A test keeps this list in sync with the
 * `enrichable` flags in STANDARD_FIELDS.)
 */
export const ENRICHABLE_FIELD_KEYS = ['title', 'description', 'seoTitle', 'seoDescription', 'tags'] as const;
export const enrichableFieldSchema = z.enum(ENRICHABLE_FIELD_KEYS);
export type EnrichableField = z.infer<typeof enrichableFieldSchema>;

export const startEnrichmentSchema = z.object({
  fields: z
    .array(enrichableFieldSchema)
    .min(1, 'Choose at least one field to improve.')
    .transform((fields) => [...new Set(fields)]),
  /** Defaults to the client's brand-profile language. */
  language: languageCodeSchema.optional(),
  /** Rows with errors are never sent; rows with only warnings are, unless turned off. */
  includeWarningRows: z.boolean().default(true),
});
export type StartEnrichmentInput = z.input<typeof startEnrichmentSchema>;

export const SUGGESTION_STATUSES = ['pending', 'approved', 'rejected', 'edited', 'failed'] as const;
export const suggestionStatusSchema = z.enum(SUGGESTION_STATUSES);
export type SuggestionStatus = z.infer<typeof suggestionStatusSchema>;

export const suggestionSchema = z.object({
  field: enrichableFieldSchema,
  /** The AI's text. Tags are a comma-separated list. */
  value: z.string(),
  status: suggestionStatusSchema,
  /** Things a reviewer should check (e.g. a number not found in the source data). */
  warnings: z.array(z.string()),
  model: z.string(),
  promptVersion: z.string(),
  generatedAt: z.iso.datetime(),
  /** The reviewer's own text when status is `edited` (the AI's `value` is kept for comparison). */
  editedValue: z.string().nullable(),
  reviewedAt: z.iso.datetime().nullable(),
});
export type Suggestion = z.infer<typeof suggestionSchema>;

/** How many suggestions in a job are in each review state. */
export const reviewSummarySchema = z.object({
  pending: z.number().int(),
  approved: z.number().int(),
  edited: z.number().int(),
  rejected: z.number().int(),
  failed: z.number().int(),
  /** Pending suggestions without warnings — what "approve all eligible" would approve. */
  eligibleForBulkApproval: z.number().int(),
});
export type ReviewSummary = z.infer<typeof reviewSummarySchema>;

export const ROW_ENRICHMENT_STATUSES = ['queued', 'done', 'failed', 'skipped'] as const;
export const rowEnrichmentSchema = z.object({
  status: z.enum(ROW_ENRICHMENT_STATUSES),
  error: z.string().nullable(),
  /** Facts the AI said it would need for better copy — never filled in automatically. */
  missingFacts: z.array(z.string()),
  /** The AI's own notes for the reviewer (e.g. "no material given, kept the description general"). */
  notes: z.array(z.string()),
});
export type RowEnrichment = z.infer<typeof rowEnrichmentSchema>;

export const jobEnrichmentSchema = z.object({
  fields: z.array(enrichableFieldSchema),
  language: languageCodeSchema,
  includeWarningRows: z.boolean(),
  model: z.string(),
  promptVersion: z.string(),
  totalRows: z.number().int(),
  processedRows: z.number().int(),
  succeededRows: z.number().int(),
  failedRows: z.number().int(),
  cancelRequested: z.boolean(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
});
export type JobEnrichment = z.infer<typeof jobEnrichmentSchema>;

/* ------------------------------------------------------------------ Usage */

export const usageSummarySchema = z.object({
  plan: z.string(),
  period: z.object({ start: z.iso.datetime(), end: z.iso.datetime() }),
  products: z.object({
    /** Products successfully enriched this period (the billable unit). */
    used: z.number().int(),
    /** Set aside for jobs that are queued or running. */
    reserved: z.number().int(),
    limit: z.number().int().nullable(),
  }),
  aiRequests: z.number().int(),
  failedRequests: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  /** Estimate from public list prices; `null` when the model's price is unknown. */
  estimatedCostUsd: z.number().nullable(),
  ai: z.object({ configured: z.boolean(), model: z.string().nullable() }),
});
export type UsageSummary = z.infer<typeof usageSummarySchema>;
