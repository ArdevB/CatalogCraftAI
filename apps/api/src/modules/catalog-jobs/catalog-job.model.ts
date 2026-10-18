import { model, Schema, type InferSchemaType } from 'mongoose';
import { ISSUE_SEVERITIES, ISSUE_TYPES, JOB_STATUSES } from '@catalogcraft/shared';

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
  },
  { timestamps: true },
);

catalogJobSchema.index({ organizationId: 1, createdAt: -1 });
catalogJobSchema.index({ organizationId: 1, clientId: 1, createdAt: -1 });
catalogJobSchema.index({ organizationId: 1, status: 1 });

export type CatalogJob = InferSchemaType<typeof catalogJobSchema>;
export const CatalogJobModel = model('CatalogJob', catalogJobSchema);
