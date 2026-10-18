import { model, Schema, type InferSchemaType, type Types } from 'mongoose';
import { ROLES } from '@catalogcraft/shared';

/**
 * Links a user to an organization with a role. This collection — not anything
 * the browser sends — is the source of truth for "may this user touch this
 * organization's data?".
 */
const membershipSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ROLES, required: true },
  },
  { timestamps: true },
);

// A user can hold only one role per organization.
membershipSchema.index({ organizationId: 1, userId: 1 }, { unique: true });
// "Which organizations does this user belong to?" (used at login).
membershipSchema.index({ userId: 1, createdAt: 1 });

export type Membership = InferSchemaType<typeof membershipSchema>;
export const MembershipModel = model('Membership', membershipSchema);

/** The organization a user lands in after signing in: the one they joined first. */
export function findDefaultMembership(userId: string | Types.ObjectId) {
  return MembershipModel.findOne({ userId }).sort({ createdAt: 1 }).lean();
}
