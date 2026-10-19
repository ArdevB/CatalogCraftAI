import { randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import type { Store } from 'express-session';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import type { DatabaseStatus } from '@catalogcraft/shared';
import type { AppConfig } from './config/env.js';
import { getDatabaseStatus as mongooseDatabaseStatus } from './config/database.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { apiRateLimit, corsPolicy, securityHeaders } from './middleware/security.js';
import { apiV1Router } from './routes.js';
import type { AiProvider } from './services/ai/provider.js';
import type { FileStorage } from './services/storage/storage.js';

export type AppDependencies = {
  config: AppConfig;
  logger: Logger;
  /** Where sessions are stored: MongoDB in real use, injectable for tests. */
  sessionStore: Store;
  /** Private file storage for uploads and exports. */
  storage: FileStorage;
  /** The AI provider, or `null` when AI is not configured. */
  ai: AiProvider | null;
  /** Injectable so tests can simulate a connected or disconnected database. */
  getDatabaseStatus?: () => DatabaseStatus;
};

/**
 * Builds the Express application without starting a server. Keeping this
 * separate from `server.ts` lets tests exercise the full middleware stack
 * in-memory with Supertest.
 */
export function createApp({
  config,
  logger,
  sessionStore,
  storage,
  ai,
  getDatabaseStatus = mongooseDatabaseStatus,
}: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxyHops);

  app.use(
    pinoHttp({
      logger,
      genReqId: (_req, res) => {
        const id = randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      // Health checks are polled constantly; logging each one is just noise.
      autoLogging: { ignore: (req) => req.url?.startsWith('/api/v1/health') ?? false },
    }),
  );

  app.use(securityHeaders());
  app.use(corsPolicy(config));
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', apiRateLimit(config));
  app.use('/api/v1', apiV1Router({ config, getDatabaseStatus, sessionStore, storage, ai }));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
