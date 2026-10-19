import type { Types } from 'mongoose';
import type { FileStorage } from '../../services/storage/storage.js';
import { ExportModel } from './export.model.js';

/** Removes a job's exports and their files (used when the job is deleted). */
export async function deleteJobExports(storage: FileStorage, jobId: Types.ObjectId, organizationId: Types.ObjectId): Promise<void> {
  const exports = await ExportModel.find({ jobId, organizationId }).select('storageKey').lean();
  await Promise.all(exports.map((item) => storage.delete(item.storageKey)));
  await ExportModel.deleteMany({ jobId, organizationId });
}
