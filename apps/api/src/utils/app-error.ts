import type { ErrorCode, ValidationIssueDetail } from '@catalogcraft/shared';

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  INVALID_JSON: 400,
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  PLAN_LIMIT_REACHED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  INVALID_FILE: 422,
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
  AI_NOT_CONFIGURED: 503,
  INTERNAL_ERROR: 500,
};

/**
 * An error that is safe to show to the user. Throw it from anywhere in a
 * request; the central error handler turns it into the standard JSON error
 * response. Any *other* error is treated as a bug and returned as a generic
 * 500 without internal details.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly details: ValidationIssueDetail[] | undefined;

  constructor(
    readonly code: ErrorCode,
    message: string,
    options: { statusCode?: number; details?: ValidationIssueDetail[]; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.statusCode = options.statusCode ?? DEFAULT_STATUS[code];
    this.details = options.details;
  }
}
