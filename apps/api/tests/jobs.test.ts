import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiSuccessResponseSchema,
  jobSchema,
  previewSchema,
  rowListSchema,
  type PlanId,
  type Role,
} from '@catalogcraft/shared';
import { CatalogJobModel } from '../src/modules/catalog-jobs/catalog-job.model.js';
import { CatalogRowModel } from '../src/modules/catalog-rows/catalog-row.model.js';
import { makeXlsx, SAMPLE_CSV } from './fixtures.js';
import {
  addTeammate,
  connectTestDatabase,
  dbTestApp,
  disconnectTestDatabase,
  newAgency,
  testStorageDir,
} from './helpers.js';

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);

const jobResponse = apiSuccessResponseSchema(jobSchema);
const previewResponse = apiSuccessResponseSchema(previewSchema);
const rowsResponse = apiSuccessResponseSchema(rowListSchema);

type App = ReturnType<typeof dbTestApp>;
type Agency = Awaited<ReturnType<typeof newAgency>>;

async function agencyWithClient(app: App, plan: PlanId = 'agency') {
  const agency = await newAgency(app, { plan });
  const clientRes = await agency.client
    .post('/api/v1/clients')
    .send({ name: 'Kitchen Co', brandProfile: { maxTitleLength: 60 } })
    .expect(201);
  return { ...agency, clientId: clientRes.body.data.id as string };
}

async function createJob(agency: Agency & { clientId: string }) {
  const res = await agency.client.post('/api/v1/jobs').send({ clientId: agency.clientId, name: 'Spring catalogue' }).expect(201);
  return res.body.data.id as string;
}

function uploadCsv(agency: Agency, jobId: string, csv = SAMPLE_CSV, filename = 'products.csv') {
  return agency.client.post(`/api/v1/jobs/${jobId}/upload`).attach('file', Buffer.from(csv), filename);
}

const SAMPLE_MAPPING = { sku: 0, title: 1, description: 2, price: 3, currency: 4, stockQuantity: 5, barcode: 6, imageUrl: 7 };

/** Create → upload → map → validate, returning the job id. */
async function importedJob(agency: Agency & { clientId: string }, csv = SAMPLE_CSV) {
  const jobId = await createJob(agency);
  await uploadCsv(agency, jobId, csv).expect(200);
  await agency.client
    .put(`/api/v1/jobs/${jobId}/mapping`)
    .send({ sheetName: null, headerRow: 1, mapping: SAMPLE_MAPPING })
    .expect(200);
  const validated = await agency.client.post(`/api/v1/jobs/${jobId}/validate`).expect(200);
  return { jobId, job: jobResponse.parse(validated.body).data };
}

describe('creating jobs', () => {
  it('creates a draft job for one of the organization’s clients', async () => {
    const agency = await agencyWithClient(dbTestApp());
    const res = await agency.client.post('/api/v1/jobs').send({ clientId: agency.clientId });

    expect(res.status).toBe(201);
    const job = jobResponse.parse(res.body).data;
    expect(job).toMatchObject({ status: 'draft', client: { id: agency.clientId, name: 'Kitchen Co' }, file: null });
    expect(job.name).toMatch(/^Import \d{4}-\d{2}-\d{2}/);
    expect(job.createdBy.id).toBe(agency.userId);
  });

  it('enforces the plan’s active-job limit (trial: one at a time)', async () => {
    const agency = await agencyWithClient(dbTestApp(), 'trial');
    await createJob(agency);

    const second = await agency.client.post('/api/v1/jobs').send({ clientId: agency.clientId });
    expect(second.status).toBe(403);
    expect(second.body.error.code).toBe('PLAN_LIMIT_REACHED');
  });
});

describe('uploading files', () => {
  it('stores the file privately under a server-generated name', async () => {
    const agency = await agencyWithClient(dbTestApp());
    const jobId = await createJob(agency);

    const res = await uploadCsv(agency, jobId, SAMPLE_CSV, '../../../etc/evil name.csv');
    expect(res.status).toBe(200);
    const job = jobResponse.parse(res.body).data;
    expect(job.status).toBe('uploaded');
    expect(job.file).toMatchObject({ filename: 'evil name.csv', fileType: 'csv', sheets: ['CSV'] });

    const stored = await CatalogJobModel.findById(jobId).lean();
    const key = stored!.originalFile!.storageKey;
    expect(key).toMatch(new RegExp(`^organizations/${agency.organizationId}/uploads/[0-9a-f-]{36}\\.csv$`));
    expect(stored!.originalFile!.checksum).toMatch(/^[0-9a-f]{64}$/);
    const files = await readdir(path.join(testStorageDir, 'organizations', agency.organizationId, 'uploads'));
    expect(files).toContain(path.basename(key));
    // The internal storage key is never sent to the browser.
    expect(JSON.stringify(res.body)).not.toContain(key);
  });

  it('accepts XLSX workbooks and lists their sheets', async () => {
    const agency = await agencyWithClient(dbTestApp());
    const jobId = await createJob(agency);
    const file = await makeXlsx({ Products: [['SKU', 'Title'], ['A-1', 'Mug']], Notes: [['x']] });

    const res = await agency.client.post(`/api/v1/jobs/${jobId}/upload`).attach('file', file, 'catalogue.xlsx');
    expect(res.status).toBe(200);
    expect(res.body.data.file).toMatchObject({ fileType: 'xlsx', sheets: ['Products', 'Notes'] });
  });

  it.each([
    ['notes.txt', 'hello', 422, 'INVALID_FILE'],
    ['fake.xlsx', 'SKU,Title', 422, 'INVALID_FILE'],
    ['empty.csv', '', 422, 'INVALID_FILE'],
  ])('rejects %s', async (filename, content, status, code) => {
    const agency = await agencyWithClient(dbTestApp());
    const jobId = await createJob(agency);
    const res = await uploadCsv(agency, jobId, content, filename);
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(code);
    expect((await CatalogJobModel.findById(jobId).lean())?.status).toBe('draft');
  });

  it('rejects files over the size limit', async () => {
    const agency = await agencyWithClient(dbTestApp({ UPLOAD_MAX_MB: '1' }));
    const jobId = await createJob(agency);
    const res = await uploadCsv(agency, jobId, `SKU\n${'A'.repeat(1_100_000)}`);
    expect(res.status).toBe(413);
    expect(res.body.error).toEqual({ code: 'PAYLOAD_TOO_LARGE', message: 'The file is larger than the 1 MB limit.' });
  });

  it('requires a file', async () => {
    const agency = await agencyWithClient(dbTestApp());
    const jobId = await createJob(agency);
    const res = await agency.client.post(`/api/v1/jobs/${jobId}/upload`).field('note', 'no file');
    expect(res.status).toBe(422);
  });

  it('replaces the previous file and its imported rows', async () => {
    const agency = await agencyWithClient(dbTestApp());
    const { jobId } = await importedJob(agency);
    const oldKey = (await CatalogJobModel.findById(jobId).lean())!.originalFile!.storageKey;
    expect(await CatalogRowModel.countDocuments({ jobId })).toBe(3);

    await uploadCsv(agency, jobId, 'SKU,Title\nNEW-1,New').expect(200);

    const job = await CatalogJobModel.findById(jobId).lean();
    expect(job).toMatchObject({ status: 'uploaded', importConfig: null });
    expect(await CatalogRowModel.countDocuments({ jobId })).toBe(0);
    const files = await readdir(path.join(testStorageDir, 'organizations', agency.organizationId, 'uploads'));
    expect(files).not.toContain(path.basename(oldKey));
  });
});

describe('preview and mapping', () => {
  it('previews headers and rows with a suggested mapping', async () => {
    const agency = await agencyWithClient(dbTestApp());
    const jobId = await createJob(agency);
    await uploadCsv(agency, jobId).expect(200);

    const preview = previewResponse.parse((await agency.client.post(`/api/v1/jobs/${jobId}/preview`).send({})).body).data;
    expect(preview.headers).toEqual(['SKU', 'Product Name', 'Description', 'Price', 'Currency', 'Stock', 'EAN', 'Image']);
    expect(preview.suggestedMapping).toEqual(SAMPLE_MAPPING);
    expect(preview.sampleRows[0]).toMatchObject({ rowNumber: 2, values: expect.arrayContaining(['MUG-001']) });
    expect(preview).toMatchObject({ totalDataRows: 3, exceedsRowLimit: false, sheetName: null });
  });

  it('lets the user choose the worksheet and header row of a workbook', async () => {
    const agency = await agencyWithClient(dbTestApp());
    const jobId = await createJob(agency);
    const file = await makeXlsx({
      Cover: [['Supplier price list']],
      Products: [['Exported 2026-10-01'], ['Item Code', 'Name'], ['A-1', 'Mug'], ['A-2', 'Bowl']],
    });
    await agency.client.post(`/api/v1/jobs/${jobId}/upload`).attach('file', file, 'list.xlsx').expect(200);

    const res = await agency.client.post(`/api/v1/jobs/${jobId}/preview`).send({ sheetName: 'Products', headerRow: 2 });
    const preview = previewResponse.parse(res.body).data;
    expect(preview).toMatchObject({ sheetName: 'Products', headerRow: 2, headers: ['Item Code', 'Name'], totalDataRows: 2 });
    expect(preview.suggestedMapping).toEqual({ sku: 0, title: 1 });

    expect((await agency.client.post(`/api/v1/jobs/${jobId}/preview`).send({ sheetName: 'Nope' })).status).toBe(400);
  });

  it('refuses a mapping without an identifier column', async () => {
    const agency = await agencyWithClient(dbTestApp());
    const jobId = await createJob(agency);
    await uploadCsv(agency, jobId).expect(200);

    const res = await agency.client.put(`/api/v1/jobs/${jobId}/mapping`).send({ sheetName: null, headerRow: 1, mapping: { title: 1 } });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/SKU or Product ID/);
  });
});

describe('validation', () => {
  it('imports every row, preserves the original values and reports issues', async () => {
    const agency = await agencyWithClient(dbTestApp());
    const csv = [
      'SKU,Product Name,Description,Price,Currency,Stock,EAN,Image',
      'MUG-001,Stoneware mug,A mug.,12.50,USD,40,4006381333931,https://img.example.com/mug.jpg',
      'MUG-001,Duplicate mug,,abc,USD,5,,',
      ',No identifier,,1,USD,1,,',
      '',
      'TEA-1,"=HYPERLINK(""http://evil"")",Tin.,7,USD,3,,',
    ].join('\n');
    const { jobId, job } = await importedJob(agency, csv);

    expect(job.status).toBe('ready');
    expect(job.counts).toEqual({ totalRows: 4, validRows: 1, warningRows: 0, failedRows: 3, skippedEmptyRows: 1 });
    expect(job.issueSummary[0]).toMatchObject({ severity: 'error', field: 'sku', type: 'duplicate', count: 2 });

    const rows = rowsResponse.parse((await agency.client.get(`/api/v1/jobs/${jobId}/rows`)).body).data;
    expect(rows.items.map((row) => row.rowNumber)).toEqual([2, 3, 4, 6]);
    // Formula-like text is stored exactly as supplied, never evaluated.
    expect(rows.items[3]?.original.title).toBe('=HYPERLINK("http://evil")');
    expect(rows.items[1]?.issues.map((issue) => issue.field)).toEqual(['sku', 'description', 'price']);

    const stored = await CatalogRowModel.findOne({ jobId, rowNumber: 2 }).lean();
    expect(stored?.sourceValues[0]).toBe('MUG-001');
  });

  it('filters and searches rows with pagination', async () => {
    const agency = await agencyWithClient(dbTestApp());
    const csv = ['SKU,Product Name,Price', 'A-1,Mug,1', 'A-2,Bowl,x', 'A-3,Mug XL,y', 'A-4,Plate,4'].join('\n');
    const jobId = await createJob(agency);
    await uploadCsv(agency, jobId, csv).expect(200);
    await agency.client.put(`/api/v1/jobs/${jobId}/mapping`).send({ sheetName: null, headerRow: 1, mapping: { sku: 0, title: 1, price: 2 } }).expect(200);
    await agency.client.post(`/api/v1/jobs/${jobId}/validate`).expect(200);

    const get = async (query: Record<string, string | number>) =>
      rowsResponse.parse((await agency.client.get(`/api/v1/jobs/${jobId}/rows`).query(query)).body).data;

    expect((await get({ status: 'error' })).items.map((r) => r.sourceIdentifier)).toEqual(['A-2', 'A-3']);
    expect((await get({ search: 'mug' })).items.map((r) => r.sourceIdentifier)).toEqual(['A-1', 'A-3']);
    expect((await get({ field: 'price' })).pagination.totalItems).toBe(2);
    const page2 = await get({ pageSize: 3, page: 2 });
    expect(page2.items.map((r) => r.rowNumber)).toEqual([5]);
    expect(page2.pagination).toMatchObject({ totalItems: 4, totalPages: 2 });
  });

  it('fails the job with a clear message when the file has too many rows', async () => {
    const agency = await agencyWithClient(dbTestApp({ IMPORT_MAX_ROWS: '3' }));
    const csv = ['SKU', 'A', 'B', 'C', 'D', 'E'].join('\n');
    const jobId = await createJob(agency);
    await uploadCsv(agency, jobId, csv).expect(200);
    await agency.client.put(`/api/v1/jobs/${jobId}/mapping`).send({ sheetName: null, headerRow: 1, mapping: { sku: 0 } }).expect(200);

    const res = await agency.client.post(`/api/v1/jobs/${jobId}/validate`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'failed', lastError: expect.stringMatching(/more than 3 product rows/) });
    expect(await CatalogRowModel.countDocuments({ jobId })).toBe(0);
  });

  it('enforces the job lifecycle', async () => {
    const agency = await agencyWithClient(dbTestApp());
    const jobId = await createJob(agency);

    const tooEarly = await agency.client.post(`/api/v1/jobs/${jobId}/validate`);
    expect(tooEarly.status).toBe(409);
    expect((await agency.client.post(`/api/v1/jobs/${jobId}/preview`).send({})).status).toBe(409);

    await CatalogJobModel.updateOne({ _id: jobId }, { status: 'processing' });
    const busy = await uploadCsv(agency, jobId);
    expect(busy.status).toBe(409);
    expect(busy.body.error.message).toMatch(/being enriched/);
  });

  it('re-mapping discards the previous validation results', async () => {
    const agency = await agencyWithClient(dbTestApp());
    const { jobId } = await importedJob(agency);

    const res = await agency.client.put(`/api/v1/jobs/${jobId}/mapping`).send({ sheetName: null, headerRow: 1, mapping: { sku: 0 } });
    expect(res.body.data).toMatchObject({ status: 'uploaded', counts: { totalRows: 0 } });
    expect(await CatalogRowModel.countDocuments({ jobId })).toBe(0);
  });

  it('keeps imported values immutable', async () => {
    const agency = await agencyWithClient(dbTestApp());
    const { jobId } = await importedJob(agency);

    await CatalogRowModel.updateOne({ jobId, rowNumber: 2 }, { $set: { original: { sku: 'CHANGED' }, sourceValues: ['x'] } });
    const row = await CatalogRowModel.findOne({ jobId, rowNumber: 2 }).lean();
    expect(row?.original).toMatchObject({ sku: 'MUG-001' });
    expect(row?.sourceValues[0]).toBe('MUG-001');
  });
});

describe('listing and deleting jobs', () => {
  it('lists jobs newest first, filtered by client and status', async () => {
    const agency = await agencyWithClient(dbTestApp());
    await importedJob(agency);
    await createJob(agency);

    const all = (await agency.client.get('/api/v1/jobs')).body.data;
    expect(all.items.map((job: { status: string }) => job.status)).toEqual(['draft', 'ready']);
    const ready = (await agency.client.get('/api/v1/jobs').query({ status: 'ready', clientId: agency.clientId })).body.data;
    expect(ready.pagination.totalItems).toBe(1);
  });

  it('deletes a job with its rows and file, after which its client can be deleted', async () => {
    const agency = await agencyWithClient(dbTestApp());
    const { jobId } = await importedJob(agency);
    const key = (await CatalogJobModel.findById(jobId).lean())!.originalFile!.storageKey;

    const blocked = await agency.client.delete(`/api/v1/clients/${agency.clientId}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/1 catalogue job/);

    await agency.client.delete(`/api/v1/jobs/${jobId}`).expect(200);
    expect(await CatalogRowModel.countDocuments({ jobId })).toBe(0);
    const files = await readdir(path.join(testStorageDir, 'organizations', agency.organizationId, 'uploads'));
    expect(files).not.toContain(path.basename(key));

    await agency.client.delete(`/api/v1/clients/${agency.clientId}`).expect(200);
  });

  it('includes job figures on the dashboard', async () => {
    const agency = await agencyWithClient(dbTestApp());
    await importedJob(agency);
    const summary = (await agency.client.get('/api/v1/dashboard/summary')).body.data;
    expect(summary.jobs).toEqual({ active: 1, activeLimit: null, needsReview: 0, failed: 0 });
    expect(summary.recentJobs[0]).toMatchObject({ name: 'Spring catalogue', status: 'ready', clientName: 'Kitchen Co' });
  });
});

describe('job permissions', () => {
  it.each<[Role, number]>([
    ['editor', 201],
    ['reviewer', 403],
  ])('%s creating and uploading → %i', async (role, expected) => {
    const app = dbTestApp();
    const owner = await agencyWithClient(app);
    const teammate = await addTeammate(app, owner.organizationId, role);

    const res = await teammate.client.post('/api/v1/jobs').send({ clientId: owner.clientId });
    expect(res.status).toBe(expected);

    const ownersJob = await createJob(owner);
    const upload = await teammate.client.post(`/api/v1/jobs/${ownersJob}/upload`).attach('file', Buffer.from(SAMPLE_CSV), 'x.csv');
    expect(upload.status).toBe(expected === 201 ? 200 : 403);
    expect((await teammate.client.get(`/api/v1/jobs/${ownersJob}`)).status).toBe(200);
  });
});

describe('job tenant isolation', () => {
  it('hides another agency’s jobs, rows and files completely', async () => {
    const app = dbTestApp();
    const agencyA = await agencyWithClient(app);
    const agencyB = await agencyWithClient(app);
    const { jobId } = await importedJob(agencyA);
    const b = agencyB.client;

    const attempts = await Promise.all([
      b.get(`/api/v1/jobs/${jobId}`),
      b.get(`/api/v1/jobs/${jobId}/rows`),
      b.post(`/api/v1/jobs/${jobId}/preview`).send({}),
      b.put(`/api/v1/jobs/${jobId}/mapping`).send({ sheetName: null, headerRow: 1, mapping: { sku: 0 } }),
      b.post(`/api/v1/jobs/${jobId}/validate`),
      b.post(`/api/v1/jobs/${jobId}/upload`).attach('file', Buffer.from('SKU\nX'), 'x.csv'),
      b.delete(`/api/v1/jobs/${jobId}`),
    ]);
    for (const res of attempts) {
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('MUG-001');
    }

    // B can't attach a job to A's client either.
    expect((await b.post('/api/v1/jobs').send({ clientId: agencyA.clientId })).status).toBe(404);
    expect((await b.get('/api/v1/jobs')).body.data.items).toEqual([]);

    // A's job is untouched.
    expect(await CatalogRowModel.countDocuments({ jobId })).toBe(3);
    expect((await CatalogJobModel.findById(jobId).lean())?.status).toBe('ready');
  });
});
