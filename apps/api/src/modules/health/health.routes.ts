import { Router } from 'express';
import type { DatabaseStatus, Health } from '@catalogcraft/shared';
import { APP_VERSION, SERVICE_NAME } from '../../config/app-info.js';
import { sendError, sendSuccess } from '../../utils/http-response.js';

export type HealthDependencies = {
  environment: string;
  getDatabaseStatus: () => DatabaseStatus;
};

/**
 * Two endpoints, because hosting platforms ask two different questions:
 *
 * - `GET /health` (liveness): "Is the process alive?" Always 200 while the
 *   server can respond, and reports dependency status in the body. If this
 *   returned an error whenever MongoDB blipped, the platform would restart a
 *   perfectly healthy API — which would not fix the database.
 *
 * - `GET /health/ready` (readiness): "Can it serve real traffic?" 503 until
 *   the database is connected, so a load balancer can hold traffic back.
 */
export function healthRouter(deps: HealthDependencies): Router {
  const router = Router();

  const buildHealth = (): Health => {
    const database = deps.getDatabaseStatus();
    return {
      status: database === 'connected' ? 'ok' : 'degraded',
      service: SERVICE_NAME,
      version: APP_VERSION,
      environment: deps.environment,
      uptimeSeconds: Math.round(process.uptime() * 10) / 10,
      timestamp: new Date().toISOString(),
      checks: { database },
    };
  };

  router.get('/', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    sendSuccess(res, buildHealth());
  });

  router.get('/ready', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const health = buildHealth();
    if (health.status === 'ok') {
      sendSuccess(res, health);
    } else {
      sendError(res, 503, 'SERVICE_UNAVAILABLE', `Database is ${health.checks.database}.`);
    }
  });

  return router;
}
