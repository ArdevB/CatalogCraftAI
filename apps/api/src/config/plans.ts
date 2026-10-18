import type { PlanId } from '@catalogcraft/shared';

/**
 * Plan definitions — the ONLY place plan prices and limits live. Prices are
 * experimental (see the product spec), so change them here, not across the
 * codebase. Organizations store just their plan id.
 *
 * `null` means unlimited.
 *
 * Enforced today: `maxClientWorkspaces`.
 * Defined for upcoming milestones (not enforced yet): products per month,
 * users and active jobs.
 *
 * Assumptions where the spec is silent: "multiple client workspaces" is listed
 * as an Agency feature, so Trial and Solo allow one; Trial allows one user.
 *
 * There is no payment integration. For pilot customers, change a plan with:
 *   npm run set-plan -- <owner-email> <trial|solo|agency|studio>
 */
export type PlanDefinition = {
  label: string;
  monthlyPriceUsd: number | null;
  limits: {
    maxClientWorkspaces: number | null;
    maxProductsPerMonth: number;
    maxUsers: number | null;
    maxActiveJobs: number | null;
  };
};

export const PLANS: Readonly<Record<PlanId, PlanDefinition>> = {
  trial: {
    label: 'Free trial',
    monthlyPriceUsd: null,
    limits: { maxClientWorkspaces: 1, maxProductsPerMonth: 25, maxUsers: 1, maxActiveJobs: 1 },
  },
  solo: {
    label: 'Solo',
    monthlyPriceUsd: 19,
    limits: { maxClientWorkspaces: 1, maxProductsPerMonth: 500, maxUsers: 1, maxActiveJobs: null },
  },
  agency: {
    label: 'Agency',
    monthlyPriceUsd: 49,
    limits: { maxClientWorkspaces: null, maxProductsPerMonth: 2_500, maxUsers: 3, maxActiveJobs: null },
  },
  studio: {
    label: 'Studio',
    monthlyPriceUsd: 99,
    limits: { maxClientWorkspaces: null, maxProductsPerMonth: 7_500, maxUsers: 10, maxActiveJobs: null },
  },
};

export function planLimits(plan: PlanId): PlanDefinition['limits'] {
  return PLANS[plan].limits;
}
