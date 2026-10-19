import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiSuccessResponseSchema,
  clientListSchema,
  clientSchema,
  DEFAULT_BRAND_PROFILE,
  dashboardSummarySchema,
  type Role,
} from '@catalogcraft/shared';
import { ClientModel } from '../src/modules/clients/client.model.js';
import { OrganizationModel } from '../src/modules/organizations/organization.model.js';
import { addTeammate, browser, connectTestDatabase, dbTestApp, disconnectTestDatabase, newAgency } from './helpers.js';

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);

const clientResponse = apiSuccessResponseSchema(clientSchema);
const listResponse = apiSuccessResponseSchema(clientListSchema);

const brandProfile = {
  brandTone: 'Friendly and precise',
  targetAudience: 'Home bakers',
  preferredTerminology: ['stand mixer'],
  prohibitedClaims: ['professional grade'],
  defaultLanguage: 'en-GB',
  maxTitleLength: 90,
};

describe('POST /clients', () => {
  it('creates a client with the full brand profile', async () => {
    const { client } = await newAgency(dbTestApp());
    const res = await client
      .post('/api/v1/clients')
      .send({ name: '  Bake Supply Co  ', internalReference: 'BS-1', brandProfile });

    expect(res.status).toBe(201);
    const { data } = clientResponse.parse(res.body);
    expect(data).toMatchObject({ name: 'Bake Supply Co', internalReference: 'BS-1', brandProfile });
  });

  it('applies brand profile defaults', async () => {
    const { client } = await newAgency(dbTestApp());
    const res = await client.post('/api/v1/clients').send({ name: 'Defaults Ltd' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ internalReference: null, brandProfile: DEFAULT_BRAND_PROFILE });
  });

  it('stores the client under the caller’s organization, ignoring any organizationId sent', async () => {
    const app = dbTestApp();
    const agencyA = await newAgency(app);
    const agencyB = await newAgency(app);

    const res = await agencyA.client
      .post('/api/v1/clients')
      .send({ name: 'Smuggled', organizationId: agencyB.organizationId });

    const stored = await ClientModel.findById(res.body.data.id).lean();
    expect(stored?.organizationId.toString()).toBe(agencyA.organizationId);
  });

  it('reports field-level validation errors', async () => {
    const { client } = await newAgency(dbTestApp());
    const res = await client
      .post('/api/v1/clients')
      .send({ name: '', brandProfile: { defaultLanguage: 'xx', maxTitleLength: 5, prohibitedClaims: [''] } });

    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual([
      'body.brandProfile.defaultLanguage',
      'body.brandProfile.maxTitleLength',
      'body.brandProfile.prohibitedClaims.0',
      'body.name',
    ]);
  });

  it('rejects a duplicate name within the organization, ignoring case', async () => {
    const { client } = await newAgency(dbTestApp(), { plan: 'agency' });
    await client.post('/api/v1/clients').send({ name: 'Acme' }).expect(201);

    const res = await client.post('/api/v1/clients').send({ name: 'ACME' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('allows the same client name in different organizations', async () => {
    const app = dbTestApp();
    await (await newAgency(app)).client.post('/api/v1/clients').send({ name: 'Shared Name' }).expect(201);
    await (await newAgency(app)).client.post('/api/v1/clients').send({ name: 'Shared Name' }).expect(201);
  });
});

describe('plan limits', () => {
  it('stops a trial organization at one client workspace until the plan changes', async () => {
    const { client, organizationId } = await newAgency(dbTestApp());
    await client.post('/api/v1/clients').send({ name: 'First' }).expect(201);

    const blocked = await client.post('/api/v1/clients').send({ name: 'Second' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PLAN_LIMIT_REACHED');
    expect(await ClientModel.countDocuments({ organizationId })).toBe(1);

    await OrganizationModel.updateOne({ _id: organizationId }, { plan: 'agency' });
    await client.post('/api/v1/clients').send({ name: 'Second' }).expect(201);
  });

  it('reports usage against the limit in the client list', async () => {
    const { client } = await newAgency(dbTestApp());
    await client.post('/api/v1/clients').send({ name: 'Only' }).expect(201);

    const res = await client.get('/api/v1/clients');
    expect(listResponse.parse(res.body).data.allowance).toEqual({ used: 1, limit: 1 });
  });
});

describe('GET /clients', () => {
  it('paginates, sorts by name and searches literally', async () => {
    const { client } = await newAgency(dbTestApp(), { plan: 'agency' });
    for (const name of ['Delta', 'alpha', 'Charlie', 'Bravo', 'a.c (dots)']) {
      await client.post('/api/v1/clients').send({ name }).expect(201);
    }

    const page1 = listResponse.parse((await client.get('/api/v1/clients').query({ pageSize: 2 })).body).data;
    expect(page1.items.map((c) => c.name)).toEqual(['a.c (dots)', 'alpha']);
    expect(page1.pagination).toEqual({ page: 1, pageSize: 2, totalItems: 5, totalPages: 3 });

    const page3 = listResponse.parse((await client.get('/api/v1/clients').query({ pageSize: 2, page: 3 })).body).data;
    expect(page3.items.map((c) => c.name)).toEqual(['Delta']);

    // "a.c" must match the literal text, not "a<any character>c" as a regex would.
    const search = listResponse.parse((await client.get('/api/v1/clients').query({ search: 'a.c' })).body).data;
    expect(search.items.map((c) => c.name)).toEqual(['a.c (dots)']);
    expect(search.pagination.totalItems).toBe(1);
  });

  it('rejects invalid query parameters', async () => {
    const { client } = await newAgency(dbTestApp());
    const res = await client.get('/api/v1/clients').query({ pageSize: 1000 });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('query.pageSize');
  });
});

describe('GET/PATCH/DELETE /clients/:clientId', () => {
  it('reads, partially updates and deletes a client', async () => {
    const { client } = await newAgency(dbTestApp());
    const created = (await client.post('/api/v1/clients').send({ name: 'Edit Me', internalReference: 'R-1', brandProfile }))
      .body.data;

    expect((await client.get(`/api/v1/clients/${created.id}`)).body.data.name).toBe('Edit Me');

    const patched = await client
      .patch(`/api/v1/clients/${created.id}`)
      .send({ internalReference: null, brandProfile: { brandTone: 'Bolder' } });
    expect(patched.status).toBe(200);
    expect(patched.body.data).toMatchObject({
      name: 'Edit Me',
      internalReference: null,
      // Only brandTone changed; every other brand field is untouched.
      brandProfile: { ...brandProfile, brandTone: 'Bolder' },
    });

    expect((await client.delete(`/api/v1/clients/${created.id}`)).status).toBe(200);
    expect((await client.get(`/api/v1/clients/${created.id}`)).status).toBe(404);
  });

  it('rejects an empty update and malformed ids', async () => {
    const { client } = await newAgency(dbTestApp());
    const created = (await client.post('/api/v1/clients').send({ name: 'X' })).body.data;

    expect((await client.patch(`/api/v1/clients/${created.id}`).send({})).status).toBe(400);
    const badId = await client.get('/api/v1/clients/not-an-id');
    expect(badId.status).toBe(400);
    expect(badId.body.error.details[0].path).toBe('params.clientId');
  });

  it('returns 404 for a well-formed id that does not exist', async () => {
    const { client } = await newAgency(dbTestApp());
    expect((await client.get('/api/v1/clients/64b7f0c2a1b2c3d4e5f60718')).status).toBe(404);
  });

  it('refuses a rename that clashes with another client', async () => {
    const { client } = await newAgency(dbTestApp(), { plan: 'agency' });
    await client.post('/api/v1/clients').send({ name: 'Taken' }).expect(201);
    const other = (await client.post('/api/v1/clients').send({ name: 'Other' })).body.data;

    const res = await client.patch(`/api/v1/clients/${other.id}`).send({ name: 'taken' });
    expect(res.status).toBe(409);
  });
});

describe('client permissions', () => {
  it.each<[Role, { read: number; write: number }]>([
    ['admin', { read: 200, write: 201 }],
    ['editor', { read: 200, write: 403 }],
    ['reviewer', { read: 200, write: 403 }],
  ])('%s: can read, write only if allowed', async (role, expected) => {
    const app = dbTestApp();
    const owner = await newAgency(app, { plan: 'agency' });
    const existing = (await owner.client.post('/api/v1/clients').send({ name: 'Existing' })).body.data;
    const teammate = await addTeammate(app, owner.organizationId, role);

    expect((await teammate.client.get('/api/v1/clients')).status).toBe(expected.read);
    expect((await teammate.client.get(`/api/v1/clients/${existing.id}`)).status).toBe(expected.read);
    expect((await teammate.client.post('/api/v1/clients').send({ name: `By ${role}` })).status).toBe(expected.write);

    const writeOk = expected.write === 201 ? 200 : 403;
    expect((await teammate.client.patch(`/api/v1/clients/${existing.id}`).send({ name: 'Renamed' })).status).toBe(
      writeOk,
    );
    expect((await teammate.client.delete(`/api/v1/clients/${existing.id}`)).status).toBe(writeOk);
  });
});

describe('client tenant isolation', () => {
  it('treats another agency’s client as non-existent, even with its exact id', async () => {
    const app = dbTestApp();
    const agencyA = await newAgency(app);
    const agencyB = await newAgency(app);
    const bClient = (await agencyB.client.post('/api/v1/clients').send({ name: 'B Secret Client', brandProfile }))
      .body.data;

    const read = await agencyA.client.get(`/api/v1/clients/${bClient.id}`);
    const update = await agencyA.client.patch(`/api/v1/clients/${bClient.id}`).send({ name: 'Hacked' });
    const remove = await agencyA.client.delete(`/api/v1/clients/${bClient.id}`);

    for (const res of [read, update, remove]) {
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('B Secret Client');
    }

    const list = listResponse.parse((await agencyA.client.get('/api/v1/clients')).body).data;
    expect(list.items).toEqual([]);
    expect(list.allowance.used).toBe(0);

    // B's client is completely untouched.
    const stored = await ClientModel.findById(bClient.id).lean();
    expect(stored?.name).toBe('B Secret Client');
  });

  it('keeps the dashboard summary scoped to the caller’s organization', async () => {
    const app = dbTestApp();
    const agencyA = await newAgency(app);
    const agencyB = await newAgency(app);
    await agencyB.client.post('/api/v1/clients').send({ name: 'B Only' }).expect(201);

    const summary = apiSuccessResponseSchema(dashboardSummarySchema).parse(
      (await agencyA.client.get('/api/v1/dashboard/summary')).body,
    ).data;
    expect(summary).toEqual({
      plan: 'trial',
      clients: { used: 0, limit: 1 },
      recentClients: [],
      products: { used: 0, limit: 25 },
      jobs: { active: 0, activeLimit: 1, needsReview: 0, failed: 0 },
      recentJobs: [],
      recentExports: [],
    });
  });
});

describe('GET /dashboard/summary', () => {
  it('lists the most recently updated clients first', async () => {
    const { client } = await newAgency(dbTestApp(), { plan: 'agency' });
    const first = (await client.post('/api/v1/clients').send({ name: 'First' })).body.data;
    await client.post('/api/v1/clients').send({ name: 'Second' }).expect(201);
    await client.patch(`/api/v1/clients/${first.id}`).send({ brandProfile: { brandTone: 'Updated' } }).expect(200);

    const summary = (await client.get('/api/v1/dashboard/summary')).body.data;
    expect(summary.plan).toBe('agency');
    expect(summary.clients).toEqual({ used: 2, limit: null });
    expect(summary.recentClients.map((c: { name: string }) => c.name)).toEqual(['First', 'Second']);
  });

  it('requires authentication', async () => {
    expect((await browser(dbTestApp()).get('/api/v1/dashboard/summary')).status).toBe(401);
  });
});
