import { Types } from 'mongoose';
import type { z } from 'zod';
import type { bulkReviewSchema, reviewActionSchema, SuggestionStatus } from '@catalogcraft/shared';
import type { AuthContext } from '../../middleware/require-auth.js';
import { AppError } from '../../utils/app-error.js';
import { tenantScope } from '../../utils/tenant.js';
import { recordAudit } from '../audit/audit.service.js';
import { getJob } from '../catalog-jobs/catalog-job.service.js';
import { CatalogRowModel } from '../catalog-rows/catalog-row.model.js';
import { effectiveBrandProfile } from '../organizations/content-rules.js';

type ReviewAction = z.output<typeof reviewActionSchema>;
type BulkReview = z.output<typeof bulkReviewSchema>;

/** Reviewing is possible once suggestions exist, including after an export. */
const REVIEWABLE_STATUSES = new Set(['review', 'completed']);

async function reviewableJob(auth: AuthContext, jobId: string) {
  const job = await getJob(auth, jobId);
  if (!REVIEWABLE_STATUSES.has(job.status)) {
    throw new AppError('CONFLICT', 'Suggestions can be reviewed once AI enrichment has finished.');
  }
  return job;
}

const AUDIT_ACTION = {
  approve: 'suggestion.approved',
  reject: 'suggestion.rejected',
  edit: 'suggestion.edited',
  reset: 'suggestion.reset',
} as const;

/**
 * Applies one reviewer decision to one suggestion. Only the suggestion
 * changes; the row's `original` values are immutable.
 */
export async function reviewSuggestion(auth: AuthContext, jobId: string, rowId: string, input: ReviewAction) {
  const job = await reviewableJob(auth, jobId);
  const row = await CatalogRowModel.findOne({ _id: rowId, jobId: job._id, ...tenantScope(auth) }).lean();
  if (!row) throw new AppError('NOT_FOUND', 'Row not found.');
  const suggestion = row.suggestions.find((candidate) => candidate.field === input.field);
  if (!suggestion) throw new AppError('NOT_FOUND', 'There is no suggestion for this field.');

  let status: SuggestionStatus;
  let editedValue: string | null = null;
  switch (input.action) {
    case 'approve':
      if (suggestion.blocked) {
        throw new AppError('CONFLICT', 'This suggestion broke a brand rule and can’t be approved as written. Edit it, or reject it.');
      }
      status = 'approved';
      break;
    case 'reject':
      status = 'rejected';
      break;
    case 'edit': {
      // The reviewer's own text must still respect the client's brand rules.
      const brand = await effectiveBrandProfile(job.organizationId, job.clientId);
      const text = input.value!;
      const claim = brand.prohibitedClaims.find((candidate) => text.toLowerCase().includes(candidate.trim().toLowerCase()));
      if (claim) {
        throw new AppError('VALIDATION_ERROR', `“${claim}” is a prohibited claim for this client.`, {
          details: [{ path: 'body.value', message: `“${claim}” is a prohibited claim for this client.` }],
        });
      }
      status = 'edited';
      editedValue = text;
      break;
    }
    case 'reset':
      status = suggestion.blocked ? 'failed' : 'pending';
      break;
  }

  const updated = await CatalogRowModel.findOneAndUpdate(
    // Matching the status we just read means a simultaneous change by someone else wins cleanly.
    { _id: row._id, ...tenantScope(auth), suggestions: { $elemMatch: { field: input.field, status: suggestion.status } } },
    {
      $set: {
        'suggestions.$.status': status,
        'suggestions.$.editedValue': editedValue,
        'suggestions.$.reviewedAt': input.action === 'reset' ? null : new Date(),
        'suggestions.$.reviewedBy': input.action === 'reset' ? null : new Types.ObjectId(auth.userId),
      },
    },
    { returnDocument: 'after' },
  ).lean();
  if (!updated) throw new AppError('CONFLICT', 'Someone else changed this suggestion just now. Reload and try again.');

  await recordAudit(auth, {
    action: AUDIT_ACTION[input.action],
    clientId: job.clientId,
    jobId: job._id,
    entityId: row._id,
    field: input.field,
    rowNumber: row.rowNumber,
  });
  return updated;
}

/**
 * Bulk approve or reject.
 *
 * Approve only touches suggestions that are pending, not blocked and have no
 * warnings — anything a guardrail flagged needs a person to look at it. Reject
 * touches pending suggestions. Suggestions only exist for content fields, so
 * no bulk action can ever change a protected field.
 */
export async function bulkReview(auth: AuthContext, jobId: string, action: 'approve' | 'reject', input: BulkReview): Promise<number> {
  const job = await reviewableJob(auth, jobId);
  const rowFilter = {
    ...tenantScope(auth),
    jobId: job._id,
    ...(input.rowIds ? { _id: { $in: input.rowIds.map((id) => new Types.ObjectId(id)) } } : {}),
  };
  const suggestionFilter = {
    status: 'pending',
    ...(action === 'approve' ? { blocked: { $ne: true }, warnings: { $size: 0 } } : {}),
    ...(input.fields ? { field: { $in: input.fields } } : {}),
  };

  const [counted] = await CatalogRowModel.aggregate<{ total: number }>([
    { $match: rowFilter },
    { $unwind: '$suggestions' },
    { $match: Object.fromEntries(Object.entries(suggestionFilter).map(([key, value]) => [`suggestions.${key}`, value])) },
    { $count: 'total' },
  ]);
  const total = counted?.total ?? 0;
  if (total === 0) return 0;

  await CatalogRowModel.updateMany(
    rowFilter,
    {
      $set: {
        'suggestions.$[s].status': action === 'approve' ? 'approved' : 'rejected',
        'suggestions.$[s].reviewedAt': new Date(),
        'suggestions.$[s].reviewedBy': new Types.ObjectId(auth.userId),
      },
    },
    { arrayFilters: [Object.fromEntries(Object.entries(suggestionFilter).map(([key, value]) => [`s.${key}`, value]))] },
  );

  await recordAudit(auth, {
    action: action === 'approve' ? 'suggestions.bulk_approved' : 'suggestions.bulk_rejected',
    clientId: job.clientId,
    jobId: job._id,
    count: total,
  });
  return total;
}
