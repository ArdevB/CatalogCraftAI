import { Router } from 'express';
import type { Store } from 'express-session';
import type { DatabaseStatus } from '@catalogcraft/shared';
import type { AppConfig } from './config/env.js';
import { sessionMiddleware } from './config/session.js';
import { csrfProtection } from './middleware/csrf.js';
import { requireDatabase } from './middleware/require-database.js';
import { authRouter, deleteAccountHandler, meHandler } from './modules/auth/auth.routes.js';
import { jobsRouter } from './modules/catalog-jobs/catalog-job.routes.js';
import { clientsRouter } from './modules/clients/client.routes.js';
import { dashboardRouter } from './modules/dashboard/dashboard.routes.js';
import { healthRouter } from './modules/health/health.routes.js';
import { exportsRouter, reviewRouter } from './modules/review/review.routes.js';
import { organizationsRouter } from './modules/organizations/organization.routes.js';
import { invitationsRouter, teamRouter } from './modules/team/team.routes.js';
import { aiStatusRouter, enrichmentRouter, usageRouter } from './modules/enrichment/enrichment.routes.js';
import type { EmailDeps } from './modules/auth/email-flows.js';
import type { AiProvider } from './services/ai/provider.js';
import { sendSuccess } from './utils/http-response.js';
import type { FileStorage } from './services/storage/storage.js';

export type RouteDependencies = {
  config: AppConfig;
  getDatabaseStatus: () => DatabaseStatus;
  sessionStore: Store;
  storage: FileStorage;
  /** `null` when no AI key is configured. */
  ai: AiProvider | null;
  email: EmailDeps;
};

/** Everything mounted under `/api/v1`. New modules register their routers here. */
export function apiV1Router(deps: RouteDependencies): Router {
  const router = Router();

  // Health checks must work even when the database is down, so they come first.
  router.use(
    '/health',
    healthRouter({ environment: deps.config.nodeEnv, getDatabaseStatus: deps.getDatabaseStatus }),
  );

  // What the sign-in pages may offer (e.g. "Forgot password?" needs email). No secrets.
  router.get('/features', (_req, res) => {
    sendSuccess(res, { email: deps.email.mailer.enabled });
  });

  // Everything below needs MongoDB (including the session store).
  router.use(requireDatabase(deps.getDatabaseStatus));
  router.use(sessionMiddleware(deps.config, deps.sessionStore));
  router.use(csrfProtection(deps.config));

  router.use('/auth', authRouter(deps.config, deps.email));
  router.get('/me', meHandler);
  router.delete('/me', deleteAccountHandler(deps.config));
  router.use('/organizations', organizationsRouter(deps.storage));
  router.use('/organizations/current', teamRouter(deps.email));
  router.use('/invitations', invitationsRouter(deps.config));
  router.use('/clients', clientsRouter());
  router.use('/dashboard', dashboardRouter());
  router.use('/jobs', jobsRouter({ config: deps.config, storage: deps.storage }));
  router.use('/jobs', enrichmentRouter(deps.ai));
  router.use('/jobs', reviewRouter(deps.storage));
  router.use('/exports', exportsRouter(deps.storage));
  router.use('/usage', usageRouter(deps.ai));
  router.use('/ai', aiStatusRouter(deps.ai));

  return router;
}
