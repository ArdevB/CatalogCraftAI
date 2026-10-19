import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EXPORT_RETENTION_DAYS } from '@catalogcraft/shared';
import { AuditLogModel } from '../src/modules/audit/audit-log.model.js';
import { UserModel } from '../src/modules/auth/user.model.js';
import { CatalogJobModel } from '../src/modules/catalog-jobs/catalog-job.model.js';
import { CatalogRowModel } from '../src/modules/catalog-rows/catalog-row.model.js';
import { ClientModel } from '../src/modules/clients/client.model.js';
import { ExportModel } from '../src/modules/exports/export.model.js';
import { MembershipModel } from '../src/modules/memberships/membership.model.js';
import { OrganizationModel } from '../src/modules/organizations/organization.model.js';
import { sweepExpiredExports } from '../src/modules/retention/retention.js';
import { InvitationModel } from '../src/modules/team/invitation.model.js';
import {
  addTeammate,
  browser,
  connectTestDatabase,
  dbTestApp,
  disconnectTestDatabase,
  newAgency,
  testStorage,
  testStorageDir,
} from './helpers.js';

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);
beforeEach(() => CatalogJobModel.updateMany({ status: { $in: ['queued', 'processing'] } }, { status: 'ready' }));

type Agency = Awaited<ReturnType<typeof newAgency>>;

/** A client with one validated, exported job — so the organization has rows and files on disk. */
async function agencyWithData(app: ReturnType<typeof dbTestApp>) {
  const agency = await newAgency(app, { plan: 'agency' });
  const clientId = (await agency.client.post('/api/v1/clients').send({ name: 'Kitchen Co' }).expect(201)).body.data.id as string;
  const jobId = (await agency.client.post('/api/v1/jobs').send({ clientId }).expect(201)).body.data.id as string;
  await agency.client.post(`/api/v1/jobs/${jobId}/upload`).attach('file', Buffer.from('SKU,Price\nA,1\nB,2'), 'p.csv').expect(200);
  await agency.client.put(`/api/v1/jobs/${jobId}/mapping`).send({ sheetName: null, headerRow: 1, mapping: { sku: 0, price: 1 } }).expect(200);
  await agency.client.post(`/api/v1/jobs/${jobId}/validate`).expect(200);
  const exportId = (await agency.client.post(`/api/v1/jobs/${jobId}/export`).send({ fields: ['sku', 'price'] }).expect(201)).body.data.id as string;
  return { ...agency, clientId, jobId, exportId };
}

const filesOf = (organizationId: string) =>
  readdir(path.join(testStorageDir, 'organizations', organizationId), { recursive: true, withFileTypes: true })
    .then((entries) => entries.filter((entry) => entry.isFile()).map((entry) => entry.name))
    .catch(() => [] as string[]);

const deleteOrg = (agency: Pick<Agency, 'client'>, confirmName: string) =>
  agency.client.delete('/api/v1/organizations/current').send({ confirmName });

describe('deleting an organization', () => {
  it('removes everything the organization owns, and nothing else', async () => {
    const app = dbTestApp();
    const owner = await agencyWithData(app);
    const editor = await addTeammate(app, owner.organizationId, 'editor');
    await owner.client.post('/api/v1/organizations/current/invitations').send({ email: 'later@example.test', role: 'reviewer' }).expect(201);
    const other = await agencyWithData(app);
    expect((await filesOf(owner.organizationId)).length).toBe(2); // the upload and the export

    const res = await deleteOrg(owner, owner.input.organizationName);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull(); // the owner belonged nowhere else, so they are signed out

    const organizationId = owner.organizationId;
    for (const Model of [CatalogRowModel, CatalogJobModel, ExportModel, ClientModel, InvitationModel, AuditLogModel, MembershipModel]) {
      expect(await (Model as typeof ClientModel).countDocuments({ organizationId })).toBe(0);
    }
    expect(await OrganizationModel.exists({ _id: organizationId })).toBeNull();
    expect(await filesOf(organizationId)).toEqual([]);

    // Members lose access at once; their accounts are kept.
    expect((await editor.client.get('/api/v1/clients')).status).toBe(401);
    expect((await owner.client.get('/api/v1/me')).status).toBe(401);
    expect(await UserModel.exists({ _id: owner.userId })).not.toBeNull();

    // The other agency is untouched.
    expect((await other.client.get(`/api/v1/jobs/${other.jobId}`)).status).toBe(200);
    expect((await other.client.get(`/api/v1/exports/${other.exportId}/download`)).status).toBe(200);
    expect((await filesOf(other.organizationId)).length).toBe(2);
  });

  it('keeps an owner who belongs elsewhere signed in, in their other organization', async () => {
    const app = dbTestApp();
    const owner = await newAgency(app);
    const second = await newAgency(app);
    await MembershipModel.create({ organizationId: second.organizationId, userId: owner.userId, role: 'editor' });

    const res = await deleteOrg(owner, owner.input.organizationName);
    expect(res.status).toBe(200);
    expect(res.body.data.organization.id).toBe(second.organizationId);
    expect((await owner.client.get('/api/v1/me')).body.data.role).toBe('editor');
  });

  it('needs the exact name, the owner role and no running work', async () => {
    const app = dbTestApp();
    const owner = await agencyWithData(app);
    const admin = await addTeammate(app, owner.organizationId, 'admin');

    const wrong = await deleteOrg(owner, 'Not the name');
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.details[0].path).toBe('body.confirmName');
    expect((await owner.client.delete('/api/v1/organizations/current').send({})).status).toBe(400);
    expect((await deleteOrg(admin, owner.input.organizationName)).status).toBe(403);

    await CatalogJobModel.updateOne({ _id: owner.jobId }, { status: 'queued' });
    expect((await deleteOrg(owner, owner.input.organizationName)).status).toBe(409);
    await CatalogJobModel.updateOne({ _id: owner.jobId }, { status: 'completed' });

    expect(await OrganizationModel.exists({ _id: owner.organizationId })).not.toBeNull();
    expect((await deleteOrg(owner, owner.input.organizationName)).status).toBe(200);
  });

  it('can only ever delete the caller’s own organization', async () => {
    const app = dbTestApp();
    const victim = await agencyWithData(app);
    const attacker = await newAgency(app);
    // There is no id in the URL to swap: the attacker can only name their own organization.
    expect((await deleteOrg(attacker, victim.input.organizationName)).status).toBe(400);
    expect(await ClientModel.countDocuments({ organizationId: victim.organizationId })).toBe(1);
  });
});

describe('deleting your account', () => {
  it('lets a member delete their account after confirming the password', async () => {
    const app = dbTestApp();
    const owner = await newAgency(app, { plan: 'agency' });
    const editor = await addTeammate(app, owner.organizationId, 'editor');

    const wrong = await editor.client.delete('/api/v1/me').send({ password: 'not-my-password' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.details[0].path).toBe('body.password');
    expect((await editor.client.get('/api/v1/me')).status).toBe(200); // still signed in

    const res = await editor.client.delete('/api/v1/me').send({ password: 'a-long-test-password' });
    expect(res.status).toBe(200);
    expect(await UserModel.exists({ _id: editor.userId })).toBeNull();
    expect(await MembershipModel.countDocuments({ userId: editor.userId })).toBe(0);
    expect((await editor.client.get('/api/v1/me')).status).toBe(401);
    expect((await browser(app).post('/api/v1/auth/login').send({ email: editor.email, password: 'a-long-test-password' })).status).toBe(401);
  });

  it('is refused while you own an organization', async () => {
    const app = dbTestApp();
    const owner = await newAgency(app);
    const res = await owner.client.delete('/api/v1/me').send({ password: 'a-long-test-password' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain(owner.input.organizationName);
    expect(await UserModel.exists({ _id: owner.userId })).not.toBeNull();
  });

  it('requires being signed in', async () => {
    expect((await browser(dbTestApp()).delete('/api/v1/me').send({ password: 'whatever-password' })).status).toBe(401);
  });
});

describe('retention', () => {
  it('deletes export files after the retention period, keeping the job’s data', async () => {
    const app = dbTestApp();
    const agency = await agencyWithData(app);
    const recent = (await agency.client.post(`/api/v1/jobs/${agency.jobId}/export`).send({ fields: ['sku', 'price'] }).expect(201)).body.data;
    expect(new Date(recent.expiresAt).getTime() - new Date(recent.createdAt).getTime()).toBe(EXPORT_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const old = new Date(Date.now() - (EXPORT_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000);
    await ExportModel.collection.updateOne({ _id: (await ExportModel.findById(agency.exportId))!._id }, { $set: { createdAt: old } });
    const oldKey = (await ExportModel.findById(agency.exportId).lean())!.storageKey;

    expect(await sweepExpiredExports(testStorage)).toBeGreaterThanOrEqual(1);
    expect(await ExportModel.exists({ _id: agency.exportId })).toBeNull();
    await expect(testStorage.get(oldKey)).rejects.toThrow();
    expect((await agency.client.get(`/api/v1/exports/${agency.exportId}/download`)).status).toBe(404);

    // The newer export and all rows remain; exporting again still works.
    expect((await agency.client.get(`/api/v1/exports/${recent.id}/download`)).status).toBe(200);
    expect(await CatalogRowModel.countDocuments({ jobId: agency.jobId })).toBe(2);
    expect((await agency.client.post(`/api/v1/jobs/${agency.jobId}/export`).send({ fields: ['sku', 'price'] })).status).toBe(201);
  });

  it('has MongoDB remove old invitations on its own', async () => {
    const indexes = await InvitationModel.collection.indexes();
    expect(indexes.find((index) => index.key.expiresAt === 1)?.expireAfterSeconds).toBe(30 * 24 * 60 * 60);
  });
});
