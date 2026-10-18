import type { CookieOptions, RequestHandler } from 'express';
import session, { type Store } from 'express-session';
import type { AppConfig } from './env.js';

/**
 * Server-side sessions: the browser only holds a random, signed session id in
 * an httpOnly cookie (JavaScript cannot read it, so XSS cannot steal it). The
 * session data lives in MongoDB, so signing out really ends the session — the
 * server deletes it — unlike a JWT that stays valid until it expires.
 */

export function sessionCookieName(config: Pick<AppConfig, 'isProduction'>): string {
  // The __Host- prefix makes browsers refuse the cookie unless it is Secure,
  // has Path=/ and no Domain — so no subdomain can overwrite it.
  return config.isProduction ? '__Host-cc.sid' : 'cc.sid';
}

export function sessionCookieOptions(config: Pick<AppConfig, 'isProduction'>): CookieOptions {
  return {
    httpOnly: true,
    // Lax: the cookie is not sent on cross-site POST/PATCH/DELETE requests.
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
  };
}

export function sessionMiddleware(
  config: Pick<AppConfig, 'isProduction' | 'session'>,
  store: Store,
): RequestHandler {
  return session({
    name: sessionCookieName(config),
    secret: config.session.secret,
    store,
    // Only create a session (and set a cookie) once someone signs in.
    saveUninitialized: false,
    resave: false,
    // Each request pushes expiry forward: sessions end after a period of inactivity.
    rolling: true,
    unset: 'destroy',
    cookie: { ...sessionCookieOptions(config), maxAge: config.session.ttlMs },
  });
}
