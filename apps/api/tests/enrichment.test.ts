import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiSuccessResponseSchema, jobSchema, rowListSchema, usageSummarySchema, type PlanId, type Role } from '@catalogcraft/shared';
import { CatalogJobModel } from '../src/modules/catalog-jobs/catalog-job.model.js';
import { CatalogRowModel } from '../src/modules/catalog-rows/catalog-row.model.js';
import { EnrichmentWorker } from '../src/modules/enrichment/enrichment.worker.js';
import { UsageEventModel } from '../src/modules/usage/usage-event.model.js';
import { AiProviderError } from '../src/services/ai/provider.js';
import { addTeammate, connectTestDatabase, dbTestApp, disconnectTestDatabase, newAgency } from './helpers.js';
import { MockAiProvider } from './mock-ai.js';

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);
// The worker (correctly) claims any queued job in the database. All tests in
// this file share one database, so each test starts with no active jobs left
// over from earlier tests.
beforeEach(() => CatalogJobModel.updateMany({ status: { $in: ['queued', 'processing'] } }, { status: 'ready' }));

const jobResponse = apiSuccessResponseSchema(jobSchema);
const rowsResponse = apiSuccessResponseSchema(rowListSchema);
const silent = pino({ level: 'silent' });

const CSV = [
  'SKU,Name,Description,Price,Stock,EAN',
  'MUG-1,Stoneware mug,Glazed mug.,12.50,40,4006381333931',
  'MUG-2,Enamel mug,,9.99,15,',
  'BAD-1,Broken price,,abc,1,', // validation error: never sent to the AI
  'TIN-1,Tea tin,Airtight.,7,100,',
].join('\n');
const MAPPING = { sku: 0, title: 1, description: 2, price: 3, stockQuantity: 4, barcode: 5 };

async function readyJob(options: { plan?: PlanId; ai?: MockAiProvider | null; csv?: string; mapping?: Record<string, number> } = {}) {
  const ai = options.ai === undefined ? new MockAiProvider() : options.ai;
  const app = dbTestApp({}, { ai });
  const agency = await newAgency(app, { plan: options.plan ?? 'agency' });
  const clientId = (
    await agency.client
      .post('/api/v1/clients')
      .send({ name: 'Kitchen Co', brandProfile: { defaultLanguage: 'en-GB', prohibitedClaims: ['eco-friendly'] } })
      .expect(201)
  ).body.data.id as string;
  const jobId = (await agency.client.post('/api/v1/jobs').send({ clientId }).expect(201)).body.data.id as string;
  await agency.client.post(`/api/v1/jobs/${jobId}/upload`).attach('file', Buffer.from(options.csv ?? CSV), 'p.csv').expect(200);
  await agency.client.put(`/api/v1/jobs/${jobId}/mapping`).send({ sheetName: null, headerRow: 1, mapping: options.mapping ?? MAPPING }).expect(200);
  await agency.client.post(`/api/v1/jobs/${jobId}/validate`).expect(200);
  const worker = ai ? new EnrichmentWorker({ provider: ai, logger: silent, concurrency: 2 }) : null;
  return { app, agency, jobId, ai, worker };
}

describe('starting enrichment', () => {
  it('explains clearly when AI is not configured, and never fakes results', async () => {
    const { agency, jobId } = await readyJob({ ai: null });

    const res = await agency.client.post(`/api/v1/jobs/${jobId}/enrich`).send({ fields: ['title'] });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AI_NOT_CONFIGURED');
    expect((await agency.client.get('/api/v1/ai/status')).body.data).toEqual({ configured: false, model: null });
    expect(await CatalogRowModel.countDocuments({ jobId, suggestions: { $ne: [] } })).toBe(0);
  });

  it('queues the job and marks only rows without errors', async () => {
    const { agency, jobId } = await readyJob();
    const res = await agency.client.post(`/api/v1/jobs/${jobId}/enrich`).send({ fields: ['title', 'description'] });

    expect(res.status).toBe(202);
    const job = jobResponse.parse(res.body).data;
    expect(job.status).toBe('queued');
    expect(job.enrichment).toMatchObject({ fields: ['title', 'description'], language: 'en-GB', totalRows: 3, model: 'mock-model' });
    expect(await CatalogRowModel.findOne({ jobId, sourceIdentifier: 'BAD-1' }).lean()).toMatchObject({ enrichment: null });
  });

  it('rejects protected fields and refuses jobs that are not validated', async () => {
    const { agency, jobId } = await readyJob();
    const protectedField = await agency.client.post(`/api/v1/jobs/${jobId}/enrich`).send({ fields: ['price'] });
    expect(protectedField.status).toBe(400);

    await agency.client.post(`/api/v1/jobs/${jobId}/enrich`).send({ fields: ['title'] }).expect(202);
    const twice = await agency.client.post(`/api/v1/jobs/${jobId}/enrich`).send({ fields: ['title'] });
    expect(twice.status).toBe(409);
  });

  it('enforces the monthly product allowance before spending anything', async () => {
    const csv = ['SKU,Name', ...Array.from({ length: 30 }, (_, i) => `S-${i},Product ${i}`)].join('\n');
    const { agency, jobId, ai } = await readyJob({ plan: 'trial', csv, mapping: { sku: 0, title: 1 } });

    const res = await agency.client.post(`/api/v1/jobs/${jobId}/enrich`).send({ fields: ['title'] });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
    expect(res.body.error.message).toMatch(/needs 30 products, but your plan has 25 of 25 left/);
    expect(ai?.requests).toHaveLength(0);
  });
});

describe('the background worker', () => {
  it('generates pending suggestions, keeps originals intact and records usage', async () => {
    const { agency, jobId, ai, worker } = await readyJob();
    await agency.client.post(`/api/v1/jobs/${jobId}/enrich`).send({ fields: ['title', 'tags'] }).expect(202);
    const before = await CatalogRowModel.find({ jobId }).sort({ rowNumber: 1 }).lean();

    expect(await worker!.runOnce()).toBe(true);
    expect(await worker!.runOnce()).toBe(false); // nothing left

    const job = jobResponse.parse((await agency.client.get(`/api/v1/jobs/${jobId}`)).body).data;
    expect(job.status).toBe('review');
    expect(job.enrichment).toMatchObject({ processedRows: 3, succeededRows: 3, failedRows: 0 });
    expect(job.enrichment?.finishedAt).not.toBeNull();

    const rows = rowsResponse.parse((await agency.client.get(`/api/v1/jobs/${jobId}/rows`)).body).data.items;
    const mug = rows.find((row) => row.sourceIdentifier === 'MUG-1')!;
    expect(mug.suggestions.map((s) => [s.field, s.value, s.status])).toEqual([
      ['title', 'Improved Stoneware mug', 'pending'],
      ['tags', 'kitchen, home', 'pending'],
    ]);
    expect(mug.enrichment).toMatchObject({ status: 'done', missingFacts: ['material'] });
    expect(rows.find((row) => row.sourceIdentifier === 'BAD-1')?.suggestions).toEqual([]);

    // Imported values are untouched, field for field.
    const after = await CatalogRowModel.find({ jobId }).sort({ rowNumber: 1 }).lean();
    expect(after.map((row) => row.original)).toEqual(before.map((row) => row.original));
    expect(after.map((row) => row.sourceValues)).toEqual(before.map((row) => row.sourceValues));

    // Only the product facts were sent — no SKU, price, stock or barcode.
    expect(ai!.requests).toHaveLength(3);
    for (const request of ai!.requests) {
      for (const secret of ['MUG-1', '12.50', '4006381333931', '"40"']) expect(request.user).not.toContain(secret);
    }

    const usage = usageSummarySchema.parse((await agency.client.get('/api/v1/usage')).body.data);
    expect(usage.products).toEqual({ used: 3, reserved: 0, limit: 2500 });
    expect(usage).toMatchObject({ aiRequests: 3, failedRequests: 0, inputTokens: 1500, outputTokens: 600, ai: { configured: true, model: 'mock-model' } });
  });

  it('fails individual products safely and does not charge for them', async () => {
    const ai = new MockAiProvider((request, call) =>
      call === 2
        ? { ok: false, reason: 'invalid_output', message: 'The AI response was not in the expected format.', model: 'mock-model', usage: { inputTokens: 100, outputTokens: 5 } }
        : MockAiProvider.echo(request),
    );
    const { agency, jobId, worker } = await readyJob({ ai });
    await agency.client.post(`/api/v1/jobs/${jobId}/enrich`).send({ fields: ['title'] }).expect(202);
    await worker!.runOnce();

    const job = await CatalogJobModel.findById(jobId).lean();
    expect(job).toMatchObject({ status: 'review', enrichment: { succeededRows: 2, failedRows: 1 } });
    const failed = await CatalogRowModel.findOne({ jobId, 'enrichment.status': 'failed' }).lean();
    expect(failed?.suggestions).toEqual([]);
    expect(failed?.enrichment?.error).toBe('The AI response was not in the expected format.');
    expect(await UsageEventModel.countDocuments({ jobId, usageUnits: 1 })).toBe(2);
    expect(await UsageEventModel.countDocuments({ jobId, status: 'failed', usageUnits: 0 })).toBe(1);
  });

  it('stops immediately on a configuration error (e.g. bad API key)', async () => {
    const ai = new MockAiProvider(() => {
      throw new AiProviderError('The AI service rejected the API key. Check AI_API_KEY.', 'configuration');
    });
    const { agency, jobId, worker } = await readyJob({ ai });
    await agency.client.post(`/api/v1/jobs/${jobId}/enrich`).send({ fields: ['title'] }).expect(202);
    await worker!.runOnce();

    const job = await CatalogJobModel.findById(jobId).lean();
    expect(job).toMatchObject({ status: 'failed', lastError: 'The AI service rejected the API key. Check AI_API_KEY.' });
    // Concurrency is 2, so only the first batch was attempted; the rest were skipped, not sent.
    expect(ai.requests).toHaveLength(2);
    expect(await CatalogRowModel.countDocuments({ jobId, 'enrichment.status': 'skipped' })).toBe(1);
  });

  it('resumes a run whose worker crashed (expired lease)', async () => {
    const { agency, jobId, worker } = await readyJob();
    await agency.client.post(`/api/v1/jobs/${jobId}/enrich`).send({ fields: ['title'] }).expect(202);
    // Simulate a crash: the job is "processing" but its lease has run out.
    await CatalogJobModel.updateOne({ _id: jobId }, { status: 'processing', 'enrichment.leaseExpiresAt': new Date(Date.now() - 1000) });

    expect(await worker!.runOnce()).toBe(true);
    expect((await CatalogJobModel.findById(jobId).lean())?.status).toBe('review');
  });

  it('never overwrites suggestions a reviewer already approved', async () => {
    const { agency, jobId, worker } = await readyJob();
    await agency.client.post(`/api/v1/jobs/${jobId}/enrich`).send({ fields: ['title'] }).expect(202);
    await worker!.runOnce();
    await CatalogRowModel.updateOne({ jobId, sourceIdentifier: 'MUG-1' }, { $set: { 'suggestions.0.status': 'approved', 'suggestions.0.value': 'Approved title' } });

    await agency.client.post(`/api/v1/jobs/${jobId}/enrich`).send({ fields: ['title', 'description'] }).expect(202);
    await worker!.runOnce();

    const row = await CatalogRowModel.findOne({ jobId, sourceIdentifier: 'MUG-1' }).lean();
    expect(row?.suggestions.map((s) => [s.field, s.status, s.value])).toEqual([
      ['title', 'approved', 'Approved title'],
      ['description', 'pending', 'A clear description of the Stoneware mug.'],
    ]);
  });
});

describe('cancelling', () => {
  it('takes a queued job out of the queue without calling the AI', async () => {
    const { agency, jobId, ai, worker } = await readyJob();
    await agency.client.post(`/api/v1/jobs/${jobId}/enrich`).send({ fields: ['title'] }).expect(202);

    const res = await agency.client.post(`/api/v1/jobs/${jobId}/enrich/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ready');
    expect(await worker!.runOnce()).toBe(false);
    expect(ai!.requests).toHaveLength(0);
    expect(await CatalogRowModel.countDocuments({ jobId, 'enrichment.status': 'skipped' })).toBe(3);
  });

  it('stops a running job after the products in progress', async () => {
    let cancel: () => Promise<unknown> = async () => undefined;
    const ai = new MockAiProvider(async (request, call) => {
      if (call === 1) await cancel(); // cancel arrives while the first batch is running
      return MockAiProvider.echo(request);
    });
    const { agency, jobId, worker } = await readyJob({ ai });
    cancel = () => agency.client.post(`/api/v1/jobs/${jobId}/enrich/cancel`).expect(200);
    await agency.client.post(`/api/v1/jobs/${jobId}/enrich`).send({ fields: ['title'] }).expect(202);
    await worker!.runOnce();

    const job = await CatalogJobModel.findById(jobId).lean();
    expect(job).toMatchObject({ status: 'review', enrichment: { cancelRequested: true, processedRows: 2 } });
    expect(await CatalogRowModel.countDocuments({ jobId, 'enrichment.status': 'skipped' })).toBe(1);
  });
});

describe('permissions and tenant isolation', () => {
  it.each<[Role, number]>([
    ['editor', 202],
    ['reviewer', 403],
  ])('%s starting enrichment → %i', async (role, expected) => {
    const { app, agency, jobId } = await readyJob();
    const teammate = await addTeammate(app, agency.organizationId, role);
    expect((await teammate.client.post(`/api/v1/jobs/${jobId}/enrich`).send({ fields: ['title'] })).status).toBe(expected);
  });

  it('keeps usage owner/admin-only', async () => {
    const { app, agency } = await readyJob();
    const editor = await addTeammate(app, agency.organizationId, 'editor');
    expect((await editor.client.get('/api/v1/usage')).status).toBe(403);
    expect((await editor.client.get('/api/v1/ai/status')).status).toBe(200);
  });

  it('prevents one agency from enriching, cancelling or seeing another’s usage', async () => {
    const a = await readyJob();
    const bAgency = await newAgency(a.app);
    await a.agency.client.post(`/api/v1/jobs/${a.jobId}/enrich`).send({ fields: ['title'] }).expect(202);
    await a.worker!.runOnce();

    expect((await bAgency.client.post(`/api/v1/jobs/${a.jobId}/enrich`).send({ fields: ['title'] })).status).toBe(404);
    expect((await bAgency.client.post(`/api/v1/jobs/${a.jobId}/enrich/cancel`)).status).toBe(404);
    const bUsage = (await bAgency.client.get('/api/v1/usage')).body.data;
    expect(bUsage.products.used).toBe(0);
    expect(bUsage.aiRequests).toBe(0);
  });
});
