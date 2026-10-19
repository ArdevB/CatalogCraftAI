import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { BSON, type Db, type Document } from 'mongodb';
import { CatalogJobModel } from '../../modules/catalog-jobs/catalog-job.model.js';
import { ExportModel } from '../../modules/exports/export.model.js';
import type { FileStorage } from '../storage/storage.js';

/**
 * Database + file backups that need nothing but Node (MongoDB Atlas free
 * clusters have no built-in backups, and mongodump is a separate install).
 *
 * A backup folder holds one `<collection>.jsonl` per collection (Extended
 * JSON, so ObjectIds and dates survive exactly), every stored upload/export
 * under `files/`, and a `manifest.json` with document counts and checksums
 * used to verify a restore.
 */

/** Sessions are short-lived login state: restoring them would sign old browsers back in. */
const SKIPPED_COLLECTIONS = new Set(['sessions']);

export type BackupManifest = {
  format: 'catalogcraft-backup@1';
  createdAt: string;
  collections: Record<string, { documents: number; sha256: string }>;
  files: { count: number; missing: string[] };
};

const line = (doc: Document) => BSON.EJSON.stringify(doc, { relaxed: false });

async function collectionNames(db: Db): Promise<string[]> {
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  return collections.map((c) => c.name).filter((name) => !name.startsWith('system.') && !SKIPPED_COLLECTIONS.has(name)).sort();
}

/** Same order and encoding for backup and verification, so equal data gives equal hashes. */
async function hashCollection(db: Db, name: string, onLine?: (text: string) => Promise<void>) {
  const hash = createHash('sha256');
  let documents = 0;
  for await (const doc of db.collection(name).find({}).sort({ _id: 1 })) {
    const text = line(doc);
    hash.update(text).update('\n');
    documents += 1;
    await onLine?.(text);
  }
  return { documents, sha256: hash.digest('hex') };
}

/** Storage keys referenced by the data: uploaded source files and generated exports. */
async function referencedFileKeys(db: Db): Promise<string[]> {
  const [jobs, exports] = await Promise.all([
    db.collection(CatalogJobModel.collection.collectionName).find({ 'originalFile.storageKey': { $type: 'string' } }, { projection: { 'originalFile.storageKey': 1 } }).toArray(),
    db.collection(ExportModel.collection.collectionName).find({}, { projection: { storageKey: 1 } }).toArray(),
  ]);
  return [
    ...jobs.map((job) => (job.originalFile as { storageKey: string }).storageKey),
    ...exports.map((item) => item.storageKey as string),
  ];
}

export async function createBackup({ db, storage, outDir }: { db: Db; storage: FileStorage; outDir: string }): Promise<BackupManifest> {
  await mkdir(path.join(outDir, 'files'), { recursive: true });
  const manifest: BackupManifest = { format: 'catalogcraft-backup@1', createdAt: new Date().toISOString(), collections: {}, files: { count: 0, missing: [] } };

  for (const name of await collectionNames(db)) {
    const out = createWriteStream(path.join(outDir, `${name}.jsonl`), { encoding: 'utf8' });
    manifest.collections[name] = await hashCollection(db, name, async (text) => {
      if (!out.write(`${text}\n`)) await once(out, 'drain');
    });
    out.end();
    await once(out, 'finish');
  }

  for (const key of await referencedFileKeys(db)) {
    try {
      const data = await storage.get(key);
      const target = path.join(outDir, 'files', ...key.split('/'));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, data);
      manifest.files.count += 1;
    } catch {
      // e.g. an export file already removed by retention; the data itself is intact.
      manifest.files.missing.push(key);
    }
  }

  await writeFile(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function readManifest(dir: string): Promise<BackupManifest> {
  const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8')) as BackupManifest;
  if (manifest.format !== 'catalogcraft-backup@1') throw new Error(`${dir} is not a CatalogCraft backup.`);
  return manifest;
}

/**
 * Restores a backup into an EMPTY database and storage, then verifies it.
 * Refuses a database that already has data, so a restore can never overwrite
 * or mix with live data by accident.
 */
export async function restoreBackup({ db, storage, dir }: { db: Db; storage: FileStorage; dir: string }): Promise<BackupManifest> {
  const manifest = await readManifest(dir);
  for (const name of await collectionNames(db)) {
    if ((await db.collection(name).estimatedDocumentCount()) > 0) {
      throw new Error(`The target database is not empty (collection "${name}" has data). Restore into a new, empty database.`);
    }
  }

  for (const name of Object.keys(manifest.collections)) {
    const collection = db.collection(name);
    let batch: Document[] = [];
    const reader = createInterface({ input: createReadStream(path.join(dir, `${name}.jsonl`), 'utf8'), crlfDelay: Infinity });
    for await (const text of reader) {
      if (!text) continue;
      batch.push(BSON.EJSON.parse(text, { relaxed: false }) as Document);
      if (batch.length === 1000) {
        await collection.insertMany(batch, { ordered: true });
        batch = [];
      }
    }
    if (batch.length > 0) await collection.insertMany(batch, { ordered: true });
  }

  for (const key of await referencedFileKeys(db)) {
    if (manifest.files.missing.includes(key)) continue;
    await storage.put(key, await readFile(path.join(dir, 'files', ...key.split('/'))));
  }

  await verifyRestore(db, manifest);
  return manifest;
}

/** Throws unless every collection has the same documents (count and checksum) as when backed up. */
export async function verifyRestore(db: Db, manifest: BackupManifest): Promise<void> {
  const problems: string[] = [];
  for (const [name, expected] of Object.entries(manifest.collections)) {
    const actual = await hashCollection(db, name);
    if (actual.documents !== expected.documents || actual.sha256 !== expected.sha256) {
      problems.push(`${name}: expected ${expected.documents} documents, found ${actual.documents}${actual.sha256 === expected.sha256 ? '' : ' (content differs)'}`);
    }
  }
  if (problems.length > 0) throw new Error(`Restore verification failed:\n  - ${problems.join('\n  - ')}`);
}
