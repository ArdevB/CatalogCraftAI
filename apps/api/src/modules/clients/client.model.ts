import { model, Schema, type InferSchemaType } from 'mongoose';
import { DEFAULT_BRAND_PROFILE, LANGUAGES, TITLE_LENGTH_MAX, TITLE_LENGTH_MIN } from '@catalogcraft/shared';

/**
 * Brand rules the AI must follow for this client. Stored inside the client
 * document because it is small and always read together with the client.
 */
const brandProfileSchema = new Schema(
  {
    brandTone: { type: String, default: DEFAULT_BRAND_PROFILE.brandTone, maxlength: 500 },
    targetAudience: { type: String, default: DEFAULT_BRAND_PROFILE.targetAudience, maxlength: 500 },
    preferredTerminology: { type: [String], default: [] },
    prohibitedClaims: { type: [String], default: [] },
    defaultLanguage: {
      type: String,
      enum: LANGUAGES.map((language) => language.code),
      default: DEFAULT_BRAND_PROFILE.defaultLanguage,
    },
    maxTitleLength: {
      type: Number,
      min: TITLE_LENGTH_MIN,
      max: TITLE_LENGTH_MAX,
      default: DEFAULT_BRAND_PROFILE.maxTitleLength,
    },
  },
  { _id: false },
);

const clientSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    internalReference: { type: String, trim: true, maxlength: 60 },
    brandProfile: { type: brandProfileSchema, required: true, default: () => ({}) },
  },
  { timestamps: true },
);

/** Same collation everywhere names are compared: case-insensitive ("ACME" = "acme"). */
export const CLIENT_NAME_COLLATION = { locale: 'en', strength: 2 } as const;

// Client names are unique within an organization, ignoring letter case.
clientSchema.index({ organizationId: 1, name: 1 }, { unique: true, collation: CLIENT_NAME_COLLATION });
// "Recently updated clients" on the dashboard.
clientSchema.index({ organizationId: 1, updatedAt: -1 });

export type Client = InferSchemaType<typeof clientSchema>;
export const ClientModel = model('Client', clientSchema);
