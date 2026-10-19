import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { redactMongoUri } from '../config/database.js';
import { ConfigError, loadConfig } from '../config/env.js';
import { loadRootEnvFile } from '../config/load-env-file.js';
import { createBackup } from '../services/backup/backup.js';
import { createStorage } from '../services/storage/storage.js';

/**
 * Backs up the database and stored files to a folder.
 *
 *   npm run backup                 → backups/<date-time>/ in the repository
 *   npm run backup -- <folder>     → a folder of your choice
 *
 * The backup contains customer data: keep it somewhere private (an encrypted
 * drive or a private bucket), never in git.
 */
async function main(): Promise<void> {
  loadRootEnvFile();
  const config = loadConfig();
  const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve(process.argv[2] ?? path.join(repoRoot, 'backups', stamp));

  console.log(`Connecting to ${redactMongoUri(config.mongodbUri)} …`);
  await mongoose.connect(config.mongodbUri, { serverSelectionTimeoutMS: 10_000 });
  const manifest = await createBackup({ db: mongoose.connection.db!, storage: createStorage(config), outDir });

  for (const [name, { documents }] of Object.entries(manifest.collections)) console.log(`  ${name}: ${documents} documents`);
  console.log(`  files: ${manifest.files.count}${manifest.files.missing.length ? ` (${manifest.files.missing.length} already deleted by retention)` : ''}`);
  console.log(`Backup written to ${outDir}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof ConfigError || error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
