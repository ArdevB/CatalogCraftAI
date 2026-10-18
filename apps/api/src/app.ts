import { randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import type { DatabaseStatus } from '@catalogcraft/shared';
import type { AppConfig } from './config/env.js';
import { getDatabaseStatus as mongooseDatabaseStatus } from './config/database.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { apiRateLimit, corsPolicy, securityHeaders } from './middleware/security.js';
import { apiV1Router } from './routes.js';

export type AppDependencies = {
  config: AppConfig;
  logger: Logger;
  /** Injectable so tests can simulate a connected or disconnected database. */
  getDatabaseStatus?: () => DatabaseStatus;
};

/**
 * Builds the Express application without starting a server. Keeping this
 * separate from `server.ts` lets tests exercise the full middleware stack
 * in-memory with Supertest.
 */
export function createApp({ config, logger, getDatabaseStatus = mongooseDatabaseStatus }: AppDependencies): Express {
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
  app.use('/api/v1', apiV1Router({ config, getDatabaseStatus }));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
