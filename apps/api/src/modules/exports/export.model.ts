import { model, Schema, type InferSchemaType } from 'mongoose';

/**
 * One generated CSV file. The file itself lives in private storage under a
 * generated key; it is only ever served through the authorised download route.
 */
const exportSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    jobId: { type: Schema.Types.ObjectId, ref: 'CatalogJob', required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    storageKey: { type: String, required: true },
    filename: { type: String, required: true, maxlength: 200 },
    rowCount: { type: Number, required: true },
    columnCount: { type: Number, required: true },
    changedCells: { type: Number, required: true },
    sizeBytes: { type: Number, required: true },
    checksum: { type: String, required: true },
    /** The options used, so the export can be explained later. */
    settings: { type: Schema.Types.Mixed, required: true },
    downloadCount: { type: Number, default: 0 },
    lastDownloadedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false },
);

exportSchema.index({ organizationId: 1, jobId: 1, createdAt: -1 });
exportSchema.index({ organizationId: 1, createdAt: -1 });

export type Export = InferSchemaType<typeof exportSchema>;
export const ExportModel = model('Export', exportSchema);
