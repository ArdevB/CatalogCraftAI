import path from 'node:path';
import mongoose from 'mongoose';
import { ensureIndexes, redactMongoUri } from '../config/database.js';
import { ConfigError, loadConfig } from '../config/env.js';
import { loadRootEnvFile } from '../config/load-env-file.js';
import { restoreBackup } from '../services/backup/backup.js';
import { createStorage } from '../services/storage/storage.js';
// Importing the models registers them, so their indexes are rebuilt after the restore.
import '../modules/audit/audit-log.model.js';
import '../modules/auth/user.model.js';
import '../modules/catalog-jobs/catalog-job.model.js';
import '../modules/catalog-rows/catalog-row.model.js';
import '../modules/clients/client.model.js';
import '../modules/exports/export.model.js';
import '../modules/memberships/membership.model.js';
import '../modules/organizations/organization.model.js';
import '../modules/team/invitation.model.js';
import '../modules/usage/usage-event.model.js';

/**
 * Restores a backup into the database in MONGODB_URI, which must be EMPTY,
 * then checks every collection against the backup's checksums.
 *
 *   MONGODB_URI=<new empty database> npm run restore -- backups/<folder>
 */
async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) throw new Error('Usage: npm run restore -- <backup folder>');

  loadRootEnvFile();
  const config = loadConfig();
  console.log(`Restoring ${path.resolve(dir)} into ${redactMongoUri(config.mongodbUri)} …`);
  await mongoose.connect(config.mongodbUri, { serverSelectionTimeoutMS: 10_000 });
  const manifest = await restoreBackup({ db: mongoose.connection.db!, storage: createStorage(config), dir: path.resolve(dir) });
  await ensureIndexes();
  console.log(`Restored and verified ${Object.keys(manifest.collections).length} collections and ${manifest.files.count} files (backup from ${manifest.createdAt}).`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof ConfigError || error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
