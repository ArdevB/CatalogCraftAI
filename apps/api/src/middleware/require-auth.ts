import type { Request, RequestHandler } from 'express';
import { hasPermission, type Permission, type Role } from '@catalogcraft/shared';
import { UserModel } from '../modules/auth/user.model.js';
import { findDefaultMembership, MembershipModel } from '../modules/memberships/membership.model.js';
import { AppError } from '../utils/app-error.js';
import { destroySession } from '../utils/session.js';

export type AuthContext = {
  userId: string;
  /** The organization every tenant-owned query in this request must be scoped to. */
  organizationId: string;
  role: Role;
  user: { id: string; name: string; email: string };
};

/**
 * Verifies the signed-in user on every request:
 *   1. the session names a user,
 *   2. that user still exists and is active,
 *   3. they are *still* a member of the session's organization (re-checked
 *      each time, so removing someone's membership takes effect immediately).
 *
 * The organization id comes from the server-side session and is confirmed
 * against the Membership collection — never from anything the browser sends.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  await loadAuthContext(req);
  next();
};

/** Runs the checks above, stores the result on `req.auth` and returns it. */
export async function loadAuthContext(req: Request): Promise<AuthContext> {
  const { userId, organizationId } = req.session;
  if (!userId) {
    throw new AppError('UNAUTHENTICATED', 'Please sign in to continue.');
  }

  const user = await UserModel.findById(userId).lean();
  if (!user || user.status !== 'active') {
    await destroySession(req);
    throw new AppError('UNAUTHENTICATED', 'Your session has ended. Please sign in again.');
  }

  // Sessions started before a password change (or reset) end here.
  const authVersion = user.authVersion ?? 0;
  if (req.session.authVersion === undefined) {
    req.session.authVersion = authVersion; // set on the request that signs in
  } else if (req.session.authVersion !== authVersion) {
    await destroySession(req);
    throw new AppError('UNAUTHENTICATED', 'Your password was changed. Please sign in again.');
  }

  let membership = organizationId ? await MembershipModel.findOne({ userId, organizationId }).lean() : null;
  if (!membership) {
    // Removed from the active organization: fall back to another one, if any.
    membership = await findDefaultMembership(userId);
    if (!membership) {
      await destroySession(req);
      throw new AppError('UNAUTHENTICATED', 'Your account no longer belongs to an organization.');
    }
    req.session.organizationId = membership.organizationId.toString();
  }

  req.auth = {
    userId,
    organizationId: membership.organizationId.toString(),
    role: membership.role,
    user: { id: userId, name: user.name, email: user.email },
  };
  return req.auth;
}

/** Returns the verified auth context. Only call in handlers behind `requireAuth`. */
export function getAuth(req: Request): AuthContext {
  if (!req.auth) {
    // A route was registered without requireAuth — fail closed.
    throw new AppError('UNAUTHENTICATED', 'Please sign in to continue.');
  }
  return req.auth;
}

/** Allows the request only if the user's role grants `permission` (see shared PERMISSIONS). */
export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    if (!hasPermission(getAuth(req).role, permission)) {
      throw new AppError('FORBIDDEN', 'Your role does not allow this action.');
    }
    next();
  };
}
