import { Router } from 'express';
import { z } from 'zod';
import { objectIdSchema, startEnrichmentSchema } from '@catalogcraft/shared';
import type { AiProvider } from '../../services/ai/provider.js';
import { getAuth, requireAuth, requirePermission } from '../../middleware/require-auth.js';
import { sendSuccess } from '../../utils/http-response.js';
import { validateRequest } from '../../utils/validate-request.js';
import { toJobDto } from '../catalog-jobs/catalog-job.service.js';
import { getUsage } from '../usage/usage.service.js';
import { cancelEnrichment, startEnrichment } from './enrichment.service.js';

const jobParams = z.object({ jobId: objectIdSchema });

/** Mounted under /jobs: POST /jobs/:jobId/enrich and POST /jobs/:jobId/enrich/cancel. */
export function enrichmentRouter(provider: AiProvider | null): Router {
  const router = Router();
  router.use(requireAuth);

  router.post('/:jobId/enrich', requirePermission('jobs:edit'), async (req, res) => {
    const { params, body } = validateRequest(req, { params: jobParams, body: startEnrichmentSchema });
    const job = await startEnrichment(provider, getAuth(req), params.jobId, body);
    // 202 Accepted: the work continues in the background; poll GET /jobs/:jobId for progress.
    sendSuccess(res, await toJobDto(job), { status: 202, message: 'Enrichment queued.' });
  });

  router.post('/:jobId/enrich/cancel', requirePermission('jobs:edit'), async (req, res) => {
    const { params } = validateRequest(req, { params: jobParams });
    const job = await cancelEnrichment(getAuth(req), params.jobId);
    sendSuccess(res, await toJobDto(job), { message: 'Cancelling enrichment.' });
  });

  return router;
}

/** GET /ai/status — whether AI is available, so any role's UI can explain it before they try. */
export function aiStatusRouter(provider: AiProvider | null): Router {
  const router = Router();
  router.use(requireAuth);
  router.get('/status', (_req, res) => {
    sendSuccess(res, { configured: provider !== null, model: provider?.model ?? null });
  });
  return router;
}

/** GET /usage — this month's usage against the plan. */
export function usageRouter(provider: AiProvider | null): Router {
  const router = Router();
  router.use(requireAuth);
  router.get('/', requirePermission('usage:read'), async (req, res) => {
    sendSuccess(res, await getUsage(getAuth(req).organizationId, provider));
  });
  return router;
}
