import type { Types } from 'mongoose';
import type { Logger } from 'pino';
import { DEFAULT_BRAND_PROFILE, productValuesSchema, type BrandProfile, type EnrichableField } from '@catalogcraft/shared';
import { enrichProduct, type EnrichProductResult } from '../../services/ai/enrich-product.js';
import { AiProviderError, type AiProvider } from '../../services/ai/provider.js';
import { CatalogJobModel, type CatalogJob } from '../catalog-jobs/catalog-job.model.js';
import { CatalogRowModel, type CatalogRow } from '../catalog-rows/catalog-row.model.js';
import { ClientModel } from '../clients/client.model.js';
import { UsageEventModel } from '../usage/usage-event.model.js';

type JobDoc = CatalogJob & { _id: Types.ObjectId };
type RowDoc = CatalogRow & { _id: Types.ObjectId };

/** After this many AI-service failures in a row, the run stops instead of burning through every product. */
const MAX_CONSECUTIVE_PROVIDER_ERRORS = 5;
/** Reviewed work is never overwritten by a new run. */
const KEEP_STATUSES = new Set(['approved', 'edited']);

export type WorkerOptions = {
  provider: AiProvider;
  logger: Logger;
  /** Products processed at the same time. */
  concurrency: number;
  /** How often to look for queued jobs. */
  pollIntervalMs?: number;
  /** How long a claimed job stays reserved without progress before another run may resume it. */
  leaseMs?: number;
};

/**
 * Background worker for AI enrichment.
 *
 * Why not Redis/BullMQ? The job document in MongoDB already is a durable
 * queue: a job is claimed with one atomic update and a time-limited "lease".
 * Progress is saved after every product, so if the server restarts the lease
 * expires and the run resumes where it left off. This needs no extra paid
 * service, and the atomic claim stays correct with several API instances.
 */
export class EnrichmentWorker {
  private timer: NodeJS.Timeout | undefined;
  private active: Promise<void> | undefined;
  private readonly pollIntervalMs: number;
  private readonly leaseMs: number;

  constructor(private readonly options: WorkerOptions) {
    this.pollIntervalMs = options.pollIntervalMs ?? 2_000;
    this.leaseMs = options.leaseMs ?? 5 * 60_000;
  }

  start(): void {
    this.timer = setInterval(() => {
      if (!this.active) this.active = this.drain().finally(() => (this.active = undefined));
    }, this.pollIntervalMs);
    this.timer.unref();
  }

  /** Stops polling and waits for the products currently in progress. */
  async stop(): Promise<void> {
    clearInterval(this.timer);
    await this.active;
  }

  private async drain(): Promise<void> {
    try {
      while (await this.runOnce()) {
        // keep going while there are jobs
      }
    } catch (error) {
      this.options.logger.error({ err: error }, 'Enrichment worker error');
    }
  }

  /** Claims and fully processes one job. Returns false when nothing was waiting. Used directly by tests. */
  async runOnce(): Promise<boolean> {
    const now = new Date();
    const job = await CatalogJobModel.findOneAndUpdate(
      {
        $or: [
          { status: 'queued', 'enrichment.rowsPrepared': true },
          { status: 'processing', 'enrichment.leaseExpiresAt': { $lt: now } }, // abandoned by a crashed run
        ],
      },
      { $set: { status: 'processing', 'enrichment.leaseExpiresAt': new Date(now.getTime() + this.leaseMs) } },
      { sort: { updatedAt: 1 }, returnDocument: 'after' },
    ).lean();
    if (!job?.enrichment) return false;

    if (!job.enrichment.startedAt) {
      await CatalogJobModel.updateOne({ _id: job._id }, { $set: { 'enrichment.startedAt': now } });
    }
    this.options.logger.info({ jobId: job._id.toString() }, 'Enrichment started');
    await this.processJob(job);
    return true;
  }

  private async processJob(job: JobDoc): Promise<void> {
    const settings = job.enrichment!;
    const client = await ClientModel.findOne({ _id: job.clientId, organizationId: job.organizationId }).select('brandProfile').lean();
    const brandProfile: BrandProfile = client?.brandProfile
      ? {
          ...client.brandProfile,
          preferredTerminology: [...client.brandProfile.preferredTerminology],
          prohibitedClaims: [...client.brandProfile.prohibitedClaims],
          defaultLanguage: client.brandProfile.defaultLanguage as BrandProfile['defaultLanguage'],
        }
      : DEFAULT_BRAND_PROFILE;
    const context = { fields: settings.fields as EnrichableField[], language: settings.language, brandProfile };

    let consecutiveProviderErrors = 0;
    let stopReason: string | null = null;

    for (;;) {
      const current = await CatalogJobModel.findById(job._id).select('status enrichment.cancelRequested').lean();
      if (!current || current.status !== 'processing') return; // deleted or moved on elsewhere
      if (current.enrichment?.cancelRequested) break;

      const rows = await CatalogRowModel.find({ jobId: job._id, 'enrichment.status': 'queued' })
        .sort({ rowNumber: 1 })
        .limit(this.options.concurrency)
        .lean();
      if (rows.length === 0) break;

      const outcomes = await Promise.all(rows.map((row) => this.processRow(job, row, context)));
      for (const outcome of outcomes) {
        if (outcome.kind === 'provider-error') {
          consecutiveProviderErrors += 1;
          if (outcome.error.kind === 'configuration') stopReason = outcome.error.message;
        } else {
          consecutiveProviderErrors = 0;
        }
      }
      if (!stopReason && consecutiveProviderErrors >= MAX_CONSECUTIVE_PROVIDER_ERRORS) {
        stopReason = 'The AI service failed several times in a row, so enrichment was paused. Try again later.';
      }
      if (stopReason) break;

      await CatalogJobModel.updateOne(
        { _id: job._id, status: 'processing' },
        { $set: { 'enrichment.leaseExpiresAt': new Date(Date.now() + this.leaseMs) } },
      );
    }

    await this.finish(job, stopReason);
  }

  private async processRow(
    job: JobDoc,
    row: RowDoc,
    context: { fields: EnrichableField[]; language: string; brandProfile: BrandProfile },
  ): Promise<{ kind: 'done' | 'failed' } | { kind: 'provider-error'; error: AiProviderError }> {
    let result: EnrichProductResult;
    try {
      result = await enrichProduct(this.options.provider, {
        original: productValuesSchema.parse(row.original ?? {}),
        ...context,
      });
    } catch (error) {
      const providerError =
        error instanceof AiProviderError ? error : new AiProviderError('Unexpected error while generating suggestions.', 'request', { cause: error });
      this.options.logger.warn({ err: error, rowId: row._id.toString() }, 'AI request failed');
      await this.saveRow(job, row, {
        outcome: 'failed',
        suggestions: [],
        missingFacts: [],
        notes: [],
        error: providerError.message,
        model: this.options.provider.model,
        usage: { inputTokens: 0, outputTokens: 0 },
      });
      return { kind: 'provider-error', error: providerError };
    }
    await this.saveRow(job, row, result);
    return { kind: result.outcome };
  }

  /**
   * Saves one product's result, its usage record and the job's progress.
   * Only `suggestions` and `enrichment` change — `original` is immutable.
   */
  private async saveRow(job: JobDoc, row: RowDoc, result: EnrichProductResult): Promise<void> {
    const generated = new Map(result.suggestions.map((suggestion) => [suggestion.field, suggestion]));
    const kept = row.suggestions.filter(
      (existing) => KEEP_STATUSES.has(existing.status) || !generated.has(existing.field),
    );
    const keptFields = new Set(kept.map((suggestion) => suggestion.field));
    const suggestions = [...kept, ...result.suggestions.filter((suggestion) => !keptFields.has(suggestion.field))];

    await CatalogRowModel.updateOne(
      { _id: row._id },
      {
        $set: {
          suggestions,
          enrichment: { status: result.outcome, error: result.error, missingFacts: result.missingFacts, notes: result.notes },
        },
      },
    );
    await UsageEventModel.create({
      organizationId: job.organizationId,
      jobId: job._id,
      rowId: row._id,
      eventType: 'ai_request',
      status: result.outcome === 'done' ? 'succeeded' : 'failed',
      quantity: 1,
      // Only a successfully enriched product counts towards the plan allowance.
      usageUnits: result.outcome === 'done' ? 1 : 0,
      model: result.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    });
    await CatalogJobModel.updateOne(
      { _id: job._id },
      {
        $inc: {
          'enrichment.processedRows': 1,
          [result.outcome === 'done' ? 'enrichment.succeededRows' : 'enrichment.failedRows']: 1,
        },
      },
    );
  }

  /** Ends the run: unprocessed rows are marked skipped, and the job moves to review (or back/failed). */
  private async finish(job: JobDoc, stopReason: string | null): Promise<void> {
    await CatalogRowModel.updateMany({ jobId: job._id, 'enrichment.status': 'queued' }, { $set: { 'enrichment.status': 'skipped' } });

    const latest = await CatalogJobModel.findById(job._id).select('enrichment').lean();
    const cancelled = latest?.enrichment?.cancelRequested ?? false;
    const anyDone = await CatalogRowModel.exists({ jobId: job._id, 'enrichment.status': 'done' });

    let status: 'review' | 'ready' | 'failed';
    let lastError: string | null = stopReason;
    if (anyDone) status = 'review';
    else if (cancelled && !stopReason) status = 'ready';
    else {
      status = 'failed';
      const sample = await CatalogRowModel.findOne({ jobId: job._id, 'enrichment.status': 'failed' }).select('enrichment.error').lean();
      lastError = stopReason ?? `No products could be enriched. ${sample?.enrichment?.error ?? ''}`.trim();
    }

    await CatalogJobModel.updateOne(
      { _id: job._id, status: 'processing' },
      { $set: { status, lastError, 'enrichment.finishedAt': new Date(), 'enrichment.leaseExpiresAt': null } },
    );
    this.options.logger.info({ jobId: job._id.toString(), status }, 'Enrichment finished');
  }
}
