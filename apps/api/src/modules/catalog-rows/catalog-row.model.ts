import { model, Schema, type InferSchemaType } from 'mongoose';
import { ISSUE_SEVERITIES, ISSUE_TYPES, ROW_STATUSES } from '@catalogcraft/shared';

const validationIssueSchema = new Schema(
  {
    field: { type: String, required: true },
    type: { type: String, enum: ISSUE_TYPES, required: true },
    severity: { type: String, enum: ISSUE_SEVERITIES, required: true },
    message: { type: String, required: true },
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
  },
  { timestamps: true, minimize: false },
);

catalogRowSchema.index({ jobId: 1, rowNumber: 1 }, { unique: true });
catalogRowSchema.index({ organizationId: 1, jobId: 1, status: 1, rowNumber: 1 });
catalogRowSchema.index({ jobId: 1, sourceIdentifier: 1 });

export type CatalogRow = InferSchemaType<typeof catalogRowSchema>;
export const CatalogRowModel = model('CatalogRow', catalogRowSchema);
