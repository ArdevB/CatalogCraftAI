import { model, Schema, type InferSchemaType } from 'mongoose';
import { ASSIGNABLE_ROLES } from '@catalogcraft/shared';

/**
 * An invitation to join an organization. Only a SHA-256 hash of the token is
 * stored, so someone who reads the database still can't use the links.
 */
const invitationSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    role: { type: String, enum: ASSIGNABLE_ROLES, required: true },
    tokenHash: { type: String, required: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date, default: null },
    acceptedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

invitationSchema.index({ tokenHash: 1 }, { unique: true });
invitationSchema.index({ organizationId: 1, email: 1, createdAt: -1 });
// MongoDB deletes invitations by itself 30 days after they expire (used or not): no stale tokens or emails linger.
invitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export type Invitation = InferSchemaType<typeof invitationSchema>;
export const InvitationModel = model('Invitation', invitationSchema);
