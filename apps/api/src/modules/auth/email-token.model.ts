import { model, Schema, type InferSchemaType } from 'mongoose';

export const EMAIL_TOKEN_PURPOSES = ['verify-email', 'reset-password'] as const;

/**
 * A one-time link sent by email. Only the token's hash is stored. MongoDB
 * deletes the record by itself once it has expired.
 */
const emailTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    purpose: { type: String, enum: EMAIL_TOKEN_PURPOSES, required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

emailTokenSchema.index({ tokenHash: 1 }, { unique: true });
emailTokenSchema.index({ userId: 1, purpose: 1 });
emailTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type EmailToken = InferSchemaType<typeof emailTokenSchema>;
export const EmailTokenModel = model('EmailToken', emailTokenSchema);
