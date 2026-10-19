import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MongoStore } from 'connect-mongo';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { ensureIndexes } from '../src/config/database.js';
import { loadConfig } from '../src/config/env.js';
import { createLogger } from '../src/config/logger.js';
import { EnrichmentWorker } from '../src/modules/enrichment/enrichment.worker.js';
import { LocalFileStorage } from '../src/services/storage/storage.js';
import { MockAiProvider } from '../tests/mock-ai.js';
// Importing the models registers them, so their indexes are built.
import '../src/modules/audit/audit-log.model.js';
import '../src/modules/auth/user.model.js';
import '../src/modules/catalog-jobs/catalog-job.model.js';
import '../src/modules/catalog-rows/catalog-row.model.js';
import '../src/modules/clients/client.model.js';
import '../src/modules/exports/export.model.js';
import '../src/modules/memberships/membership.model.js';
import '../src/modules/organizations/organization.model.js';
import '../src/modules/team/invitation.model.js';
import '../src/modules/usage/usage-event.model.js';

/**
 * The whole app on a throwaway in-memory MongoDB, temporary file storage and a
 * scripted AI — for end-to-end and performance tests only. It never reads
 * `.env`, so it can't touch a real database or spend money on a real AI key.
 * Lives outside `src/`, so it is never part of a production build.
 */
export type LocalStack = {
  url: string;
  app: ReturnType<typeof createApp>;
  ai: MockAiProvider;
  close: () => Promise<void>;
};

export async function startLocalStack(options: {
  port: number;
  /** Serve the built web app from the API (same origin), as in a single-service deployment. */
  webDistDir?: string;
  /** Simulated AI response time per product. */
  aiLatencyMs?: number;
  aiConcurrency?: number;
  env?: Record<string, string>;
}): Promise<LocalStack> {
  const mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  const storageDir = await mkdtemp(path.join(tmpdir(), 'catalogcraft-stack-'));
  const url = `http://localhost:${options.port}`;
  const config = loadConfig({
    NODE_ENV: 'development',
    LOG_LEVEL: 'warn',
    PORT: String(options.port),
    MONGODB_URI: mongo.getUri('catalogcraft'),
    WEB_ORIGIN: url,
    SESSION_SECRET: randomBytes(32).toString('hex'),
    STORAGE_LOCAL_DIR: storageDir,
    // Generous limits: tests sign up many accounts from one IP.
    RATE_LIMIT_MAX: '100000',
    AUTH_RATE_LIMIT_MAX: '1000',
    IMPORT_MAX_ROWS: '50000',
    UPLOAD_MAX_MB: '50',
    ...(options.webDistDir ? { WEB_DIST_DIR: options.webDistDir } : {}),
    ...options.env,
  });
  const logger = createLogger(config);

  await mongoose.connect(config.mongodbUri);
  await ensureIndexes();

  // Deterministic "AI": copy built from the product title, like tests/mock-ai.ts.
  const latency = options.aiLatencyMs ?? 0;
  const ai = new MockAiProvider(async (request) => {
    if (latency > 0) await new Promise((resolve) => setTimeout(resolve, latency));
    return MockAiProvider.echo(request);
  });

  const app = createApp({
    config,
    logger,
    sessionStore: MongoStore.create({ client: mongoose.connection.getClient(), collectionName: 'sessions' }),
    storage: new LocalFileStorage(storageDir),
    ai,
  });
  const worker = new EnrichmentWorker({ provider: ai, logger, concurrency: options.aiConcurrency ?? config.ai.concurrency, pollIntervalMs: 250 });
  worker.start();

  const server = await new Promise<Server>((resolve, reject) => {
    const listening = app.listen(options.port, () => resolve(listening));
    listening.on('error', reject);
  });

  return {
    url,
    app,
    ai,
    close: async () => {
      await worker.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await mongoose.disconnect();
      await mongo.stop();
      await rm(storageDir, { recursive: true, force: true });
    },
  };
}
