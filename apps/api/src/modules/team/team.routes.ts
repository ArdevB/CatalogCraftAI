import { Router } from 'express';
import { z } from 'zod';
import {
  createInvitationSchema,
  invitationTokenSchema,
  objectIdSchema,
  registerFromInvitationSchema,
  signInFromInvitationSchema,
  updateMemberSchema,
} from '@catalogcraft/shared';
import type { AppConfig } from '../../config/env.js';
import { getAuth, loadAuthContext, requireAuth, requirePermission } from '../../middleware/require-auth.js';
import { sendSuccess } from '../../utils/http-response.js';
import { saveSession, startSession } from '../../utils/session.js';
import { validateRequest } from '../../utils/validate-request.js';
import { credentialRateLimit } from '../auth/auth.routes.js';
import { buildSessionInfo } from '../auth/auth.service.js';
import {
  acceptInvitation,
  changeMemberRole,
  createInvitation,
  listInvitations,
  previewInvitation,
  registerFromInvitation,
  removeMember,
  revokeInvitation,
  signInFromInvitation,
} from './team.service.js';

const idParams = z.object({ id: objectIdSchema });
const tokenParams = z.object({ token: invitationTokenSchema });

/** Mounted under /organizations/current: invitations and member management. */
export function teamRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  const canManage = requirePermission('members:manage');

  router.get('/invitations', canManage, async (req, res) => {
    sendSuccess(res, await listInvitations(getAuth(req)));
  });

  router.post('/invitations', canManage, async (req, res) => {
    const { body } = validateRequest(req, { body: createInvitationSchema });
    sendSuccess(res, await createInvitation(getAuth(req), body), { status: 201, message: 'Invitation created.' });
  });

  router.delete('/invitations/:id', canManage, async (req, res) => {
    const { params } = validateRequest(req, { params: idParams });
    await revokeInvitation(getAuth(req), params.id);
    sendSuccess(res, null, { message: 'Invitation cancelled.' });
  });

  router.patch('/members/:id', canManage, async (req, res) => {
    const { params, body } = validateRequest(req, { params: idParams, body: updateMemberSchema });
    await changeMemberRole(getAuth(req), params.id, body.role);
    sendSuccess(res, null, { message: 'Role updated.' });
  });

  // No permission check here: anyone may remove themselves (leave); the
  // service checks the rules for removing someone else.
  router.delete('/members/:id', async (req, res) => {
    const { params } = validateRequest(req, { params: idParams });
    await removeMember(getAuth(req), params.id);
    sendSuccess(res, null, { message: 'Member removed.' });
  });

  return router;
}

/** Mounted under /invitations: opening and accepting invitation links. */
export function invitationsRouter(config: AppConfig): Router {
  const router = Router();
  const limitCredentials = credentialRateLimit(config);

  // Public: the link itself is the credential, so this needs no sign-in.
  router.get('/:token', async (req, res) => {
    const { params } = validateRequest(req, { params: tokenParams });
    sendSuccess(res, await previewInvitation(params.token));
  });

  router.post('/:token/accept', requireAuth, async (req, res) => {
    const { params } = validateRequest(req, { params: tokenParams });
    const { organizationId } = await acceptInvitation(getAuth(req), params.token);
    req.session.organizationId = organizationId; // switch straight into the new organization
    await saveSession(req);
    sendSuccess(res, await buildSessionInfo(await loadAuthContext(req)), { message: 'Invitation accepted.' });
  });

  router.post('/:token/register', limitCredentials, async (req, res) => {
    const { params, body } = validateRequest(req, { params: tokenParams, body: registerFromInvitationSchema });
    const { userId, organizationId } = await registerFromInvitation(params.token, body);
    await startSession(req, userId, organizationId);
    sendSuccess(res, await buildSessionInfo(await loadAuthContext(req)), { status: 201, message: 'Account created.' });
  });

  router.post('/:token/sign-in', limitCredentials, async (req, res) => {
    const { params, body } = validateRequest(req, { params: tokenParams, body: signInFromInvitationSchema });
    const { userId, organizationId } = await signInFromInvitation(params.token, body);
    await startSession(req, userId, organizationId);
    sendSuccess(res, await buildSessionInfo(await loadAuthContext(req)), { message: 'Invitation accepted.' });
  });

  return router;
}
