import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiSuccessResponseSchema, createdInvitationSchema, sessionInfoSchema, usageSummarySchema } from '@catalogcraft/shared';
import { CatalogJobModel } from '../src/modules/catalog-jobs/catalog-job.model.js';
import { EnrichmentWorker } from '../src/modules/enrichment/enrichment.worker.js';
import { MembershipModel } from '../src/modules/memberships/membership.model.js';
import { OrganizationModel } from '../src/modules/organizations/organization.model.js';
import { mergeContentRules } from '../src/modules/organizations/content-rules.js';
import { InvitationModel } from '../src/modules/team/invitation.model.js';
import { addTeammate, browser, connectTestDatabase, dbTestApp, disconnectTestDatabase, newAgency } from './helpers.js';
import { MockAiProvider } from './mock-ai.js';

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);
beforeEach(() => CatalogJobModel.updateMany({ status: { $in: ['queued', 'processing'] } }, { status: 'ready' }));

const invitationResponse = apiSuccessResponseSchema(createdInvitationSchema);
const sessionResponse = apiSuccessResponseSchema(sessionInfoSchema);
const PASSWORD = 'a-long-test-password';

type Agency = Awaited<ReturnType<typeof newAgency>>;

async function invite(agency: Pick<Agency, 'client'>, email: string, role = 'editor') {
  const res = await agency.client.post('/api/v1/organizations/current/invitations').send({ email, role });
  return res.status === 201 ? { res, ...invitationResponse.parse(res.body).data } : { res, token: '', invitation: null };
}

describe('invitations', () => {
  it('lets someone new create an account from the link and join with the invited role', async () => {
    const app = dbTestApp();
    const owner = await newAgency(app, { plan: 'agency' });
    const { res, token, invitation } = await invite(owner, 'New.Person@Example.test');
    expect(res.status).toBe(201);
    expect(invitation).toMatchObject({ email: 'new.person@example.test', role: 'editor', invitedBy: { id: owner.userId } });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Only a hash is stored, never the token itself.
    expect(JSON.stringify(await InvitationModel.find().lean())).not.toContain(token);

    const listed = await owner.client.get('/api/v1/organizations/current/invitations');
    expect(listed.body.data.map((i: { email: string }) => i.email)).toContain('new.person@example.test');

    const visitor = browser(app);
    const preview = await visitor.get(`/api/v1/invitations/${token}`);
    expect(preview.status).toBe(200);
    expect(preview.body.data).toMatchObject({ organizationName: owner.input.organizationName, role: 'editor', status: 'pending' });

    const joined = await visitor.post(`/api/v1/invitations/${token}/register`).send({ name: 'New Person', password: PASSWORD });
    expect(joined.status).toBe(201);
    const session = sessionResponse.parse(joined.body).data;
    expect(session).toMatchObject({ organization: { id: owner.organizationId }, role: 'editor', user: { email: 'new.person@example.test' } });
    expect(session.organizations).toHaveLength(1); // no extra organization was created
    expect((await visitor.get('/api/v1/clients')).status).toBe(200);

    // The link works once only.
    expect((await visitor.get(`/api/v1/invitations/${token}`)).body.data.status).toBe('accepted');
    const again = await browser(app).post(`/api/v1/invitations/${token}/register`).send({ name: 'Someone', password: PASSWORD });
    expect(again.status).toBe(409);
    expect((await owner.client.get('/api/v1/organizations/current/invitations')).body.data).toEqual([]);
  });

  it('lets an existing user accept while signed in, but only with the invited email', async () => {
    const app = dbTestApp();
    const owner = await newAgency(app, { plan: 'agency' });
    const existing = await newAgency(app);
    const stranger = await newAgency(app);
    const { token } = await invite(owner, existing.input.email, 'reviewer');

    const wrong = await stranger.client.post(`/api/v1/invitations/${token}/accept`);
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.message).toContain(existing.input.email.toLowerCase());

    const accepted = await existing.client.post(`/api/v1/invitations/${token}/accept`);
    expect(accepted.status).toBe(200);
    const session = sessionResponse.parse(accepted.body).data;
    expect(session).toMatchObject({ organization: { id: owner.organizationId }, role: 'reviewer' });
    expect(session.organizations.map((o) => o.id).sort()).toEqual([owner.organizationId, existing.organizationId].sort());
    expect((await existing.client.post(`/api/v1/invitations/${token}/accept`)).status).toBe(409);
  });

  it('lets an existing account sign in from the link with its password', async () => {
    const app = dbTestApp();
    const owner = await newAgency(app, { plan: 'agency' });
    const existing = await newAgency(app);
    // An account that no longer belongs to any organization can't use the normal sign-in…
    await MembershipModel.deleteMany({ userId: existing.userId });
    const login = await browser(app).post('/api/v1/auth/login').send({ email: existing.input.email, password: PASSWORD });
    expect(login.status).toBe(403);

    // …but can join from an invitation.
    const { token } = await invite(owner, existing.input.email);
    const visitor = browser(app);
    expect((await visitor.post(`/api/v1/invitations/${token}/sign-in`).send({ password: 'wrong-password' })).status).toBe(401);
    const joined = await visitor.post(`/api/v1/invitations/${token}/sign-in`).send({ password: PASSWORD });
    expect(joined.status).toBe(200);
    expect(joined.body.data).toMatchObject({ organization: { id: owner.organizationId }, role: 'editor' });
  });

  it('refuses register-from-invite for an email that already has an account', async () => {
    const app = dbTestApp();
    const owner = await newAgency(app, { plan: 'agency' });
    const existing = await newAgency(app);
    const { token } = await invite(owner, existing.input.email);
    const res = await browser(app).post(`/api/v1/invitations/${token}/register`).send({ name: 'Copy', password: PASSWORD });
    expect(res.status).toBe(409);
    expect((await browser(app).get(`/api/v1/invitations/${token}`)).body.data.status).toBe('pending');
  });

  it('stops cancelled, replaced and expired links from working', async () => {
    const app = dbTestApp();
    const owner = await newAgency(app, { plan: 'agency' });
    const first = await invite(owner, 'person@example.test');
    const second = await invite(owner, 'person@example.test'); // re-inviting replaces the first link
    expect((await browser(app).get(`/api/v1/invitations/${first.token}`)).body.data.status).toBe('revoked');

    expect((await owner.client.delete(`/api/v1/organizations/current/invitations/${second.invitation!.id}`)).status).toBe(200);
    const revoked = await browser(app).post(`/api/v1/invitations/${second.token}/register`).send({ name: 'Person', password: PASSWORD });
    expect(revoked.status).toBe(409);
    expect(revoked.body.error.message).toMatch(/cancelled/);

    const third = await invite(owner, 'late@example.test');
    await InvitationModel.updateOne({ _id: third.invitation!.id }, { expiresAt: new Date(Date.now() - 1000) });
    expect((await browser(app).get(`/api/v1/invitations/${third.token}`)).body.data.status).toBe('expired');
    const expired = await browser(app).post(`/api/v1/invitations/${third.token}/register`).send({ name: 'Late', password: PASSWORD });
    expect(expired.status).toBe(409);
    expect(expired.body.error.message).toMatch(/expired/);
  });

  it('rejects malformed and unknown tokens', async () => {
    const app = dbTestApp();
    expect((await browser(app).get('/api/v1/invitations/not-a-token')).status).toBe(400);
    expect((await browser(app).get(`/api/v1/invitations/${'A'.repeat(43)}`)).status).toBe(404);
  });

  it('counts members and pending invitations against the plan’s user limit', async () => {
    const app = dbTestApp();
    const trial = await newAgency(app); // trial: 1 user
    const blocked = await invite(trial, 'x@example.test');
    expect(blocked.res.status).toBe(403);
    expect(blocked.res.body.error.code).toBe('PLAN_LIMIT_REACHED');

    const agency = await newAgency(app, { plan: 'agency' }); // agency: 3 users
    const one = await invite(agency, 'one@example.test');
    expect((await invite(agency, 'two@example.test')).res.status).toBe(201);
    expect((await invite(agency, 'three@example.test')).res.status).toBe(403);

    // A downgrade after inviting is caught when the link is used.
    await OrganizationModel.updateOne({ _id: agency.organizationId }, { plan: 'solo' });
    const late = await browser(app).post(`/api/v1/invitations/${one.token}/register`).send({ name: 'One', password: PASSWORD });
    expect(late.status).toBe(403);
    expect(late.body.error.code).toBe('PLAN_LIMIT_REACHED');
  });

  it('enforces who may invite whom', async () => {
    const app = dbTestApp();
    const owner = await newAgency(app, { plan: 'studio' });
    const admin = await addTeammate(app, owner.organizationId, 'admin');
    const editor = await addTeammate(app, owner.organizationId, 'editor');

    expect((await invite(editor, 'a@example.test')).res.status).toBe(403);
    expect((await editor.client.get('/api/v1/organizations/current/invitations')).status).toBe(403);
    expect((await invite(admin, 'b@example.test', 'admin')).res.status).toBe(403);
    expect((await invite(admin, 'b@example.test', 'reviewer')).res.status).toBe(201);
    expect((await invite(owner, 'c@example.test', 'admin')).res.status).toBe(201);
    expect((await invite(owner, 'd@example.test', 'owner')).res.status).toBe(400);
    expect((await invite(owner, editor.email, 'editor')).res.status).toBe(409); // already a member
  });
});

describe('member management', () => {
  async function team() {
    const app = dbTestApp();
    const owner = await newAgency(app, { plan: 'studio' });
    const admin = await addTeammate(app, owner.organizationId, 'admin');
    const editor = await addTeammate(app, owner.organizationId, 'editor');
    const members = (await owner.client.get('/api/v1/organizations/current/members')).body.data as { userId: string; membershipId: string }[];
    const id = (userId: string) => members.find((m) => m.userId === userId)!.membershipId;
    return { app, owner, admin, editor, ids: { owner: id(owner.userId), admin: id(admin.userId), editor: id(editor.userId) } };
  }
  const patchRole = (who: { client: Agency['client'] }, membershipId: string, role: string) =>
    who.client.patch(`/api/v1/organizations/current/members/${membershipId}`).send({ role });

  it('lets the owner change roles, and the change applies on the next request', async () => {
    const { owner, editor, ids } = await team();
    expect((await editor.client.get('/api/v1/usage')).status).toBe(403);
    expect((await patchRole(owner, ids.editor, 'admin')).status).toBe(200);
    expect((await editor.client.get('/api/v1/me')).body.data.role).toBe('admin');
    expect((await editor.client.get('/api/v1/usage')).status).toBe(200);
  });

  it('protects the owner, admins and your own role', async () => {
    const { owner, admin, editor, ids } = await team();
    expect((await patchRole(owner, ids.owner, 'admin')).status).toBe(403);
    expect((await patchRole(admin, ids.owner, 'reviewer')).status).toBe(403);
    expect((await patchRole(admin, ids.admin, 'editor')).status).toBe(403); // own role
    expect((await patchRole(admin, ids.editor, 'admin')).status).toBe(403); // only the owner grants admin
    expect((await patchRole(admin, ids.editor, 'reviewer')).status).toBe(200);
    expect((await patchRole(editor, ids.admin, 'reviewer')).status).toBe(403);
    expect((await patchRole(owner, ids.editor, 'owner')).status).toBe(400);
  });

  it('removes members, lets people leave, and the owner stays', async () => {
    const { owner, admin, editor, ids } = await team();
    expect((await editor.client.delete(`/api/v1/organizations/current/members/${ids.admin}`)).status).toBe(403);
    expect((await admin.client.delete(`/api/v1/organizations/current/members/${ids.owner}`)).status).toBe(403);
    expect((await owner.client.delete(`/api/v1/organizations/current/members/${ids.owner}`)).status).toBe(403); // owner can't leave

    expect((await admin.client.delete(`/api/v1/organizations/current/members/${ids.editor}`)).status).toBe(200);
    // Removal is immediate: the editor belonged nowhere else, so their session ends.
    expect((await editor.client.get('/api/v1/clients')).status).toBe(401);

    expect((await admin.client.delete(`/api/v1/organizations/current/members/${ids.admin}`)).status).toBe(200); // leaving
    expect((await admin.client.get('/api/v1/me')).status).toBe(401);
    const left = (await owner.client.get('/api/v1/organizations/current/members')).body.data;
    expect(left).toHaveLength(1);
  });

  it('keeps another agency out of members and invitations', async () => {
    const { app, owner, ids } = await team();
    const pending = await invite(owner, 'pending@example.test');
    const other = await newAgency(app, { plan: 'studio' });

    expect((await patchRole(other, ids.editor, 'reviewer')).status).toBe(404);
    expect((await other.client.delete(`/api/v1/organizations/current/members/${ids.editor}`)).status).toBe(404);
    expect((await other.client.delete(`/api/v1/organizations/current/invitations/${pending.invitation!.id}`)).status).toBe(404);
    expect((await other.client.get('/api/v1/organizations/current/invitations')).body.data).toEqual([]);
    expect(await MembershipModel.countDocuments({ organizationId: owner.organizationId })).toBe(3);
  });
});

describe('switching organization', () => {
  it('switches only into organizations the user belongs to', async () => {
    const app = dbTestApp();
    const owner = await newAgency(app, { plan: 'agency' });
    const user = await newAgency(app);
    const stranger = await newAgency(app);
    const { token } = await invite(owner, user.input.email);
    await user.client.post(`/api/v1/invitations/${token}/accept`).expect(200);

    const back = await user.client.post('/api/v1/auth/switch-organization').send({ organizationId: user.organizationId });
    expect(back.status).toBe(200);
    expect(back.body.data).toMatchObject({ organization: { id: user.organizationId }, role: 'owner' });
    expect((await user.client.get('/api/v1/organizations/current')).body.data.id).toBe(user.organizationId);

    const denied = await user.client.post('/api/v1/auth/switch-organization').send({ organizationId: stranger.organizationId });
    expect(denied.status).toBe(404);
    expect((await user.client.post('/api/v1/auth/switch-organization').send({ organizationId: 'nope' })).status).toBe(400);
    expect((await browser(app).post('/api/v1/auth/switch-organization').send({ organizationId: owner.organizationId })).status).toBe(401);
  });
});

describe('agency content rules', () => {
  it('are saved by owners and admins only', async () => {
    const app = dbTestApp();
    const owner = await newAgency(app);
    const editor = await addTeammate(app, owner.organizationId, 'editor');

    const res = await owner.client.patch('/api/v1/organizations/current').send({ contentRules: { prohibitedClaims: [' guaranteed ', 'cures'] } });
    expect(res.status).toBe(200);
    expect(res.body.data.contentRules).toEqual({ prohibitedClaims: ['guaranteed', 'cures'] });
    const denied = await editor.client.patch('/api/v1/organizations/current').send({ contentRules: { prohibitedClaims: [] } });
    expect(denied.status).toBe(403);
    expect((await owner.client.patch('/api/v1/organizations/current').send({})).status).toBe(400);
  });

  it('merge with a client’s own rules without duplicates', () => {
    const brand = mergeContentRules(
      { brandTone: '', targetAudience: '', preferredTerminology: [], prohibitedClaims: ['Eco-friendly'], defaultLanguage: 'en', maxTitleLength: 150 },
      ['eco-friendly', 'guaranteed'],
    );
    expect(brand.prohibitedClaims).toEqual(['Eco-friendly', 'guaranteed']);
  });

  it('reach the AI prompt, the guardrails and reviewer edits for every client', async () => {
    const provider = new MockAiProvider((request) =>
      MockAiProvider.answer({ title: request.user.includes('Mug') ? 'Guaranteed best mug' : 'Stoneware plate', missingFacts: [], warnings: [] }),
    );
    const app = dbTestApp({}, { ai: provider });
    const agency = await newAgency(app, { plan: 'agency' });
    await agency.client.patch('/api/v1/organizations/current').send({ contentRules: { prohibitedClaims: ['guaranteed'] } }).expect(200);
    const clientId = (await agency.client.post('/api/v1/clients').send({ name: 'Mugs Ltd' }).expect(201)).body.data.id as string;
    const jobId = (await agency.client.post('/api/v1/jobs').send({ clientId, name: 'Mugs' }).expect(201)).body.data.id as string;
    await agency.client.post(`/api/v1/jobs/${jobId}/upload`).attach('file', Buffer.from('SKU,Name\nM-1,Mug\nP-1,Plate\n'), 'mugs.csv').expect(200);
    await agency.client.put(`/api/v1/jobs/${jobId}/mapping`).send({ sheetName: null, headerRow: 1, mapping: { sku: 0, title: 1 } }).expect(200);
    await agency.client.post(`/api/v1/jobs/${jobId}/validate`).expect(200);
    await agency.client.post(`/api/v1/jobs/${jobId}/enrich`).send({ fields: ['title'] }).expect(202);
    await new EnrichmentWorker({ provider, logger: pino({ level: 'silent' }), concurrency: 1 }).runOnce();

    expect(provider.requests[0]!.user).toContain('guaranteed');
    const rows = (await agency.client.get(`/api/v1/jobs/${jobId}/rows?suggestion=any`)).body.data.items as { id: string; sourceIdentifier: string; suggestions: { warnings: string[] }[] }[];
    const row = rows.find((r) => r.sourceIdentifier === 'M-1')!;
    expect(row.suggestions[0]).toMatchObject({ field: 'title', status: 'failed' });
    expect(row.suggestions[0]!.warnings[0]).toContain('guaranteed');

    const edit = await agency.client.patch(`/api/v1/jobs/${jobId}/rows/${row.id}`).send({ field: 'title', action: 'edit', value: 'Guaranteed mug' });
    expect(edit.status).toBe(400);
    expect((await agency.client.patch(`/api/v1/jobs/${jobId}/rows/${row.id}`).send({ field: 'title', action: 'edit', value: 'Stoneware mug' })).status).toBe(200);
  });
});

describe('plan limits in usage', () => {
  it('reports workspaces, seats and active jobs against the plan', async () => {
    const app = dbTestApp();
    const agency = await newAgency(app, { plan: 'agency' });
    const clientId = (await agency.client.post('/api/v1/clients').send({ name: 'One' }).expect(201)).body.data.id as string;
    await agency.client.post('/api/v1/jobs').send({ clientId, name: 'Draft job' }).expect(201);
    await invite(agency, 'seat@example.test');

    const usage = apiSuccessResponseSchema(usageSummarySchema).parse((await agency.client.get('/api/v1/usage')).body).data;
    expect(usage.limits).toEqual({
      clientWorkspaces: { used: 1, limit: null },
      members: { used: 2, limit: 3 },
      activeJobs: { used: 1, limit: null },
    });
  });
});
