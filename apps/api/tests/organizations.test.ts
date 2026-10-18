import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Role } from '@catalogcraft/shared';
import { UserModel } from '../src/modules/auth/user.model.js';
import { MembershipModel } from '../src/modules/memberships/membership.model.js';
import { OrganizationModel } from '../src/modules/organizations/organization.model.js';
import { addTeammate, browser, connectTestDatabase, dbTestApp, disconnectTestDatabase, newAgency } from './helpers.js';

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);

describe('GET /organizations/current', () => {
  it('returns the signed-in user’s organization', async () => {
    const app = dbTestApp();
    const { client, input, organizationId } = await newAgency(app);

    const res = await client.get('/api/v1/organizations/current');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: organizationId, name: input.organizationName, plan: 'trial' });
  });

  it('requires authentication', async () => {
    expect((await browser(dbTestApp()).get('/api/v1/organizations/current')).status).toBe(401);
  });
});

describe('PATCH /organizations/current', () => {
  it('lets the owner rename the organization', async () => {
    const app = dbTestApp();
    const { client, organizationId } = await newAgency(app);

    const res = await client.patch('/api/v1/organizations/current').send({ name: '  Renamed Agency  ' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Renamed Agency');
    expect((await OrganizationModel.findById(organizationId).lean())?.name).toBe('Renamed Agency');
  });

  it('validates the new name', async () => {
    const { client } = await newAgency(dbTestApp());
    const res = await client.patch('/api/v1/organizations/current').send({ name: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('body.name');
  });

  it.each<[Role, number]>([
    ['admin', 200],
    ['editor', 403],
    ['reviewer', 403],
  ])('enforces role permissions: %s → %i', async (role, expectedStatus) => {
    const app = dbTestApp();
    const { organizationId } = await newAgency(app);
    const teammate = await addTeammate(app, organizationId, role);

    const res = await teammate.client.patch('/api/v1/organizations/current').send({ name: 'Changed By Teammate' });
    expect(res.status).toBe(expectedStatus);
    if (expectedStatus === 403) {
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect((await OrganizationModel.findById(organizationId).lean())?.name).not.toBe('Changed By Teammate');
    }
  });
});

describe('GET /organizations/current/members', () => {
  it('lists members with their roles, without sensitive fields', async () => {
    const app = dbTestApp();
    const owner = await newAgency(app);
    const reviewer = await addTeammate(app, owner.organizationId, 'reviewer');

    const res = await reviewer.client.get('/api/v1/organizations/current/members');
    expect(res.status).toBe(200);
    expect(res.body.data.map((m: { userId: string; role: Role }) => [m.userId, m.role])).toEqual([
      [owner.userId, 'owner'],
      [reviewer.userId, 'reviewer'],
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/);
  });
});

describe('tenant isolation', () => {
  it('never shows one agency another agency’s organization or members', async () => {
    const app = dbTestApp();
    const agencyA = await newAgency(app);
    const agencyB = await newAgency(app);

    const orgSeenByA = await agencyA.client.get('/api/v1/organizations/current');
    const membersSeenByA = await agencyA.client.get('/api/v1/organizations/current/members');

    expect(orgSeenByA.body.data.id).toBe(agencyA.organizationId);
    expect(JSON.stringify(orgSeenByA.body)).not.toContain(agencyB.organizationId);
    expect(membersSeenByA.body.data.map((m: { userId: string }) => m.userId)).toEqual([agencyA.userId]);
  });

  it('ignores organization ids supplied by the browser', async () => {
    const app = dbTestApp();
    const agencyA = await newAgency(app);
    const agencyB = await newAgency(app);

    await agencyA.client
      .patch('/api/v1/organizations/current')
      .query({ organizationId: agencyB.organizationId })
      .send({ name: 'Hijacked', organizationId: agencyB.organizationId })
      .expect(200);

    expect((await OrganizationModel.findById(agencyB.organizationId).lean())?.name).toBe(agencyB.input.organizationName);
    expect((await OrganizationModel.findById(agencyA.organizationId).lean())?.name).toBe('Hijacked');
  });

  it('cuts off access as soon as a membership is removed', async () => {
    const app = dbTestApp();
    const owner = await newAgency(app);
    const editor = await addTeammate(app, owner.organizationId, 'editor');
    expect((await editor.client.get('/api/v1/organizations/current')).status).toBe(200);

    await MembershipModel.deleteOne({ organizationId: owner.organizationId, userId: editor.userId });

    // The editor's session is still valid, but they no longer belong to any organization.
    const res = await editor.client.get('/api/v1/organizations/current');
    expect(res.status).toBe(401);
    expect(await UserModel.exists({ _id: editor.userId })).toBeTruthy();
  });
});
