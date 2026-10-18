import { model, Schema, type InferSchemaType } from 'mongoose';
import { PLAN_IDS, SUBSCRIPTION_STATUSES } from '@catalogcraft/shared';

const organizationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** Plan limits are looked up from configuration by this id, never stored here. */
    plan: { type: String, enum: PLAN_IDS, required: true, default: 'trial' },
    subscriptionStatus: { type: String, enum: SUBSCRIPTION_STATUSES, required: true, default: 'trialing' },
  },
  { timestamps: true },
);

organizationSchema.index({ ownerUserId: 1 });

export type Organization = InferSchemaType<typeof organizationSchema>;
export const OrganizationModel = model('Organization', organizationSchema);
