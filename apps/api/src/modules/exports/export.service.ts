import type { Types } from 'mongoose';
import type { z } from 'zod';
import { stringify } from 'csv-stringify/sync';
import { columnMappingSchema, statusesThatCanBecome, type ExportRecord, type exportRequestSchema, type JobStatus } from '@catalogcraft/shared';
import type { AuthContext } from '../../middleware/require-auth.js';
import { buildExport } from '../../services/export/build-export.js';
import { checksum, newExportKey, type FileStorage } from '../../services/storage/storage.js';
import { AppError } from '../../utils/app-error.js';
import { tenantScope } from '../../utils/tenant.js';
import { UserModel } from '../auth/user.model.js';
import { recordAudit } from '../audit/audit.service.js';
import { CatalogJobModel } from '../catalog-jobs/catalog-job.model.js';
import { getJob } from '../catalog-jobs/catalog-job.service.js';
import { CatalogRowModel } from '../catalog-rows/catalog-row.model.js';
import { ClientModel } from '../clients/client.model.js';
import { ExportModel, type Export } from './export.model.js';

type ExportOptions = z.output<typeof exportRequestSchema>;
type ExportDoc = Export & { _id: Types.ObjectId };

/** "Spring catalogue / Kitchen Co!" → "spring-catalogue-kitchen-co" */
function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'export'
  );
}

export async function toExportDtos(exports: ExportDoc[]): Promise<ExportRecord[]> {
  const users = await UserModel.find({ _id: { $in: exports.map((item) => item.createdBy) } }).select('name').lean();
  const names = new Map(users.map((user) => [user._id.toString(), user.name]));
  return exports.map((item) => ({
    id: item._id.toString(),
    jobId: item.jobId.toString(),
    filename: item.filename,
    rowCount: item.rowCount,
    columnCount: item.columnCount,
    changedCells: item.changedCells,
    sizeBytes: item.sizeBytes,
    createdBy: { id: item.createdBy.toString(), name: names.get(item.createdBy.toString()) ?? 'Former member' },
    createdAt: item.createdAt.toISOString(),
    downloadCount: item.downloadCount,
  }));
}

/**
 * Generates a CSV for a job and stores it privately.
 *
 * The job moves to `exporting` while the file is built (so it can't be
 * re-imported or enriched at the same moment) and to `completed` afterwards.
 * If anything fails, it returns to the state it was in.
 */
export async function createExport(storage: FileStorage, auth: AuthContext, jobId: string, options: ExportOptions): Promise<ExportDoc> {
  const job = await getJob(auth, jobId);
  if (!job.importConfig || job.counts.totalRows === 0) {
    throw new AppError('CONFLICT', 'Validate the file before exporting.');
  }
  const previous = job.status as JobStatus;
  const locked = await CatalogJobModel.findOneAndUpdate(
    { _id: job._id, ...tenantScope(auth), status: { $in: statusesThatCanBecome('exporting') } },
    { $set: { status: 'exporting' } },
    { returnDocument: 'after' },
  ).lean();
  if (!locked) throw new AppError('CONFLICT', 'This job can’t be exported right now. Wait for any running work to finish.');

  let storageKey: string | null = null;
  try {
    const rows = await CatalogRowModel.find({ jobId: job._id, ...tenantScope(auth) })
      .select('rowNumber status sourceValues suggestions')
      .lean();
    const built = buildExport({
      headers: [...job.importConfig.headers],
      mapping: columnMappingSchema.parse(job.importConfig.mapping),
      rows: rows.map((row) => ({
        rowNumber: row.rowNumber,
        status: row.status,
        sourceValues: [...row.sourceValues],
        suggestions: row.suggestions.map((s) => ({ field: s.field, status: s.status, value: s.value, editedValue: s.editedValue })),
      })),
      options,
    });
    if (built.header.length === 0) throw new AppError('VALIDATION_ERROR', 'The chosen options leave no columns to export.');
    if (built.records.length === 0) throw new AppError('CONFLICT', 'There are no rows to export with these options.');

    // A byte-order mark makes Excel read the file as UTF-8 (accents, £, €).
    const data = Buffer.from(stringify([built.header, ...built.records], { bom: true }), 'utf8');
    storageKey = newExportKey(auth.organizationId);
    await storage.put(storageKey, data);

    const client = await ClientModel.findOne({ _id: job.clientId, ...tenantScope(auth) }).select('name').lean();
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const record = await ExportModel.create({
      ...tenantScope(auth),
      clientId: job.clientId,
      jobId: job._id,
      createdBy: auth.userId,
      storageKey,
      filename: `${slug(client?.name ?? 'client')}-${slug(job.name)}-${stamp}.csv`,
      rowCount: built.records.length,
      columnCount: built.header.length,
      changedCells: built.changedCells,
      sizeBytes: data.length,
      checksum: checksum(data),
      settings: options,
    });

    await recordAudit(auth, { action: 'export.created', clientId: job.clientId, jobId: job._id, entityId: record._id, count: built.records.length });
    await CatalogJobModel.updateOne({ _id: job._id, status: 'exporting' }, { $set: { status: 'completed', lastError: null } });
    return record.toObject();
  } catch (error) {
    if (storageKey) await storage.delete(storageKey).catch(() => undefined);
    await CatalogJobModel.updateOne({ _id: job._id, status: 'exporting' }, { $set: { status: previous } });
    throw error;
  }
}

export async function listJobExports(auth: AuthContext, jobId: string): Promise<ExportRecord[]> {
  const job = await getJob(auth, jobId);
  const exports = await ExportModel.find({ jobId: job._id, ...tenantScope(auth) }).sort({ createdAt: -1 }).limit(50).lean();
  return toExportDtos(exports);
}

export async function getExport(auth: AuthContext, exportId: string): Promise<ExportDoc> {
  const record = await ExportModel.findOne({ _id: exportId, ...tenantScope(auth) }).lean();
  if (!record) throw new AppError('NOT_FOUND', 'Export not found.');
  return record;
}

/** Reads an export's file for download — only after confirming it belongs to the caller's organization. */
export async function downloadExport(storage: FileStorage, auth: AuthContext, exportId: string): Promise<{ record: ExportDoc; data: Buffer }> {
  const record = await getExport(auth, exportId);
  let data: Buffer;
  try {
    data = await storage.get(record.storageKey);
  } catch (error) {
    throw new AppError('NOT_FOUND', 'The export file is no longer available. Create a new export.', { cause: error });
  }
  await ExportModel.updateOne({ _id: record._id }, { $inc: { downloadCount: 1 }, $set: { lastDownloadedAt: new Date() } });
  await recordAudit(auth, { action: 'export.downloaded', clientId: record.clientId, jobId: record.jobId, entityId: record._id });
  return { record, data };
}
