import { Router } from 'express';
import type { DatabaseStatus } from '@catalogcraft/shared';
import type { AppConfig } from './config/env.js';
import { healthRouter } from './modules/health/health.routes.js';

export type RouteDependencies = {
  config: AppConfig;
  getDatabaseStatus: () => DatabaseStatus;
};

/** Everything mounted under `/api/v1`. New modules register their routers here. */
export function apiV1Router(deps: RouteDependencies): Router {
  const router = Router();

  router.use(
    '/health',
    healthRouter({ environment: deps.config.nodeEnv, getDatabaseStatus: deps.getDatabaseStatus }),
  );

  return router;
}
