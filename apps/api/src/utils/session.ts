import type { Request } from 'express';

/** Promise wrappers around express-session's callback API. */

/**
 * Issues a brand-new session id. Called at sign-in so that a session id an
 * attacker may have planted before login is never upgraded to a signed-in
 * session ("session fixation").
 */
export function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => req.session.regenerate((error) => (error ? reject(error) : resolve())));
}

export function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => req.session.save((error) => (error ? reject(error) : resolve())));
}

/** Deletes the session from the store. Safe to call when there is no session. */
export function destroySession(req: Request): Promise<void> {
  if (!req.session) return Promise.resolve();
  return new Promise((resolve, reject) => req.session.destroy((error) => (error ? reject(error) : resolve())));
}
