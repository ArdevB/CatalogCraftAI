import { z } from 'zod';
import { objectIdSchema } from './common.js';
import { standardFieldSchema } from './catalog.js';
import { enrichableFieldSchema } from './enrichment.js';

/* ----------------------------------------------------------------- Review */

export const REVIEW_TEXT_MAX = 5_000;

/**
 * One reviewer decision on one suggestion.
 * - approve: use the AI's text in the export
 * - edit: use the reviewer's own text instead (`value`)
 * - reject: keep the original value
 * - reset: back to pending (undo)
 */
export const reviewActionSchema = z
  .object({
    field: enrichableFieldSchema,
    action: z.enum(['approve', 'reject', 'edit', 'reset']),
    value: z.string().trim().min(1, 'Enter the text to use.').max(REVIEW_TEXT_MAX, `Keep it under ${REVIEW_TEXT_MAX} characters.`).optional(),
  })
  .refine((input) => input.action !== 'edit' || input.value !== undefined, {
    error: 'Enter the text to use.',
    path: ['value'],
  });
export type ReviewActionInput = z.input<typeof reviewActionSchema>;

/**
 * Bulk approve/reject. Without `rowIds` it applies to the whole job.
 * Bulk approval only ever touches pending suggestions with no warnings;
 * anything a guardrail flagged must be looked at individually.
 */
export const bulkReviewSchema = z.object({
  rowIds: z.array(objectIdSchema).min(1).max(500).optional(),
  fields: z.array(enrichableFieldSchema).min(1).optional(),
});
export type BulkReviewInput = z.input<typeof bulkReviewSchema>;

export const bulkReviewResultSchema = z.object({ updated: z.number().int() });

/* ----------------------------------------------------------------- Export */

export const exportRequestSchema = z.object({
  /** Standard fields to include. Mapped ones keep their column; others are added at the end. */
  fields: z.array(standardFieldSchema).min(1, 'Choose at least one field to export.'),
  /** Also include the supplier's columns that were not mapped, unchanged. */
  includeUnmappedColumns: z.boolean().default(true),
  /** Rows with validation errors are left out unless this is set. */
  includeErrorRows: z.boolean().default(false),
});
export type ExportRequestInput = z.input<typeof exportRequestSchema>;

export const exportSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  filename: z.string(),
  rowCount: z.number().int(),
  columnCount: z.number().int(),
  /** How many cells use an approved or edited AI suggestion. */
  changedCells: z.number().int(),
  sizeBytes: z.number().int(),
  createdBy: z.object({ id: z.string(), name: z.string() }),
  createdAt: z.iso.datetime(),
  downloadCount: z.number().int(),
});
export type ExportRecord = z.infer<typeof exportSchema>;

/* ------------------------------------------------------------------ Audit */

export const AUDIT_ACTIONS = [
  'suggestion.approved',
  'suggestion.rejected',
  'suggestion.edited',
  'suggestion.reset',
  'suggestions.bulk_approved',
  'suggestions.bulk_rejected',
  'export.created',
  'export.downloaded',
] as const;
export const auditActionSchema = z.enum(AUDIT_ACTIONS);
export type AuditAction = z.infer<typeof auditActionSchema>;

/** Who did what, when — never the product content itself. */
export const auditEntrySchema = z.object({
  id: z.string(),
  action: auditActionSchema,
  actor: z.object({ id: z.string(), name: z.string() }),
  rowNumber: z.number().int().nullable(),
  field: z.string().nullable(),
  count: z.number().int().nullable(),
  createdAt: z.iso.datetime(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;
