import { z } from 'zod';
import { objectIdSchema, paginationMetaSchema, paginationQuerySchema } from './common.js';
import { jobEnrichmentSchema, ROW_ENRICHMENT_STATUSES, rowEnrichmentSchema, suggestionSchema } from './enrichment.js';

/* -------------------------------------------------------------------------- */
/* Standard product fields                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The fields a supplier spreadsheet's columns can be mapped onto.
 *
 * `protected` fields are facts (identifiers, prices, stock, measurements…).
 * AI must never change them and exports always keep their original values.
 * `enrichable` fields are the ones AI may suggest improvements for.
 */
export const STANDARD_FIELDS = [
  { key: 'sku', label: 'SKU', protected: true, enrichable: false },
  { key: 'productId', label: 'Product ID', protected: true, enrichable: false },
  { key: 'title', label: 'Title', protected: false, enrichable: true },
  { key: 'description', label: 'Description', protected: false, enrichable: true },
  { key: 'brand', label: 'Brand', protected: false, enrichable: false },
  { key: 'productType', label: 'Product type', protected: false, enrichable: false },
  { key: 'category', label: 'Category', protected: false, enrichable: false },
  { key: 'material', label: 'Material', protected: false, enrichable: false },
  { key: 'colour', label: 'Colour', protected: false, enrichable: false },
  { key: 'size', label: 'Size', protected: false, enrichable: false },
  { key: 'dimensions', label: 'Dimensions', protected: true, enrichable: false },
  { key: 'weight', label: 'Weight', protected: true, enrichable: false },
  { key: 'price', label: 'Price', protected: true, enrichable: false },
  { key: 'currency', label: 'Currency', protected: true, enrichable: false },
  { key: 'stockQuantity', label: 'Stock quantity', protected: true, enrichable: false },
  { key: 'barcode', label: 'Barcode', protected: true, enrichable: false },
  { key: 'tags', label: 'Tags', protected: false, enrichable: true },
  { key: 'seoTitle', label: 'SEO title', protected: false, enrichable: true },
  { key: 'seoDescription', label: 'SEO description', protected: false, enrichable: true },
  { key: 'imageUrl', label: 'Image URL', protected: true, enrichable: false },
  { key: 'variantId', label: 'Variant ID', protected: true, enrichable: false },
  { key: 'parentId', label: 'Parent product ID', protected: true, enrichable: false },
] as const;

export type StandardField = (typeof STANDARD_FIELDS)[number]['key'];
const FIELD_KEYS = STANDARD_FIELDS.map((field) => field.key) as [StandardField, ...StandardField[]];
export const standardFieldSchema = z.enum(FIELD_KEYS);

export const PROTECTED_FIELDS: readonly StandardField[] = STANDARD_FIELDS.filter((f) => f.protected).map((f) => f.key);
export const ENRICHABLE_FIELDS: readonly StandardField[] = STANDARD_FIELDS.filter((f) => f.enrichable).map((f) => f.key);

export function isProtectedField(field: string): boolean {
  return (PROTECTED_FIELDS as readonly string[]).includes(field);
}

export function fieldLabel(field: string): string {
  return STANDARD_FIELDS.find((f) => f.key === field)?.label ?? field;
}

/** Product values keyed by standard field. Missing key = column not mapped. */
export const productValuesSchema = z.partialRecord(standardFieldSchema, z.string());
export type ProductValues = z.infer<typeof productValuesSchema>;

/* -------------------------------------------------------------------------- */
/* Job lifecycle                                                              */
/* -------------------------------------------------------------------------- */

export const JOB_STATUSES = [
  'draft', // created, no file yet
  'uploaded', // file stored; mapping can be chosen
  'validating', // rows being imported and checked
  'ready', // rows imported and validated
  'queued', // waiting for AI enrichment
  'processing', // AI enrichment running
  'review', // suggestions waiting for human review
  'exporting', // export file being generated
  'completed',
  'failed',
] as const;
export const jobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof jobStatusSchema>;

/**
 * Every allowed status change. Anything not listed is rejected by the API,
 * so a job can never, e.g., jump from "draft" to "completed".
 */
export const JOB_TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  draft: ['uploaded'],
  uploaded: ['uploaded', 'validating'],
  validating: ['ready', 'failed'],
  ready: ['uploaded', 'validating', 'queued'],
  // ready/review: cancelled before the worker started (review if earlier suggestions exist).
  queued: ['processing', 'ready', 'review'],
  // ready: enrichment cancelled before anything succeeded.
  processing: ['review', 'failed', 'ready'],
  // queued: enrich more fields (or remaining rows) after reviewing.
  review: ['queued', 'exporting', 'completed'],
  exporting: ['review', 'completed', 'failed'],
  completed: ['exporting'],
  // queued: retry an enrichment that stopped (e.g. the AI service was unavailable).
  failed: ['uploaded', 'validating', 'queued'],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return JOB_TRANSITIONS[from].includes(to);
}

/** Statuses from which a job can move to `to`. */
export function statusesThatCanBecome(to: JobStatus): JobStatus[] {
  return JOB_STATUSES.filter((from) => canTransition(from, to));
}

/** "Active" jobs count towards a plan's active-job limit. */
export const FINISHED_JOB_STATUSES: readonly JobStatus[] = ['completed', 'failed'];

/* -------------------------------------------------------------------------- */
/* Validation issues                                                          */
/* -------------------------------------------------------------------------- */

export const ISSUE_TYPES = ['missing', 'invalid', 'duplicate', 'inconsistent', 'ambiguous'] as const;
export const ISSUE_SEVERITIES = ['info', 'warning', 'error'] as const;

export const validationIssueSchema = z.object({
  /** A standard field key, or `row` / `mapping` for issues not tied to one field. */
  field: z.string(),
  type: z.enum(ISSUE_TYPES),
  severity: z.enum(ISSUE_SEVERITIES),
  message: z.string(),
});
export type ValidationIssue = z.infer<typeof validationIssueSchema>;
export type IssueSeverity = ValidationIssue['severity'];

/** Rows are `error` if any issue is an error, `warning` if any is a warning, else `valid`. */
export const ROW_STATUSES = ['valid', 'warning', 'error'] as const;
export const rowStatusSchema = z.enum(ROW_STATUSES);
export type RowStatus = z.infer<typeof rowStatusSchema>;

export const issueSummarySchema = z.object({
  field: z.string(),
  type: z.enum(ISSUE_TYPES),
  severity: z.enum(ISSUE_SEVERITIES),
  count: z.number().int().min(1),
  /** One representative message, e.g. "Price “abc” is not a valid number." */
  example: z.string(),
});
export type IssueSummary = z.infer<typeof issueSummarySchema>;

/* -------------------------------------------------------------------------- */
/* Import configuration                                                       */
/* -------------------------------------------------------------------------- */

export const HEADER_ROW_MAX = 50;
export const headerRowSchema = z.coerce
  .number()
  .int('Header row must be a whole number.')
  .min(1, 'Header row must be at least 1.')
  .max(HEADER_ROW_MAX, `Header row must be at most ${HEADER_ROW_MAX}.`);

/** Standard field → zero-based column index in the chosen sheet. */
export const columnMappingSchema = z.partialRecord(standardFieldSchema, z.number().int().min(0));
export type ColumnMapping = z.infer<typeof columnMappingSchema>;

export const previewRequestSchema = z.object({
  sheetName: z.string().max(200).optional(),
  headerRow: headerRowSchema.optional(),
});
export type PreviewRequest = z.infer<typeof previewRequestSchema>;

export const saveMappingSchema = z.object({
  sheetName: z.string().max(200).nullable(),
  headerRow: headerRowSchema,
  mapping: columnMappingSchema,
});
export type SaveMappingInput = z.input<typeof saveMappingSchema>;

export const importConfigSchema = z.object({
  sheetName: z.string().nullable(),
  headerRow: z.number().int(),
  mapping: columnMappingSchema,
  /** Column names at the time of mapping, so reports can show them. */
  headers: z.array(z.string()),
});
export type ImportConfig = z.infer<typeof importConfigSchema>;

export const previewSchema = z.object({
  fileType: z.enum(['csv', 'xlsx']),
  sheets: z.array(z.string()),
  sheetName: z.string().nullable(),
  headerRow: z.number().int(),
  headers: z.array(z.string()),
  sampleRows: z.array(z.object({ rowNumber: z.number().int(), values: z.array(z.string()) })),
  totalDataRows: z.number().int().min(0),
  skippedEmptyRows: z.number().int().min(0),
  maxRows: z.number().int(),
  exceedsRowLimit: z.boolean(),
  suggestedMapping: columnMappingSchema,
  /** E.g. "The file is not UTF-8; it was read as Windows-1252." */
  notices: z.array(z.string()),
});
export type Preview = z.infer<typeof previewSchema>;

/* -------------------------------------------------------------------------- */
/* Jobs                                                                       */
/* -------------------------------------------------------------------------- */

export const jobNameSchema = z.string().trim().min(1, 'Enter a job name.').max(120, 'Job name must be at most 120 characters.');

export const createJobSchema = z.object({
  clientId: objectIdSchema,
  name: jobNameSchema.optional(),
});
export type CreateJobInput = z.input<typeof createJobSchema>;

export const jobFileSchema = z.object({
  filename: z.string(),
  fileType: z.enum(['csv', 'xlsx']),
  sizeBytes: z.number().int(),
  sheets: z.array(z.string()),
  uploadedAt: z.iso.datetime(),
});

export const jobCountsSchema = z.object({
  totalRows: z.number().int(),
  validRows: z.number().int(),
  warningRows: z.number().int(),
  failedRows: z.number().int(),
  skippedEmptyRows: z.number().int(),
});
export type JobCounts = z.infer<typeof jobCountsSchema>;

export const jobSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: jobStatusSchema,
  client: z.object({ id: z.string(), name: z.string() }),
  createdBy: z.object({ id: z.string(), name: z.string() }),
  file: jobFileSchema.nullable(),
  importConfig: importConfigSchema.nullable(),
  counts: jobCountsSchema,
  issueSummary: z.array(issueSummarySchema),
  /** Why the job failed, in words the user can act on. */
  lastError: z.string().nullable(),
  enrichment: jobEnrichmentSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Job = z.infer<typeof jobSchema>;

export const jobListQuerySchema = paginationQuerySchema.extend({
  clientId: objectIdSchema.optional(),
  status: jobStatusSchema.optional(),
});
export type JobListQuery = z.infer<typeof jobListQuerySchema>;

export const jobListSchema = z.object({
  items: z.array(jobSchema.omit({ importConfig: true, issueSummary: true })),
  pagination: paginationMetaSchema,
});
export type JobList = z.infer<typeof jobListSchema>;
export type JobListItem = JobList['items'][number];

/* -------------------------------------------------------------------------- */
/* Rows                                                                       */
/* -------------------------------------------------------------------------- */

export const catalogRowSchema = z.object({
  id: z.string(),
  /** Row number in the original spreadsheet (as the user sees it in Excel). */
  rowNumber: z.number().int(),
  sourceIdentifier: z.string().nullable(),
  status: rowStatusSchema,
  original: productValuesSchema,
  issues: z.array(validationIssueSchema),
  /** AI suggestions, stored separately from the immutable original values. */
  suggestions: z.array(suggestionSchema),
  enrichment: rowEnrichmentSchema.nullable(),
});
export type CatalogRow = z.infer<typeof catalogRowSchema>;

export const rowListQuerySchema = paginationQuerySchema.extend({
  status: rowStatusSchema.optional(),
  field: z.string().max(40).optional(),
  search: z.string().trim().max(100).optional(),
  enrichment: z.enum(ROW_ENRICHMENT_STATUSES).optional(),
});
export type RowListQuery = z.infer<typeof rowListQuerySchema>;

export const rowListSchema = z.object({
  items: z.array(catalogRowSchema),
  pagination: paginationMetaSchema,
});
export type RowList = z.infer<typeof rowListSchema>;
