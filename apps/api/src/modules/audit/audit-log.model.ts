import { model, Schema, type InferSchemaType } from 'mongoose';
import { AUDIT_ACTIONS } from '@catalogcraft/shared';

/**
 * Append-only record of who changed what. It deliberately stores ids, field
 * names and counts — never product text — so the log can't leak catalogue
 * content and stays small.
 */
const auditLogSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    actorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', default: null },
    jobId: { type: Schema.Types.ObjectId, ref: 'CatalogJob', default: null },
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    /** The row, export, … the action applied to. */
    entityId: { type: Schema.Types.ObjectId, default: null },
    field: { type: String, default: null },
    rowNumber: { type: Number, default: null },
    /** For bulk actions: how many suggestions changed. */
    count: { type: Number, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ organizationId: 1, jobId: 1, createdAt: -1 });

export type AuditLog = InferSchemaType<typeof auditLogSchema>;
export const AuditLogModel = model('AuditLog', auditLogSchema);
