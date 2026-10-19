import { z } from 'zod';
import { roleSchema } from './roles.js';

/**
 * Plan identifiers only. Prices and limits are experimental and live in the
 * API's plan configuration, not here, so they can change without touching
 * stored data.
 */
export const PLAN_IDS = ['trial', 'solo', 'agency', 'studio'] as const;
export const planIdSchema = z.enum(PLAN_IDS);
export type PlanId = z.infer<typeof planIdSchema>;

export const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'canceled'] as const;
export const subscriptionStatusSchema = z.enum(SUBSCRIPTION_STATUSES);
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

export const organizationNameSchema = z
  .string()
  .trim()
  .min(2, 'Organization name must be at least 2 characters.')
  .max(100, 'Organization name must be at most 100 characters.');

/** One per line in the UI; matched without regard to letter case. */
const ruleListSchema = z
  .array(z.string().trim().min(1, 'Entries cannot be empty.').max(200, 'Entries must be at most 200 characters.'))
  .max(100, 'Add at most 100 entries.');

/**
 * Agency-wide content rules that apply to every client, on top of each
 * client's own brand profile (e.g. claims the agency never makes for anyone).
 */
export const contentRulesSchema = z.object({
  prohibitedClaims: ruleListSchema,
});
export type ContentRules = z.infer<typeof contentRulesSchema>;

export const organizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  plan: planIdSchema,
  subscriptionStatus: subscriptionStatusSchema,
  contentRules: contentRulesSchema,
  createdAt: z.iso.datetime(),
});
export type Organization = z.infer<typeof organizationSchema>;

export const updateOrganizationSchema = z
  .object({
    name: organizationNameSchema.optional(),
    contentRules: contentRulesSchema.optional(),
  })
  .refine((input) => input.name !== undefined || input.contentRules !== undefined, { error: 'Nothing to update.' });
export type UpdateOrganizationInput = z.input<typeof updateOrganizationSchema>;

export const memberSchema = z.object({
  membershipId: z.string(),
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  role: roleSchema,
  joinedAt: z.iso.datetime(),
});
export type Member = z.infer<typeof memberSchema>;
