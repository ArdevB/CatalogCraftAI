import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError } from '../utils/app-error.js';
import { sendError } from '../utils/http-response.js';

/** Unmatched routes get a JSON 404 instead of Express's default HTML page. */
export const notFoundHandler: RequestHandler = (req, res) => {
  sendError(res, 404, 'NOT_FOUND', `Route ${req.method} ${req.path} was not found.`);
};

/** Errors raised by Express's body parser carry a `type` string. */
function bodyParserErrorType(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'type' in error && typeof error.type === 'string') {
    return error.type;
  }
  return undefined;
}

/**
 * The single place where errors become HTTP responses.
 *
 * - `AppError`s are expected and their message is shown to the user.
 * - Anything else is a bug: we log the full error server-side (with the
 *   request id for tracing) but return a generic message, so stack traces and
 *   internals never reach the browser.
 *
 * Express 5 forwards rejected promises from async handlers here automatically.
 */
export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof AppError) {
    if (error.statusCode >= 500) req.log.error({ err: error }, error.message);
    sendError(res, error.statusCode, error.code, error.message, error.details);
    return;
  }

  switch (bodyParserErrorType(error)) {
    case 'entity.parse.failed':
      sendError(res, 400, 'INVALID_JSON', 'The request body is not valid JSON.');
      return;
    case 'entity.too.large':
      sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.');
      return;
  }

  req.log.error({ err: error }, 'Unhandled error');
  sendError(res, 500, 'INTERNAL_ERROR', 'Something went wrong on our side. Please try again.');
};
