import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiSuccessResponseSchema, jobSchema, rowListSchema, type Role } from '@catalogcraft/shared';
import { AuditLogModel } from '../src/modules/audit/audit-log.model.js';
import { CatalogJobModel } from '../src/modules/catalog-jobs/catalog-job.model.js';
import { CatalogRowModel } from '../src/modules/catalog-rows/catalog-row.model.js';
import { EnrichmentWorker } from '../src/modules/enrichment/enrichment.worker.js';
import { ExportModel } from '../src/modules/exports/export.model.js';
import { addTeammate, connectTestDatabase, dbTestApp, disconnectTestDatabase, newAgency, testStorageDir } from './helpers.js';
import { MockAiProvider } from './mock-ai.js';

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);
beforeEach(() => CatalogJobModel.updateMany({ status: { $in: ['queued', 'processing'] } }, { status: 'ready' }));

const jobResponse = apiSuccessResponseSchema(jobSchema);
const rowsResponse = apiSuccessResponseSchema(rowListSchema);

// Column order: SKU, Name, Price, Stock, Supplier note (unmapped), Description
const CSV = [
  'SKU,Name,Price,Stock,Supplier note,Description',
  '00042,Stoneware mug,12.50,-3,keep cool,Glazed mug.',
  'MUG-2,Enamel mug,9.99,15,"=HYPERLINK(""http://evil"")",',
  'BAD-1,Broken,abc,1,,',
].join('\n');
const MAPPING = { sku: 0, title: 1, price: 2, stockQuantity: 3, description: 5 };

/** AI answers: row "Enamel mug" mentions an invented number, so it gets a warning. */
const ai = () =>
  new MockAiProvider((request) => {
    const enamel = request.user.includes('Enamel mug');
    return MockAiProvider.answer({
      title: enamel ? 'Enamel mug, 500 ml' : 'Blue stoneware mug',
      description: enamel ? 'A light enamel mug.' : 'A glazed stoneware mug.',
      missingFacts: [],
      warnings: [],
    });
  });

/** A job that has been imported, validated and enriched (title + description). */
async function reviewJob() {
  const provider = ai();
  const app = dbTestApp({}, { ai: provider });
  const agency = await newAgency(app, { plan: 'agency' });
  const clientId = (
    await agency.client.post('/api/v1/clients').send({ name: 'Kitchen Co', brandProfile: { prohibitedClaims: ['eco-friendly'] } }).expect(201)
  ).body.data.id as string;
  const jobId = (await agency.client.post('/api/v1/jobs').send({ clientId, name: 'Spring' }).expect(201)).body.data.id as string;
  await agency.client.post(`/api/v1/jobs/${jobId}/upload`).attach('file', Buffer.from(CSV), 'supplier.csv').expect(200);
  await agency.client.put(`/api/v1/jobs/${jobId}/mapping`).send({ sheetName: null, headerRow: 1, mapping: MAPPING }).expect(200);
  await agency.client.post(`/api/v1/jobs/${jobId}/validate`).expect(200);
  await agency.client.post(`/api/v1/jobs/${jobId}/enrich`).send({ fields: ['title', 'description'] }).expect(202);
  await new EnrichmentWorker({ provider, logger: pino({ level: 'silent' }), concurrency: 2 }).runOnce();

  const rows = rowsResponse.parse((await agency.client.get(`/api/v1/jobs/${jobId}/rows`)).body).data.items;
  const rowId = (sku: string) => rows.find((row) => row.sourceIdentifier === sku)!.id;
  return { app, agency, clientId, jobId, mugRow: rowId('00042'), enamelRow: rowId('MUG-2') };
}

async function getJob(agency: Awaited<ReturnType<typeof reviewJob>>['agency'], jobId: string) {
  return jobResponse.parse((await agency.client.get(`/api/v1/jobs/${jobId}`)).body).data;
}

describe('reviewing one suggestion', () => {
  it('approves, edits, rejects and resets, keeping the original untouched', async () => {
    const { agency, jobId, mugRow } = await reviewJob();
    const patch = (body: object) => agency.client.patch(`/api/v1/jobs/${jobId}/rows/${mugRow}`).send(body);

    const approved = await patch({ field: 'title', action: 'approve' });
    expect(approved.status).toBe(200);
    expect(approved.body.data.suggestions[0]).toMatchObject({ field: 'title', status: 'approved', editedValue: null });
    expect(approved.body.data.suggestions[0].reviewedAt).not.toBeNull();

    const edited = await patch({ field: 'description', action: 'edit', value: 'A hand-glazed stoneware mug.' });
    expect(edited.body.data.suggestions[1]).toMatchObject({ status: 'edited', editedValue: 'A hand-glazed stoneware mug.', value: 'A glazed stoneware mug.' });

    expect((await patch({ field: 'title', action: 'reject' })).body.data.suggestions[0].status).toBe('rejected');
    expect((await patch({ field: 'title', action: 'reset' })).body.data.suggestions[0].status).toBe('pending');

    const stored = await CatalogRowModel.findById(mugRow).lean();
    expect(stored?.original).toMatchObject({ sku: '00042', title: 'Stoneware mug', price: '12.50' });
    expect((await getJob(agency, jobId)).review).toMatchObject({ pending: 3, edited: 1 });
  });

  it('refuses edits that use a prohibited claim, and blocked suggestions cannot be approved', async () => {
    const { agency, jobId, mugRow } = await reviewJob();
    const claim = await agency.client
      .patch(`/api/v1/jobs/${jobId}/rows/${mugRow}`)
      .send({ field: 'title', action: 'edit', value: 'Eco-Friendly mug' });
    expect(claim.status).toBe(400);
    expect(claim.body.error.details[0]).toMatchObject({ path: 'body.value' });

    await CatalogRowModel.updateOne({ _id: mugRow }, { $set: { 'suggestions.0.status': 'failed', 'suggestions.0.blocked': true } });
    const blocked = await agency.client.patch(`/api/v1/jobs/${jobId}/rows/${mugRow}`).send({ field: 'title', action: 'approve' });
    expect(blocked.status).toBe(409);
    // …but a reviewer can still write acceptable text themselves.
    const fixed = await agency.client.patch(`/api/v1/jobs/${jobId}/rows/${mugRow}`).send({ field: 'title', action: 'edit', value: 'Stoneware mug' });
    expect(fixed.status).toBe(200);
    // and undoing returns it to "failed", not "pending".
    const undone = await agency.client.patch(`/api/v1/jobs/${jobId}/rows/${mugRow}`).send({ field: 'title', action: 'reset' });
    expect(undone.body.data.suggestions[0].status).toBe('failed');
  });

  it('validates the request and 404s for missing suggestions or rows', async () => {
    const { agency, jobId, mugRow } = await reviewJob();
    const patch = (rowId: string, body: object) => agency.client.patch(`/api/v1/jobs/${jobId}/rows/${rowId}`).send(body);

    expect((await patch(mugRow, { field: 'price', action: 'approve' })).status).toBe(400); // protected field
    expect((await patch(mugRow, { field: 'tags', action: 'approve' })).status).toBe(404); // no tags suggestion
    expect((await patch('64b7f0c2a1b2c3d4e5f60718', { field: 'title', action: 'approve' })).status).toBe(404);
  });
});

describe('bulk review', () => {
  it('approves only pending suggestions without warnings', async () => {
    const { agency, jobId, enamelRow } = await reviewJob();

    const res = await agency.client.post(`/api/v1/jobs/${jobId}/approve`).send({});
    expect(res.status).toBe(200);
    // Mug: title + description. Enamel: description only — its title mentions an invented "500".
    expect(res.body.data).toEqual({ updated: 3 });

    const enamel = await CatalogRowModel.findById(enamelRow).lean();
    expect(enamel?.suggestions.map((s) => [s.field, s.status])).toEqual([
      ['title', 'pending'],
      ['description', 'approved'],
    ]);
    expect((await getJob(agency, jobId)).review).toMatchObject({ approved: 3, pending: 1, eligibleForBulkApproval: 0 });
  });

  it('can be limited to selected rows and fields, and rejects in bulk', async () => {
    const { agency, jobId, mugRow } = await reviewJob();
    const approved = await agency.client.post(`/api/v1/jobs/${jobId}/approve`).send({ rowIds: [mugRow], fields: ['title'] });
    expect(approved.body.data).toEqual({ updated: 1 });

    const rejected = await agency.client.post(`/api/v1/jobs/${jobId}/reject`).send({});
    expect(rejected.body.data).toEqual({ updated: 3 }); // every remaining pending suggestion, warnings or not
  });
});

describe('review permissions, audit and isolation', () => {
  it.each<[Role, number]>([
    ['reviewer', 200],
    ['admin', 200],
    ['editor', 403],
  ])('%s approving → %i', async (role, expected) => {
    const { app, agency, jobId, mugRow } = await reviewJob();
    const teammate = await addTeammate(app, agency.organizationId, role);
    expect((await teammate.client.patch(`/api/v1/jobs/${jobId}/rows/${mugRow}`).send({ field: 'title', action: 'approve' })).status).toBe(expected);
    expect((await teammate.client.post(`/api/v1/jobs/${jobId}/approve`).send({})).status).toBe(expected);
  });

  it('records every decision without storing product text', async () => {
    const { agency, jobId, mugRow } = await reviewJob();
    await agency.client.patch(`/api/v1/jobs/${jobId}/rows/${mugRow}`).send({ field: 'description', action: 'edit', value: 'Secret new copy' });
    await agency.client.post(`/api/v1/jobs/${jobId}/approve`).send({});

    const activity = (await agency.client.get(`/api/v1/jobs/${jobId}/activity`)).body.data;
    expect(activity.map((entry: { action: string }) => entry.action)).toEqual(['suggestions.bulk_approved', 'suggestion.edited']);
    expect(activity[1]).toMatchObject({ field: 'description', rowNumber: 2, actor: { id: agency.userId } });
    expect(activity[0]).toMatchObject({ count: 2 });
    const raw = JSON.stringify(await AuditLogModel.find({ jobId }).lean());
    expect(raw).not.toMatch(/Secret new copy|Stoneware|Enamel/);
  });

  it('keeps another agency out of reviews, activity and exports', async () => {
    const a = await reviewJob();
    const b = await newAgency(a.app);
    expect((await b.client.patch(`/api/v1/jobs/${a.jobId}/rows/${a.mugRow}`).send({ field: 'title', action: 'approve' })).status).toBe(404);
    expect((await b.client.post(`/api/v1/jobs/${a.jobId}/approve`).send({})).status).toBe(404);
    expect((await b.client.get(`/api/v1/jobs/${a.jobId}/activity`)).status).toBe(404);
    expect((await b.client.post(`/api/v1/jobs/${a.jobId}/export`).send({ fields: ['sku'] })).status).toBe(404);
    expect((await CatalogRowModel.findById(a.mugRow).lean())?.suggestions.every((s) => s.status === 'pending')).toBe(true);
  });
});

describe('CSV export', () => {
  async function exportAndDownload(agency: Awaited<ReturnType<typeof reviewJob>>['agency'], jobId: string, body: object) {
    const created = await agency.client.post(`/api/v1/jobs/${jobId}/export`).send(body);
    expect(created.status).toBe(201);
    const download = await agency.client.get(`/api/v1/exports/${created.body.data.id}/download`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    return { created, download, rows: parse((download.body as Buffer).toString('utf8'), { bom: true }) as string[][] };
  }

  it('exports approved values only, with protected values exactly as imported', async () => {
    const { agency, jobId, mugRow } = await reviewJob();
    await agency.client.patch(`/api/v1/jobs/${jobId}/rows/${mugRow}`).send({ field: 'title', action: 'approve' });
    await agency.client.patch(`/api/v1/jobs/${jobId}/rows/${mugRow}`).send({ field: 'description', action: 'edit', value: 'Hand-glazed.' });
    // The enamel suggestions stay pending: they must not appear.

    const { created, download, rows } = await exportAndDownload(agency, jobId, { fields: ['sku', 'title', 'price', 'stockQuantity', 'description'] });
    expect(created.body.data).toMatchObject({ rowCount: 2, columnCount: 6, changedCells: 2 });
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(download.headers['content-disposition']).toMatch(/^attachment; filename="kitchen-co-spring-\d{12}\.csv"/);
    expect(download.headers['cache-control']).toBe('private, no-store');

    expect(rows).toEqual([
      ['SKU', 'Name', 'Price', 'Stock', 'Supplier note', 'Description'],
      ['00042', 'Blue stoneware mug', '12.50', '-3', 'keep cool', 'Hand-glazed.'], // leading zeros and "-3" preserved
      ['MUG-2', 'Enamel mug', '9.99', '15', `'=HYPERLINK("http://evil")`, ''], // formula neutralized; pending AI text excluded
    ]);
    expect((await getJob(agency, jobId)).status).toBe('completed');
  });

  it('stores the file privately, lists the export, logs downloads and can export again', async () => {
    const { agency, jobId } = await reviewJob();
    const { created } = await exportAndDownload(agency, jobId, { fields: ['sku'], includeUnmappedColumns: false });
    const record = await ExportModel.findById(created.body.data.id).lean();
    expect(record?.storageKey).toMatch(new RegExp(`^organizations/${agency.organizationId}/exports/[0-9a-f-]{36}\\.csv$`));
    expect(JSON.stringify(created.body)).not.toContain(record!.storageKey);

    const list = (await agency.client.get(`/api/v1/jobs/${jobId}/exports`)).body.data;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ downloadCount: 1, columnCount: 1 });
    expect((await agency.client.get(`/api/v1/jobs/${jobId}/activity`)).body.data.map((e: { action: string }) => e.action)).toEqual([
      'export.downloaded',
      'export.created',
    ]);

    // A completed job can be reviewed and exported again.
    await agency.client.post(`/api/v1/jobs/${jobId}/approve`).send({}).expect(200);
    await agency.client.post(`/api/v1/jobs/${jobId}/export`).send({ fields: ['sku', 'title'] }).expect(201);
    const summary = (await agency.client.get('/api/v1/dashboard/summary')).body.data;
    expect(summary.recentExports).toHaveLength(2);
  });

  it('authorises every download', async () => {
    const { app, agency, jobId } = await reviewJob();
    const { created } = await exportAndDownload(agency, jobId, { fields: ['sku'] });
    const exportId = created.body.data.id as string;

    expect((await request(app).get(`/api/v1/exports/${exportId}/download`)).status).toBe(401);
    const stranger = await newAgency(app);
    expect((await stranger.client.get(`/api/v1/exports/${exportId}/download`)).status).toBe(404);
    expect((await stranger.client.get(`/api/v1/exports/${exportId}`)).status).toBe(404);
    // Teammates of any role may download.
    const reviewer = await addTeammate(app, agency.organizationId, 'reviewer');
    expect((await reviewer.client.get(`/api/v1/exports/${exportId}/download`)).status).toBe(200);
  });

  it('can export a validated job without AI, and refuses empty results clearly', async () => {
    const app = dbTestApp();
    const agency = await newAgency(app, { plan: 'agency' });
    const clientId = (await agency.client.post('/api/v1/clients').send({ name: 'Plain Co' })).body.data.id;
    const jobId = (await agency.client.post('/api/v1/jobs').send({ clientId })).body.data.id;
    await agency.client.post(`/api/v1/jobs/${jobId}/upload`).attach('file', Buffer.from('SKU,Price\nA,1\nB,x'), 'p.csv').expect(200);
    await agency.client.put(`/api/v1/jobs/${jobId}/mapping`).send({ sheetName: null, headerRow: 1, mapping: { sku: 0, price: 1 } }).expect(200);
    await agency.client.post(`/api/v1/jobs/${jobId}/validate`).expect(200);

    expect((await agency.client.post(`/api/v1/jobs/${jobId}/export`).send({ fields: ['sku', 'price'] })).body.data.rowCount).toBe(1);
    const nothing = await agency.client.post(`/api/v1/jobs/${jobId}/export`).send({ fields: ['title'], includeUnmappedColumns: false });
    expect(nothing.status).toBe(400);
    expect((await CatalogJobModel.findById(jobId).lean())?.status).toBe('completed'); // unchanged by the failed attempt
  });

  it('deletes exports and their files with the job', async () => {
    const { agency, jobId } = await reviewJob();
    const { created } = await exportAndDownload(agency, jobId, { fields: ['sku'] });
    const key = (await ExportModel.findById(created.body.data.id).lean())!.storageKey;

    await agency.client.delete(`/api/v1/jobs/${jobId}`).expect(200);
    expect(await ExportModel.countDocuments({ jobId })).toBe(0);
    const files = await readdir(path.join(testStorageDir, 'organizations', agency.organizationId, 'exports'));
    expect(files).not.toContain(path.basename(key));
  });
});
