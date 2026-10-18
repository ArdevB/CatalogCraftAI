import type { PlanId } from '@catalogcraft/shared';

/** Display names only. Limits come from the API so they are never duplicated here. */
export const PLAN_LABELS: Record<PlanId, string> = {
  trial: 'Free trial',
  solo: 'Solo',
  agency: 'Agency',
  studio: 'Studio',
};
