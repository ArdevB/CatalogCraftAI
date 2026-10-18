import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import type { RequestHandler } from 'express';
import type { AppConfig } from '../config/env.js';
import { sendError } from '../utils/http-response.js';

/**
 * Security headers. This is a JSON API, so we use the strictest Content
 * Security Policy: it never serves HTML or scripts.
 */
export function securityHeaders(): RequestHandler {
  return helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
}

/**
 * Only the configured web app origin(s) may call the API from a browser with
 * cookies. Requests without an Origin header (curl, server-to-server, health
 * checks) are not affected by CORS at all.
 */
export function corsPolicy(config: Pick<AppConfig, 'webOrigins'>): RequestHandler {
  const allowed = new Set(config.webOrigins);
  return cors({
    origin: (origin, callback) => callback(null, origin === undefined || allowed.has(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    maxAge: 600,
  });
}

/** Per-IP request limit for the whole API. Stricter limits for login etc. come later. */
export function apiRateLimit(config: Pick<AppConfig, 'rateLimit'>): RequestHandler {
  return rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: config.rateLimit.max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      sendError(res, 429, 'RATE_LIMITED', 'Too many requests. Please wait a moment and try again.');
    },
  });
}
