import type { z } from 'zod';
import { statusesThatCanBecome, type RowStatus, type startEnrichmentSchema } from '@catalogcraft/shared';
import type { AuthContext } from '../../middleware/require-auth.js';
import { PROMPT_VERSION } from '../../services/ai/prompts/product-enrichment.js';
import type { AiProvider } from '../../services/ai/provider.js';
import { AppError } from '../../utils/app-error.js';
import { tenantScope } from '../../utils/tenant.js';
import { CatalogJobModel } from '../catalog-jobs/catalog-job.model.js';
import { getJob } from '../catalog-jobs/catalog-job.service.js';
import { CatalogRowModel } from '../catalog-rows/catalog-row.model.js';
import { ClientModel } from '../clients/client.model.js';
import { assertProductAllowance } from '../usage/usage.service.js';

type StartInput = z.output<typeof startEnrichmentSchema>;

export const AI_NOT_CONFIGURED_MESSAGE =
  'AI enrichment is not set up on this server. Add AI_API_KEY to the API’s .env file and restart it (see README).';

/**
 * Queues an AI enrichment run. The work itself happens in the background
 * worker; this only checks permissions, limits and state, then marks the
 * eligible rows. Rows with validation errors are never sent to the AI.
 */
export async function startEnrichment(provider: AiProvider | null, auth: AuthContext, jobId: string, input: StartInput) {
  if (!provider) throw new AppError('AI_NOT_CONFIGURED', AI_NOT_CONFIGURED_MESSAGE);

  const job = await getJob(auth, jobId);
  const allowedFrom = statusesThatCanBecome('queued');
  if (!allowedFrom.includes(job.status) || job.counts.totalRows === 0) {
    throw new AppError('CONFLICT', 'Validate the file before starting AI enrichment, and wait for any running enrichment to finish.');
  }

  const client = await ClientModel.findOne({ _id: job.clientId, ...tenantScope(auth) }).select('brandProfile').lean();
  if (!client) throw new AppError('NOT_FOUND', 'Client not found.');

  const eligible = {
    ...tenantScope(auth),
    jobId: job._id,
    status: { $in: input.includeWarningRows ? (['valid', 'warning'] as RowStatus[]) : (['valid'] as RowStatus[]) },
  };
  const rowCount = await CatalogRowModel.countDocuments(eligible);
  if (rowCount === 0) {
    throw new AppError('CONFLICT', 'No rows can be enriched: every row has validation errors. Fix the source file and upload it again.');
  }
  await assertProductAllowance(auth.organizationId, rowCount);

  // Atomic: only one request can move the job into the queue.
  const queued = await CatalogJobModel.findOneAndUpdate(
    { _id: job._id, ...tenantScope(auth), status: { $in: allowedFrom } },
    {
      $set: {
        status: 'queued',
        lastError: null,
        enrichment: {
          fields: input.fields,
          language: input.language ?? client.brandProfile.defaultLanguage,
          includeWarningRows: input.includeWarningRows,
          model: provider.model,
          promptVersion: PROMPT_VERSION,
          totalRows: rowCount,
          processedRows: 0,
          succeededRows: 0,
          failedRows: 0,
          rowsPrepared: false,
          cancelRequested: false,
          leaseExpiresAt: null,
          startedAt: null,
          finishedAt: null,
        },
      },
    },
    { returnDocument: 'after' },
  ).lean();
  if (!queued) throw new AppError('CONFLICT', 'This job changed while you were starting enrichment. Reload and try again.');

  await CatalogRowModel.updateMany(eligible, {
    $set: { enrichment: { status: 'queued', error: null, missingFacts: [], notes: [] } },
  });
  // Only now may the worker pick the job up.
  const prepared = await CatalogJobModel.findOneAndUpdate(
    { _id: job._id, status: 'queued' },
    { $set: { 'enrichment.rowsPrepared': true } },
    { returnDocument: 'after' },
  ).lean();
  return prepared ?? queued;
}

/**
 * Stops an enrichment run. A queued job is taken out of the queue at once;
 * a running job finishes the products already in progress, then stops.
 * Suggestions already generated are kept.
 */
export async function cancelEnrichment(auth: AuthContext, jobId: string) {
  const job = await getJob(auth, jobId);

  if (job.status === 'queued') {
    const hasSuggestions = await CatalogRowModel.exists({ jobId: job._id, 'enrichment.status': 'done' });
    const cancelled = await CatalogJobModel.findOneAndUpdate(
      { _id: job._id, ...tenantScope(auth), status: 'queued' },
      { $set: { status: hasSuggestions ? 'review' : 'ready', 'enrichment.cancelRequested': true, 'enrichment.finishedAt': new Date() } },
      { returnDocument: 'after' },
    ).lean();
    if (cancelled) {
      await CatalogRowModel.updateMany({ jobId: job._id, 'enrichment.status': 'queued' }, { $set: { 'enrichment.status': 'skipped' } });
      return cancelled;
    }
  }

  const running = await CatalogJobModel.findOneAndUpdate(
    { _id: job._id, ...tenantScope(auth), status: 'processing' },
    { $set: { 'enrichment.cancelRequested': true } },
    { returnDocument: 'after' },
  ).lean();
  if (!running) throw new AppError('CONFLICT', 'There is no enrichment running for this job.');
  return running;
}
