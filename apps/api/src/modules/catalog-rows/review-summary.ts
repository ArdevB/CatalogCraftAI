import type { Types } from 'mongoose';
import type { ReviewSummary, SuggestionStatus } from '@catalogcraft/shared';
import { CatalogRowModel } from './catalog-row.model.js';

/** Suggestion counts by review state for one job (used on the job page). */
export async function reviewSummary(jobId: Types.ObjectId, organizationId: Types.ObjectId): Promise<ReviewSummary | null> {
  const groups = await CatalogRowModel.aggregate<{ _id: SuggestionStatus; count: number; eligible: number }>([
    { $match: { jobId, organizationId } },
    { $unwind: '$suggestions' },
    {
      $group: {
        _id: '$suggestions.status',
        count: { $sum: 1 },
        eligible: {
          $sum: {
            $cond: [
              { $and: [{ $ne: ['$suggestions.blocked', true] }, { $eq: [{ $size: { $ifNull: ['$suggestions.warnings', []] } }, 0] }] },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);
  if (groups.length === 0) return null;
  const count = (status: SuggestionStatus) => groups.find((group) => group._id === status)?.count ?? 0;
  return {
    pending: count('pending'),
    approved: count('approved'),
    edited: count('edited'),
    rejected: count('rejected'),
    failed: count('failed'),
    eligibleForBulkApproval: groups.find((group) => group._id === 'pending')?.eligible ?? 0,
  };
}
