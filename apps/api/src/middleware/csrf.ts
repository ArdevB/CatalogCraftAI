import type { RequestHandler } from 'express';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '@catalogcraft/shared';
import type { AppConfig } from '../config/env.js';
import { AppError } from '../utils/app-error.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Cross-Site Request Forgery protection for cookie-authenticated requests.
 *
 * A malicious site can make a victim's browser *send* a request to our API
 * (with their cookie attached), but it cannot add custom headers without a
 * CORS preflight, which our CORS policy refuses. So for every state-changing
 * request we require:
 *   1. our custom header, and
 *   2. if the browser sent an Origin header, that it is our web app.
 * Combined with SameSite=Lax cookies this gives defence in depth.
 */
export function csrfProtection(config: Pick<AppConfig, 'webOrigins'>): RequestHandler {
  const allowedOrigins = new Set(config.webOrigins);

  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    if (req.get(CSRF_HEADER) !== CSRF_HEADER_VALUE) {
      throw new AppError('FORBIDDEN', 'Request blocked: missing anti-forgery header.');
    }
    const origin = req.get('Origin');
    if (origin !== undefined && !allowedOrigins.has(origin)) {
      throw new AppError('FORBIDDEN', 'Request blocked: origin not allowed.');
    }
    next();
  };
}
