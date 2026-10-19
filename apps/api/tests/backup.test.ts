import { randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBackup, restoreBackup } from '../src/services/backup/backup.js';
import { LocalFileStorage } from '../src/services/storage/storage.js';
import { connectTestDatabase, dbTestApp, disconnectTestDatabase, newAgency, testStorage } from './helpers.js';

const scratch = path.join(tmpdir(), `catalogcraft-backup-${randomUUID().slice(0, 8)}`);

beforeAll(connectTestDatabase);
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
  await disconnectTestDatabase();
});

/** A separate, empty database on the same test server, with its own empty file storage. */
function emptyTarget() {
  const name = `restore_${randomUUID().slice(0, 8)}`;
  return { db: mongoose.connection.useDb(name).db!, storage: new LocalFileStorage(path.join(scratch, `${name}-files`)), name };
}

async function seedAgency() {
  const app = dbTestApp();
  const agency = await newAgency(app, { plan: 'agency' });
  const clientId = (await agency.client.post('/api/v1/clients').send({ name: 'Kitchen Co' }).expect(201)).body.data.id as string;
  const jobId = (await agency.client.post('/api/v1/jobs').send({ clientId }).expect(201)).body.data.id as string;
  await agency.client.post(`/api/v1/jobs/${jobId}/upload`).attach('file', Buffer.from('SKU,Price\n00042,12.50\nB,2'), 'p.csv').expect(200);
  await agency.client.put(`/api/v1/jobs/${jobId}/mapping`).send({ sheetName: null, headerRow: 1, mapping: { sku: 0, price: 1 } }).expect(200);
  await agency.client.post(`/api/v1/jobs/${jobId}/validate`).expect(200);
  await agency.client.post(`/api/v1/jobs/${jobId}/export`).send({ fields: ['sku', 'price'] }).expect(201);
  return agency;
}

describe('backup and restore', () => {
  it('restores the database and files exactly, and verifies them', async () => {
    const agency = await seedAgency();
    const outDir = path.join(scratch, 'backup-1');
    const manifest = await createBackup({ db: mongoose.connection.db!, storage: testStorage, outDir });

    expect(manifest.collections.catalogrows?.documents).toBe(2);
    expect(manifest.collections.sessions).toBeUndefined(); // logins are never backed up
    expect(manifest.files).toEqual({ count: 2, missing: [] });

    const target = emptyTarget();
    await restoreBackup({ ...target, dir: outDir });

    // Same documents with the same types (ObjectIds and dates, not strings).
    const original = await mongoose.connection.db!.collection('organizations').findOne({ _id: new mongoose.Types.ObjectId(agency.organizationId) });
    const restored = await target.db.collection('organizations').findOne({ _id: new mongoose.Types.ObjectId(agency.organizationId) });
    expect(restored).toEqual(original);
    expect(restored!.createdAt).toBeInstanceOf(Date);

    const row = await target.db.collection('catalogrows').findOne({ sourceIdentifier: '00042' });
    expect(row!.original).toMatchObject({ sku: '00042', price: '12.50' }); // protected values intact

    const job = await target.db.collection('catalogjobs').findOne({ organizationId: new mongoose.Types.ObjectId(agency.organizationId) });
    const key = (job!.originalFile as { storageKey: string }).storageKey;
    expect((await target.storage.get(key)).equals(await testStorage.get(key))).toBe(true);
  });

  it('refuses to restore over existing data', async () => {
    const outDir = path.join(scratch, 'backup-2');
    await createBackup({ db: mongoose.connection.db!, storage: testStorage, outDir });
    await expect(restoreBackup({ db: mongoose.connection.db!, storage: testStorage, dir: outDir })).rejects.toThrow(/not empty/);
  });

  it('detects a damaged backup', async () => {
    await seedAgency();
    const outDir = path.join(scratch, 'backup-3');
    await createBackup({ db: mongoose.connection.db!, storage: testStorage, outDir });
    const file = path.join(outDir, 'clients.jsonl');
    await writeFile(file, (await readFile(file, 'utf8')).replace('Kitchen Co', 'Kitchen Cx'));

    await expect(restoreBackup({ ...emptyTarget(), dir: outDir })).rejects.toThrow(/clients: .*content differs/);
  });
});
