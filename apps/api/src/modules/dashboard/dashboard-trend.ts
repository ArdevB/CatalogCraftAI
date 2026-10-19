import { Types } from 'mongoose';
import { DASHBOARD_TREND_DAYS, type DashboardSummary, type JobStatus } from '@catalogcraft/shared';
import { CatalogJobModel } from '../catalog-jobs/catalog-job.model.js';
import { CatalogRowModel } from '../catalog-rows/catalog-row.model.js';
import { ExportModel } from '../exports/export.model.js';
import { UsageEventModel } from '../usage/usage-event.model.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The last `count` calendar days in `timeZone`, oldest first, as YYYY-MM-DD.
 * Days are stepped on the calendar (not by subtracting 24 h from "now"), so
 * daylight-saving changes can't skip or repeat a day.
 */
export function lastDays(timeZone: string, count: number, now = new Date()): string[] {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const todayUtc = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => new Date(todayUtc - (count - 1 - i) * DAY_MS).toISOString().slice(0, 10));
}

/** Per-day counts keyed by the local date in `timeZone`. */
async function countByDay(
  model: typeof UsageEventModel | typeof ExportModel,
  match: Record<string, unknown>,
  value: string | 1,
  timeZone: string,
): Promise<Map<string, number>> {
  const rows = await (model as typeof UsageEventModel).aggregate<{ _id: string; total: number }>([
    { $match: match },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: timeZone } }, total: { $sum: value } } },
  ]);
  return new Map(rows.map((row) => [row._id, row.total]));
}

/** Chart data for the dashboard: daily activity, jobs per status and suggestions awaiting review. */
export async function dashboardInsights(
  organizationId: string,
  timeZone: string,
  now = new Date(),
): Promise<Pick<DashboardSummary, 'trend' | 'jobsByStatus' | 'pendingSuggestions'>> {
  const orgId = new Types.ObjectId(organizationId);
  const days = lastDays(timeZone, DASHBOARD_TREND_DAYS, now);
  // One extra day either side covers any time-zone offset; days outside the list are ignored.
  const since = new Date(Date.parse(`${days[0]}T00:00:00Z`) - DAY_MS);

  const [enriched, exported, statuses, pending] = await Promise.all([
    countByDay(UsageEventModel, { organizationId: orgId, createdAt: { $gte: since }, status: 'succeeded' }, '$usageUnits', timeZone),
    countByDay(ExportModel, { organizationId: orgId, createdAt: { $gte: since } }, 1, timeZone),
    CatalogJobModel.aggregate<{ _id: JobStatus; count: number }>([
      { $match: { organizationId: orgId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    CatalogRowModel.aggregate<{ total: number }>([
      { $match: { organizationId: orgId, 'suggestions.status': 'pending' } },
      { $project: { pending: { $size: { $filter: { input: '$suggestions', cond: { $eq: ['$$this.status', 'pending'] } } } } } },
      { $group: { _id: null, total: { $sum: '$pending' } } },
    ]),
  ]);

  return {
    trend: days.map((date) => ({ date, productsEnriched: enriched.get(date) ?? 0, exports: exported.get(date) ?? 0 })),
    jobsByStatus: Object.fromEntries(statuses.map((row) => [row._id, row.count])),
    pendingSuggestions: pending[0]?.total ?? 0,
  };
}
