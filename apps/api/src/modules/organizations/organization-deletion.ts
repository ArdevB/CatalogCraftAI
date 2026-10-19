import { Types } from 'mongoose';
import type { JobStatus } from '@catalogcraft/shared';
import type { AuthContext } from '../../middleware/require-auth.js';
import type { FileStorage } from '../../services/storage/storage.js';
import { AppError } from '../../utils/app-error.js';
import { AuditLogModel } from '../audit/audit-log.model.js';
import { CatalogJobModel } from '../catalog-jobs/catalog-job.model.js';
import { CatalogRowModel } from '../catalog-rows/catalog-row.model.js';
import { ClientModel } from '../clients/client.model.js';
import { ExportModel } from '../exports/export.model.js';
import { MembershipModel } from '../memberships/membership.model.js';
import { InvitationModel } from '../team/invitation.model.js';
import { UsageEventModel } from '../usage/usage-event.model.js';
import { OrganizationModel } from './organization.model.js';

/** Jobs in these states are being worked on in the background right now. */
const RUNNING: JobStatus[] = ['queued', 'processing', 'validating', 'exporting'];

/**
 * Permanently deletes an organization and everything that belongs to it:
 * clients, jobs, product rows, uploaded and exported files, invitations,
 * usage records, the audit log and every membership. User accounts are kept
 * (people may belong to other organizations); members simply lose access on
 * their next request.
 *
 * The organization record goes first, so a failure halfway leaves no usable
 * half-deleted organization — the rest is removed by organizationId and is safe
 * to retry.
 */
export async function deleteOrganization(storage: FileStorage, auth: AuthContext, confirmName: string): Promise<void> {
  const organizationId = new Types.ObjectId(auth.organizationId);
  const organization = await OrganizationModel.findById(organizationId).select('name').lean();
  if (!organization) throw new AppError('NOT_FOUND', 'Organization not found.');
  if (confirmName.trim() !== organization.name) {
    throw new AppError('VALIDATION_ERROR', 'The name you typed doesn’t match the organization name.', {
      details: [{ path: 'body.confirmName', message: `Type “${organization.name}” exactly to confirm.` }],
    });
  }
  if (await CatalogJobModel.exists({ organizationId, status: { $in: RUNNING } })) {
    throw new AppError('CONFLICT', 'A job is still running. Cancel it or wait for it to finish, then try again.');
  }

  const [jobs, exports] = await Promise.all([
    CatalogJobModel.find({ organizationId }).select('originalFile.storageKey').lean(),
    ExportModel.find({ organizationId }).select('storageKey').lean(),
  ]);
  const fileKeys = [...jobs.flatMap((job) => (job.originalFile ? [job.originalFile.storageKey] : [])), ...exports.map((item) => item.storageKey)];

  await OrganizationModel.deleteOne({ _id: organizationId });
  await MembershipModel.deleteMany({ organizationId });
  await Promise.all(fileKeys.map((key) => storage.delete(key)));
  await Promise.all([
    CatalogRowModel.deleteMany({ organizationId }),
    CatalogJobModel.deleteMany({ organizationId }),
    ExportModel.deleteMany({ organizationId }),
    ClientModel.deleteMany({ organizationId }),
    InvitationModel.deleteMany({ organizationId }),
    UsageEventModel.deleteMany({ organizationId }),
    AuditLogModel.deleteMany({ organizationId }),
  ]);
}
