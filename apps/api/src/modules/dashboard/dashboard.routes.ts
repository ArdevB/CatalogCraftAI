import { Router } from 'express';
import { FINISHED_JOB_STATUSES, type DashboardSummary } from '@catalogcraft/shared';
import { planLimits } from '../../config/plans.js';
import { getAuth, requireAuth } from '../../middleware/require-auth.js';
import { AppError } from '../../utils/app-error.js';
import { sendSuccess } from '../../utils/http-response.js';
import { tenantScope } from '../../utils/tenant.js';
import { CatalogJobModel } from '../catalog-jobs/catalog-job.model.js';
import { ClientModel } from '../clients/client.model.js';
import { getWorkspaceAllowance } from '../clients/client.service.js';
import { OrganizationModel } from '../organizations/organization.model.js';

/**
 * Dashboard figures, computed from real data on each request. Product usage
 * and export statistics join this summary when those features are built.
 */
export function dashboardRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/summary', async (req, res) => {
    const auth = getAuth(req);
    const scope = tenantScope(auth);
    const [organization, clients, recentClients, active, needsReview, failed, recentJobs] = await Promise.all([
      OrganizationModel.findById(auth.organizationId).select('plan').lean(),
      getWorkspaceAllowance(auth),
      ClientModel.find(scope).sort({ updatedAt: -1 }).limit(5).select('name updatedAt').lean(),
      CatalogJobModel.countDocuments({ ...scope, status: { $nin: FINISHED_JOB_STATUSES } }),
      CatalogJobModel.countDocuments({ ...scope, status: 'review' }),
      CatalogJobModel.countDocuments({ ...scope, status: 'failed' }),
      CatalogJobModel.find(scope).sort({ updatedAt: -1 }).limit(5).select('name status clientId updatedAt').lean(),
    ]);
    if (!organization) throw new AppError('NOT_FOUND', 'Organization not found.');

    const jobClients = await ClientModel.find({ ...scope, _id: { $in: recentJobs.map((job) => job.clientId) } })
      .select('name')
      .lean();
    const clientNames = new Map(jobClients.map((client) => [client._id.toString(), client.name]));

    const summary: DashboardSummary = {
      plan: organization.plan,
      clients,
      recentClients: recentClients.map((client) => ({
        id: client._id.toString(),
        name: client.name,
        updatedAt: client.updatedAt.toISOString(),
      })),
      jobs: { active, activeLimit: planLimits(organization.plan).maxActiveJobs, needsReview, failed },
      recentJobs: recentJobs.map((job) => ({
        id: job._id.toString(),
        name: job.name,
        status: job.status,
        clientName: clientNames.get(job.clientId.toString()) ?? 'Deleted client',
        updatedAt: job.updatedAt.toISOString(),
      })),
    };
    sendSuccess(res, summary);
  });

  return router;
}
