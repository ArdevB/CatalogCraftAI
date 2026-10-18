import { Router, type Request, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { loginSchema, registerSchema } from '@catalogcraft/shared';
import type { AppConfig } from '../../config/env.js';
import { sessionCookieName, sessionCookieOptions } from '../../config/session.js';
import { getAuth, loadAuthContext, requireAuth } from '../../middleware/require-auth.js';
import { AppError } from '../../utils/app-error.js';
import { sendError, sendSuccess } from '../../utils/http-response.js';
import { destroySession, regenerateSession, saveSession } from '../../utils/session.js';
import { validateRequest } from '../../utils/validate-request.js';
import { findDefaultMembership } from '../memberships/membership.model.js';
import { buildSessionInfo, registerAccount, verifyCredentials } from './auth.service.js';

/**
 * Brute-force protection for credential endpoints: a much lower limit than
 * the general API limit. Successful requests don't count, so a real user who
 * mistypes once or twice is never locked out.
 */
function credentialRateLimit(config: Pick<AppConfig, 'rateLimit'>): RequestHandler {
  return rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: config.rateLimit.authMax,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      sendError(res, 429, 'RATE_LIMITED', 'Too many attempts. Please wait a few minutes and try again.');
    },
  });
}

/** Starts a fresh signed-in session (new id, defeating session fixation). */
async function signIn(req: Request, userId: string, organizationId: string): Promise<void> {
  await regenerateSession(req);
  req.session.userId = userId;
  req.session.organizationId = organizationId;
  await saveSession(req);
}

export function authRouter(config: AppConfig): Router {
  const router = Router();
  const limitCredentials = credentialRateLimit(config);

  router.post('/register', limitCredentials, async (req, res) => {
    const { body } = validateRequest(req, { body: registerSchema });
    const { userId, organizationId } = await registerAccount(body);
    await signIn(req, userId, organizationId);
    // Same checks as every authenticated request, so the response matches GET /me exactly.
    const auth = await loadAuthContext(req);
    sendSuccess(res, await buildSessionInfo(auth), { status: 201, message: 'Account created.' });
  });

  router.post('/login', limitCredentials, async (req, res) => {
    const { body } = validateRequest(req, { body: loginSchema });
    const userId = await verifyCredentials(body);
    const membership = await findDefaultMembership(userId);
    if (!membership) {
      throw new AppError('FORBIDDEN', 'Your account does not belong to any organization.');
    }
    await signIn(req, userId, membership.organizationId.toString());
    const auth = await loadAuthContext(req);
    sendSuccess(res, await buildSessionInfo(auth), { message: 'Signed in.' });
  });

  router.post('/logout', async (req, res) => {
    await destroySession(req);
    res.clearCookie(sessionCookieName(config), sessionCookieOptions(config));
    sendSuccess(res, null, { message: 'Signed out.' });
  });

  return router;
}

/** GET /api/v1/me — who is signed in, in which organization, and with which permissions. */
export const meHandler: RequestHandler[] = [
  requireAuth,
  async (req, res) => {
    sendSuccess(res, await buildSessionInfo(getAuth(req)));
  },
];
