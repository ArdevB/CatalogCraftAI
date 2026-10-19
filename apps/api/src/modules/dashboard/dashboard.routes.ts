import { Router } from 'express';
import { dashboardQuerySchema, FINISHED_JOB_STATUSES, type DashboardSummary } from '@catalogcraft/shared';
import { planLimits } from '../../config/plans.js';
import { getAuth, requireAuth } from '../../middleware/require-auth.js';
import { AppError } from '../../utils/app-error.js';
import { sendSuccess } from '../../utils/http-response.js';
import { tenantScope } from '../../utils/tenant.js';
import { validateRequest } from '../../utils/validate-request.js';
import { CatalogJobModel } from '../catalog-jobs/catalog-job.model.js';
import { ClientModel } from '../clients/client.model.js';
import { getWorkspaceAllowance } from '../clients/client.service.js';
import { OrganizationModel } from '../organizations/organization.model.js';
import { ExportModel } from '../exports/export.model.js';
import { getUsage } from '../usage/usage.service.js';
import { dashboardInsights } from './dashboard-trend.js';

/**
 * Dashboard figures, computed from real data on each request.
 */
export function dashboardRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/summary', async (req, res) => {
    const auth = getAuth(req);
    const { query } = validateRequest(req, { query: dashboardQuerySchema });
    const scope = tenantScope(auth);
    const [organization, clients, recentClients, active, needsReview, failed, recentJobs, usage, recentExports, insights] = await Promise.all([
      OrganizationModel.findById(auth.organizationId).select('plan').lean(),
      getWorkspaceAllowance(auth),
      ClientModel.find(scope).sort({ updatedAt: -1 }).limit(5).select('name updatedAt').lean(),
      CatalogJobModel.countDocuments({ ...scope, status: { $nin: FINISHED_JOB_STATUSES } }),
      CatalogJobModel.countDocuments({ ...scope, status: 'review' }),
      CatalogJobModel.countDocuments({ ...scope, status: 'failed' }),
      CatalogJobModel.find(scope).sort({ updatedAt: -1 }).limit(5).select('name status clientId updatedAt').lean(),
      getUsage(auth.organizationId, null),
      ExportModel.find(scope).sort({ createdAt: -1 }).limit(5).select('jobId filename rowCount createdAt').lean(),
      dashboardInsights(auth.organizationId, query.tz),
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
      products: { used: usage.products.used, limit: usage.products.limit },
      jobs: { active, activeLimit: planLimits(organization.plan).maxActiveJobs, needsReview, failed },
      recentExports: recentExports.map((item) => ({
        id: item._id.toString(),
        jobId: item.jobId.toString(),
        filename: item.filename,
        rowCount: item.rowCount,
        createdAt: item.createdAt.toISOString(),
      })),
      recentJobs: recentJobs.map((job) => ({
        id: job._id.toString(),
        name: job.name,
        status: job.status,
        clientName: clientNames.get(job.clientId.toString()) ?? 'Deleted client',
        updatedAt: job.updatedAt.toISOString(),
      })),
      ...insights,
    };
    sendSuccess(res, summary);
  });

  return router;
}
