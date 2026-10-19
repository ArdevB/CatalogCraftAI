import { model, Schema, type InferSchemaType } from 'mongoose';
import {
  ENRICHABLE_FIELD_KEYS,
  ISSUE_SEVERITIES,
  ISSUE_TYPES,
  ROW_ENRICHMENT_STATUSES,
  ROW_STATUSES,
  SUGGESTION_STATUSES,
} from '@catalogcraft/shared';

const validationIssueSchema = new Schema(
  {
    field: { type: String, required: true },
    type: { type: String, enum: ISSUE_TYPES, required: true },
    severity: { type: String, enum: ISSUE_SEVERITIES, required: true },
    message: { type: String, required: true },
  },
  { _id: false },
);

/** An AI suggestion for one field. Never stored in `original`. */
const suggestionSchema = new Schema(
  {
    field: { type: String, enum: ENRICHABLE_FIELD_KEYS, required: true },
    value: { type: String, required: true, maxlength: 10_000 },
    status: { type: String, enum: SUGGESTION_STATUSES, required: true },
    warnings: { type: [String], default: [] },
    model: { type: String, required: true },
    promptVersion: { type: String, required: true },
    generatedAt: { type: Date, required: true },
    /** Set when a guardrail rejected the AI text (e.g. a prohibited claim). Blocked text can never be approved as-is. */
    blocked: { type: Boolean, default: false },
    /** The reviewer's own text when status is `edited`. */
    editedValue: { type: String, default: null, maxlength: 5_000 },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: false },
);

const rowEnrichmentSchema = new Schema(
  {
    status: { type: String, enum: ROW_ENRICHMENT_STATUSES, required: true },
    error: { type: String, default: null },
    missingFacts: { type: [String], default: [] },
    notes: { type: [String], default: [] },
  },
  { _id: false },
);

/**
 * One product row from an imported file — its own document, so a 2,000-row
 * catalogue is 2,000 small documents rather than one huge one.
 *
 * `sourceValues` and `original` are `immutable`: once imported they can never
 * be changed. AI suggestions and approved values (next phases) are stored in
 * separate fields, so the supplier's data is always available for comparison.
 */
const catalogRowSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    jobId: { type: Schema.Types.ObjectId, ref: 'CatalogJob', required: true },
    /** Row number in the source spreadsheet. */
    rowNumber: { type: Number, required: true, immutable: true },
    /** Every cell of the row exactly as read from the file, in column order. */
    sourceValues: { type: [String], required: true, immutable: true },
    /** Mapped standard fields (trimmed). */
    original: { type: Schema.Types.Mixed, required: true, immutable: true },
    sourceIdentifier: { type: String, default: null },
    status: { type: String, enum: ROW_STATUSES, required: true },
    validationIssues: { type: [validationIssueSchema], default: [] },
    suggestions: { type: [suggestionSchema], default: [] },
    enrichment: { type: rowEnrichmentSchema, default: null },
  },
  { timestamps: true, minimize: false },
);

catalogRowSchema.index({ jobId: 1, rowNumber: 1 }, { unique: true });
catalogRowSchema.index({ organizationId: 1, jobId: 1, status: 1, rowNumber: 1 });
catalogRowSchema.index({ jobId: 1, sourceIdentifier: 1 });
// The enrichment worker fetches the next queued rows of a job in order.
catalogRowSchema.index({ jobId: 1, 'enrichment.status': 1, rowNumber: 1 });

export type CatalogRow = InferSchemaType<typeof catalogRowSchema>;
export const CatalogRowModel = model('CatalogRow', catalogRowSchema);
