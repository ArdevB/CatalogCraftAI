import { model, Schema, type InferSchemaType } from 'mongoose';

/**
 * One record per AI request — an append-only ledger. Usage is always computed
 * from these events, so it can be audited and never drifts from reality.
 *
 * `usageUnits` is the billable amount: 1 when a product was successfully
 * enriched, 0 when the request failed (failures never consume the allowance).
 */
const usageEventSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    jobId: { type: Schema.Types.ObjectId, ref: 'CatalogJob', required: true },
    rowId: { type: Schema.Types.ObjectId, ref: 'CatalogRow', required: true },
    eventType: { type: String, enum: ['ai_request'], required: true },
    status: { type: String, enum: ['succeeded', 'failed'], required: true },
    quantity: { type: Number, required: true, default: 1 },
    usageUnits: { type: Number, required: true, min: 0 },
    model: { type: String, required: true },
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

usageEventSchema.index({ organizationId: 1, createdAt: -1 });
usageEventSchema.index({ jobId: 1 });

export type UsageEvent = InferSchemaType<typeof usageEventSchema>;
export const UsageEventModel = model('UsageEvent', usageEventSchema);
