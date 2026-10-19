import { Types } from 'mongoose';
import type { UsageSummary } from '@catalogcraft/shared';
import { planLimits } from '../../config/plans.js';
import { estimateCostUsd } from '../../services/ai/pricing.js';
import type { AiProvider } from '../../services/ai/provider.js';
import { AppError } from '../../utils/app-error.js';
import { CatalogJobModel } from '../catalog-jobs/catalog-job.model.js';
import { OrganizationModel } from '../organizations/organization.model.js';
import { UsageEventModel } from './usage-event.model.js';

/** Usage resets on the first day of each calendar month (UTC). */
export function currentPeriod(now = new Date()): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

/** Products set aside for jobs that are queued or running but not finished. */
async function reservedProducts(organizationId: Types.ObjectId): Promise<number> {
  const [result] = await CatalogJobModel.aggregate<{ reserved: number }>([
    { $match: { organizationId, status: { $in: ['queued', 'processing'] } } },
    {
      $group: {
        _id: null,
        reserved: { $sum: { $max: [0, { $subtract: ['$enrichment.totalRows', '$enrichment.processedRows'] }] } },
      },
    },
  ]);
  return result?.reserved ?? 0;
}

export async function getUsage(organizationId: string, provider: AiProvider | null, now = new Date()): Promise<UsageSummary> {
  const orgId = new Types.ObjectId(organizationId);
  const period = currentPeriod(now);
  const [organization, byModel, reserved] = await Promise.all([
    OrganizationModel.findById(orgId).select('plan').lean(),
    UsageEventModel.aggregate<{
      _id: string;
      units: number;
      requests: number;
      failed: number;
      inputTokens: number;
      outputTokens: number;
    }>([
      { $match: { organizationId: orgId, createdAt: { $gte: period.start, $lt: period.end } } },
      {
        $group: {
          _id: '$model',
          units: { $sum: '$usageUnits' },
          requests: { $sum: '$quantity' },
          failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
          inputTokens: { $sum: '$inputTokens' },
          outputTokens: { $sum: '$outputTokens' },
        },
      },
    ]),
    reservedProducts(orgId),
  ]);
  if (!organization) throw new AppError('NOT_FOUND', 'Organization not found.');

  const sum = (key: 'units' | 'requests' | 'failed' | 'inputTokens' | 'outputTokens') =>
    byModel.reduce((total, row) => total + row[key], 0);
  const costs = byModel.map((row) => estimateCostUsd(row._id, row.inputTokens, row.outputTokens));

  return {
    plan: organization.plan,
    period: { start: period.start.toISOString(), end: period.end.toISOString() },
    products: { used: sum('units'), reserved, limit: planLimits(organization.plan).maxProductsPerMonth },
    aiRequests: sum('requests'),
    failedRequests: sum('failed'),
    inputTokens: sum('inputTokens'),
    outputTokens: sum('outputTokens'),
    estimatedCostUsd: costs.some((cost) => cost === null) ? null : costs.reduce<number>((total, cost) => total + (cost ?? 0), 0),
    ai: { configured: provider !== null, model: provider?.model ?? null },
  };
}

/**
 * Refuses work that would take the organization past its monthly allowance,
 * counting what is already used and what running jobs have reserved.
 */
export async function assertProductAllowance(organizationId: string, requested: number): Promise<void> {
  const usage = await getUsage(organizationId, null);
  const { used, reserved, limit } = usage.products;
  if (limit === null) return;
  const remaining = Math.max(0, limit - used - reserved);
  if (requested > remaining) {
    throw new AppError(
      'PLAN_LIMIT_REACHED',
      `This needs ${requested.toLocaleString('en')} product${requested === 1 ? '' : 's'}, but your plan has ${remaining.toLocaleString('en')} of ${limit.toLocaleString('en')} left this month` +
        (reserved > 0 ? ` (${reserved.toLocaleString('en')} reserved by running jobs)` : '') +
        '. Choose fewer rows, wait for next month, or upgrade.',
    );
  }
}
