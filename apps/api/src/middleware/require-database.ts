import type { RequestHandler } from 'express';
import type { DatabaseStatus } from '@catalogcraft/shared';
import { AppError } from '../utils/app-error.js';

/**
 * Every route after this point needs MongoDB. If it is unreachable we answer
 * 503 straight away with a clear message, instead of letting a query fail
 * somewhere deep inside a handler with a confusing 500.
 */
export function requireDatabase(getDatabaseStatus: () => DatabaseStatus): RequestHandler {
  return (_req, _res, next) => {
    if (getDatabaseStatus() !== 'connected') {
      throw new AppError(
        'SERVICE_UNAVAILABLE',
        'The service is temporarily unavailable because the database cannot be reached. Please try again shortly.',
      );
    }
    next();
  };
}
