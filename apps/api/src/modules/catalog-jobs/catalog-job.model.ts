import { model, Schema, type InferSchemaType } from 'mongoose';
import { ENRICHABLE_FIELD_KEYS, ISSUE_SEVERITIES, ISSUE_TYPES, JOB_STATUSES } from '@catalogcraft/shared';

/** The uploaded source file. `storageKey` is server-generated; the user's filename is display-only. */
const originalFileSchema = new Schema(
  {
    storageKey: { type: String, required: true },
    filename: { type: String, required: true, maxlength: 255 },
    contentType: { type: String, required: true },
    fileType: { type: String, enum: ['csv', 'xlsx'], required: true },
    sizeBytes: { type: Number, required: true },
    checksum: { type: String, required: true },
    sheets: { type: [String], default: [] },
    uploadedAt: { type: Date, required: true },
  },
  { _id: false },
);

const importConfigSchema = new Schema(
  {
    sheetName: { type: String, default: null },
    headerRow: { type: Number, required: true, min: 1 },
    /** Standard field → column index. Validated with the shared Zod schema before saving. */
    mapping: { type: Schema.Types.Mixed, required: true },
    headers: { type: [String], default: [] },
  },
  { _id: false, minimize: false },
);

const issueSummarySchema = new Schema(
  {
    field: { type: String, required: true },
    type: { type: String, enum: ISSUE_TYPES, required: true },
    severity: { type: String, enum: ISSUE_SEVERITIES, required: true },
    count: { type: Number, required: true },
    example: { type: String, required: true },
  },
  { _id: false },
);

const countsSchema = new Schema(
  {
    totalRows: { type: Number, default: 0 },
    validRows: { type: Number, default: 0 },
    warningRows: { type: Number, default: 0 },
    failedRows: { type: Number, default: 0 },
    skippedEmptyRows: { type: Number, default: 0 },
  },
  { _id: false },
);

/** Settings and progress of the AI enrichment run (one at a time per job). */
const enrichmentSchema = new Schema(
  {
    fields: { type: [String], enum: ENRICHABLE_FIELD_KEYS, required: true },
    language: { type: String, required: true },
    includeWarningRows: { type: Boolean, required: true },
    model: { type: String, required: true },
    promptVersion: { type: String, required: true },
    totalRows: { type: Number, default: 0 },
    processedRows: { type: Number, default: 0 },
    succeededRows: { type: Number, default: 0 },
    failedRows: { type: Number, default: 0 },
    /** False until every selected row is marked, so the worker never starts on a half-prepared job. */
    rowsPrepared: { type: Boolean, default: false },
    cancelRequested: { type: Boolean, default: false },
    /** While a worker holds the job; if it crashes, the lease expires and another run resumes. */
    leaseExpiresAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
  },
  { _id: false },
);

const catalogJobSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    status: { type: String, enum: JOB_STATUSES, required: true, default: 'draft' },
    originalFile: { type: originalFileSchema, default: null },
    importConfig: { type: importConfigSchema, default: null },
    counts: { type: countsSchema, default: () => ({}) },
    issueSummary: { type: [issueSummarySchema], default: [] },
    lastError: { type: String, default: null, maxlength: 1000 },
    enrichment: { type: enrichmentSchema, default: null },
  },
  { timestamps: true },
);

catalogJobSchema.index({ organizationId: 1, createdAt: -1 });
catalogJobSchema.index({ organizationId: 1, clientId: 1, createdAt: -1 });
catalogJobSchema.index({ organizationId: 1, status: 1 });
// The worker looks for queued jobs and for processing jobs whose lease expired.
catalogJobSchema.index({ status: 1, updatedAt: 1 });

export type CatalogJob = InferSchemaType<typeof catalogJobSchema>;
export const CatalogJobModel = model('CatalogJob', catalogJobSchema);
