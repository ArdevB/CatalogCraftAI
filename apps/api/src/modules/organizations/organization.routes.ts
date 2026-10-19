import { Router } from 'express';
import { deleteOrganizationSchema, updateOrganizationSchema, type Member, type SessionInfo } from '@catalogcraft/shared';
import type { Request } from 'express';
import { getAuth, loadAuthContext, requireAuth, requirePermission } from '../../middleware/require-auth.js';
import type { FileStorage } from '../../services/storage/storage.js';
import { AppError } from '../../utils/app-error.js';
import { sendSuccess } from '../../utils/http-response.js';
import { tenantScope } from '../../utils/tenant.js';
import { validateRequest } from '../../utils/validate-request.js';
import { buildSessionInfo } from '../auth/auth.service.js';
import { UserModel } from '../auth/user.model.js';
import { MembershipModel } from '../memberships/membership.model.js';
import { deleteOrganization } from './organization-deletion.js';
import { toOrganizationDto } from './organization.dto.js';
import { OrganizationModel } from './organization.model.js';

/**
 * The organization is always "current": the one in the verified session.
 * There is deliberately no `/organizations/:id` route, so there is no id in
 * the URL for anyone to swap for another agency's.
 */
/** After losing an organization: the session moves to another one, or ends (`null`). */
async function sessionAfterLeaving(req: Request): Promise<SessionInfo | null> {
  try {
    return await buildSessionInfo(await loadAuthContext(req));
  } catch (error) {
    if (error instanceof AppError && error.code === 'UNAUTHENTICATED') return null;
    throw error;
  }
}

export function organizationsRouter(storage: FileStorage): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/current', requirePermission('organization:read'), async (req, res) => {
    const auth = getAuth(req);
    const organization = await OrganizationModel.findById(auth.organizationId).lean();
    if (!organization) throw new AppError('NOT_FOUND', 'Organization not found.');
    sendSuccess(res, toOrganizationDto(organization));
  });

  router.patch('/current', requirePermission('organization:update'), async (req, res) => {
    const auth = getAuth(req);
    const { body } = validateRequest(req, { body: updateOrganizationSchema });
    const organization = await OrganizationModel.findByIdAndUpdate(
      auth.organizationId,
      {
        $set: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.contentRules !== undefined ? { 'contentRules.prohibitedClaims': body.contentRules.prohibitedClaims } : {}),
        },
      },
      { returnDocument: 'after', runValidators: true },
    ).lean();
    if (!organization) throw new AppError('NOT_FOUND', 'Organization not found.');
    sendSuccess(res, toOrganizationDto(organization), { message: 'Organization updated.' });
  });

  // Owner only. Everything the organization owns is deleted; user accounts are kept.
  router.delete('/current', requirePermission('organization:delete'), async (req, res) => {
    const auth = getAuth(req);
    const { body } = validateRequest(req, { body: deleteOrganizationSchema });
    await deleteOrganization(storage, auth, body.confirmName);
    req.log.info({ organizationId: auth.organizationId }, 'Organization deleted');
    sendSuccess(res, await sessionAfterLeaving(req), { message: 'Organization deleted.' });
  });

  router.get('/current/members', requirePermission('members:read'), async (req, res) => {
    const auth = getAuth(req);
    const memberships = await MembershipModel.find(tenantScope(auth)).sort({ createdAt: 1 }).lean();
    const users = await UserModel.find({ _id: { $in: memberships.map((m) => m.userId) } })
      .select('name email')
      .lean();
    const usersById = new Map(users.map((user) => [user._id.toString(), user]));

    const members: Member[] = memberships.flatMap((membership) => {
      const user = usersById.get(membership.userId.toString());
      if (!user) return [];
      return [
        {
          membershipId: membership._id.toString(),
          userId: user._id.toString(),
          name: user.name,
          email: user.email,
          role: membership.role,
          joinedAt: membership.createdAt.toISOString(),
        },
      ];
    });
    sendSuccess(res, members);
  });

  return router;
}
