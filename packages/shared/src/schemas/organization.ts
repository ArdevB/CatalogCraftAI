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

export const organizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  plan: planIdSchema,
  subscriptionStatus: subscriptionStatusSchema,
  createdAt: z.iso.datetime(),
});
export type Organization = z.infer<typeof organizationSchema>;

export const updateOrganizationSchema = z.object({
  name: organizationNameSchema,
});
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

export const memberSchema = z.object({
  membershipId: z.string(),
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  role: roleSchema,
  joinedAt: z.iso.datetime(),
});
export type Member = z.infer<typeof memberSchema>;
