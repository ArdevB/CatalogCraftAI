import { model, Schema, type InferSchemaType } from 'mongoose';

export const USER_STATUSES = ['active', 'disabled'] as const;

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    /**
     * Argon2id hash — never the password itself. `select: false` means normal
     * queries never load it; only the login check asks for it explicitly.
     */
    passwordHash: { type: String, required: true, select: false },
    status: { type: String, enum: USER_STATUSES, required: true, default: 'active' },
    lastLoginAt: { type: Date },
    /** Increased whenever the password changes; sessions from before the change stop working. */
    authVersion: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

userSchema.index({ email: 1 }, { unique: true });

export type User = InferSchemaType<typeof userSchema>;
export const UserModel = model('User', userSchema);
