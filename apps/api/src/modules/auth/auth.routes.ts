import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { Types } from 'mongoose';
import {
  changePasswordSchema,
  deleteAccountSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  switchOrganizationSchema,
  verifyEmailSchema,
} from '@catalogcraft/shared';
import type { AppConfig } from '../../config/env.js';
import { sessionCookieName, sessionCookieOptions } from '../../config/session.js';
import { getAuth, loadAuthContext, requireAuth } from '../../middleware/require-auth.js';
import { AppError } from '../../utils/app-error.js';
import { sendError, sendSuccess } from '../../utils/http-response.js';
import { destroySession, regenerateSession, saveSession, startSession } from '../../utils/session.js';
import { validateRequest } from '../../utils/validate-request.js';
import { findDefaultMembership, MembershipModel } from '../memberships/membership.model.js';
import { requestPasswordReset, resetPassword, sendVerificationEmail, verifyEmail, type EmailDeps } from './email-flows.js';
import { buildSessionInfo, changePassword, deleteAccount, registerAccount, verifyCredentials } from './auth.service.js';

/**
 * Brute-force protection for credential endpoints: a much lower limit than
 * the general API limit. Successful requests don't count, so a real user who
 * mistypes once or twice is never locked out.
 */
export function credentialRateLimit(config: Pick<AppConfig, 'rateLimit'>): RequestHandler {
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

/**
 * Limits requests that make the server send an email. Unlike sign-in, every
 * request counts (these always "succeed"), so they can't be used to flood an inbox.
 */
export function emailRateLimit(config: Pick<AppConfig, 'rateLimit'>): RequestHandler {
  return rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: config.rateLimit.emailMax,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      sendError(res, 429, 'RATE_LIMITED', 'Too many emails requested. Please wait a few minutes and try again.');
    },
  });
}

export function authRouter(config: AppConfig, email: EmailDeps): Router {
  const router = Router();
  const limitCredentials = credentialRateLimit(config);
  const limitEmails = emailRateLimit(config);

  router.post('/register', limitCredentials, async (req, res) => {
    const { body } = validateRequest(req, { body: registerSchema });
    const { userId, organizationId } = await registerAccount(body);
    await startSession(req, userId, organizationId);
    await sendVerificationEmail(email, { _id: new Types.ObjectId(userId), name: body.name, email: body.email });
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
    await startSession(req, userId, membership.organizationId.toString());
    const auth = await loadAuthContext(req);
    sendSuccess(res, await buildSessionInfo(auth), { message: 'Signed in.' });
  });

  // Switch the active organization (for people in several agencies). Membership is verified, never assumed.
  router.post('/switch-organization', requireAuth, async (req, res) => {
    const { body } = validateRequest(req, { body: switchOrganizationSchema });
    const auth = getAuth(req);
    if (!(await MembershipModel.exists({ userId: auth.userId, organizationId: body.organizationId }))) {
      throw new AppError('NOT_FOUND', 'Organization not found.');
    }
    req.session.organizationId = body.organizationId;
    await saveSession(req);
    sendSuccess(res, await buildSessionInfo(await loadAuthContext(req)), { message: 'Organization switched.' });
  });

  // Signs out every other session; this one continues under a new session id.
  router.post('/change-password', limitCredentials, requireAuth, async (req, res) => {
    const { body } = validateRequest(req, { body: changePasswordSchema });
    const auth = getAuth(req);
    const authVersion = await changePassword(auth, body.currentPassword, body.newPassword);
    await regenerateSession(req);
    req.session.userId = auth.userId;
    req.session.organizationId = auth.organizationId;
    req.session.authVersion = authVersion;
    await saveSession(req);
    sendSuccess(res, null, { message: 'Password changed. Other devices have been signed out.' });
  });

  // The link itself is the credential, so this needs no sign-in.
  router.post('/verify-email', limitCredentials, async (req, res) => {
    const { body } = validateRequest(req, { body: verifyEmailSchema });
    await verifyEmail(body.token);
    sendSuccess(res, null, { message: 'Email address confirmed.' });
  });

  router.post('/resend-verification', limitEmails, requireAuth, async (req, res) => {
    const auth = getAuth(req);
    if (auth.user.emailVerified) {
      sendSuccess(res, null, { message: 'Your email address is already confirmed.' });
      return;
    }
    if (!email.mailer.enabled) throw new AppError('SERVICE_UNAVAILABLE', 'Email is not set up on this server.');
    const sent = await sendVerificationEmail(email, { _id: new Types.ObjectId(auth.userId), name: auth.user.name, email: auth.user.email });
    if (!sent) throw new AppError('SERVICE_UNAVAILABLE', 'The email could not be sent. Please try again later.');
    sendSuccess(res, null, { message: `We sent a new link to ${auth.user.email}.` });
  });

  // Same answer whether or not the address has an account, so it can't be used to discover who is registered.
  router.post('/forgot-password', limitEmails, async (req, res) => {
    const { body } = validateRequest(req, { body: forgotPasswordSchema });
    if (!email.mailer.enabled) {
      throw new AppError('SERVICE_UNAVAILABLE', 'Password resets by email are not set up on this server. Ask your administrator to reset it.');
    }
    requestPasswordReset(email, body.email);
    sendSuccess(res, null, { message: 'If an account uses that address, we sent it a link to reset the password.' });
  });

  router.post('/reset-password', limitCredentials, async (req, res) => {
    const { body } = validateRequest(req, { body: resetPasswordSchema });
    await resetPassword(body.token, body.password);
    sendSuccess(res, null, { message: 'Password changed. You can now sign in.' });
  });

  router.post('/logout', async (req, res) => {
    await destroySession(req);
    res.clearCookie(sessionCookieName(config), sessionCookieOptions(config));
    sendSuccess(res, null, { message: 'Signed out.' });
  });

  return router;
}

/** DELETE /api/v1/me — deletes your own account (password required), then signs you out. */
export function deleteAccountHandler(config: AppConfig): RequestHandler[] {
  return [
    credentialRateLimit(config),
    requireAuth,
    async (req, res) => {
      const { body } = validateRequest(req, { body: deleteAccountSchema });
      await deleteAccount(getAuth(req), body.password);
      req.log.info({ userId: getAuth(req).userId }, 'Account deleted');
      await destroySession(req);
      res.clearCookie(sessionCookieName(config), sessionCookieOptions(config));
      sendSuccess(res, null, { message: 'Your account has been deleted.' });
    },
  ];
}

/** GET /api/v1/me — who is signed in, in which organization, and with which permissions. */
export const meHandler: RequestHandler[] = [
  requireAuth,
  async (req, res) => {
    sendSuccess(res, await buildSessionInfo(getAuth(req)));
  },
];
