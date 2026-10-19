import { Types } from 'mongoose';
import type { AuditAction, AuditEntry } from '@catalogcraft/shared';
import type { AuthContext } from '../../middleware/require-auth.js';
import { tenantScope } from '../../utils/tenant.js';
import { UserModel } from '../auth/user.model.js';
import { AuditLogModel } from './audit-log.model.js';

type AuditInput = {
  action: AuditAction;
  clientId?: Types.ObjectId | string | null;
  jobId?: Types.ObjectId | string | null;
  entityId?: Types.ObjectId | string | null;
  field?: string | null;
  rowNumber?: number | null;
  count?: number | null;
};

export async function recordAudit(auth: AuthContext, entry: AuditInput): Promise<void> {
  await AuditLogModel.create({ ...tenantScope(auth), actorUserId: auth.userId, ...entry });
}

/** The most recent activity on one job, newest first. */
export async function listJobActivity(auth: AuthContext, jobId: string, limit = 50): Promise<AuditEntry[]> {
  const entries = await AuditLogModel.find({ ...tenantScope(auth), jobId: new Types.ObjectId(jobId) })
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit)
    .lean();
  const users = await UserModel.find({ _id: { $in: entries.map((entry) => entry.actorUserId) } })
    .select('name')
    .lean();
  const names = new Map(users.map((user) => [user._id.toString(), user.name]));
  return entries.map((entry) => ({
    id: entry._id.toString(),
    action: entry.action,
    actor: { id: entry.actorUserId.toString(), name: names.get(entry.actorUserId.toString()) ?? 'Former member' },
    rowNumber: entry.rowNumber ?? null,
    field: entry.field ?? null,
    count: entry.count ?? null,
    createdAt: entry.createdAt.toISOString(),
  }));
}
