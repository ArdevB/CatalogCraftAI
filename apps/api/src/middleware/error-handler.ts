import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ErrorCode } from '@catalogcraft/shared';
import type { ErrorReporter } from '../services/monitoring/error-alerts.js';
import { AppError } from '../utils/app-error.js';
import { sendError } from '../utils/http-response.js';

const EXPECTED_UNAVAILABLE = new Set<ErrorCode>(['SERVICE_UNAVAILABLE', 'AI_NOT_CONFIGURED']);

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
 *   internals never reach the browser. The response carries the request id,
 *   so a user can quote it and the matching log line is easy to find.
 *
 * Express 5 forwards rejected promises from async handlers here automatically.
 */
export function createErrorHandler(report?: ErrorReporter): ErrorRequestHandler {
  return (error: unknown, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const requestId = String(req.id);
    const route = `${req.method} ${req.baseUrl}${req.path}`;

    if (error instanceof AppError) {
      // "Database down" and "AI not configured" are known operating conditions:
      // one warning line each, not an error with a stack trace per request.
      if (EXPECTED_UNAVAILABLE.has(error.code)) req.log.warn({ code: error.code }, error.message);
      else if (error.statusCode >= 500) {
        req.log.error({ err: error }, error.message);
        report?.({ message: error.message, requestId, route });
      }
      sendError(res, error.statusCode, error.code, error.message, error.details, error.statusCode >= 500 ? requestId : undefined);
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
    report?.({ message: error instanceof Error ? `${error.name}: ${error.message}` : 'Unhandled error', requestId, route });
    sendError(res, 500, 'INTERNAL_ERROR', 'Something went wrong on our side. Please try again.', undefined, requestId);
  };
}

export const errorHandler: ErrorRequestHandler = createErrorHandler();
