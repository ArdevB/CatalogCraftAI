import { z } from 'zod';

/**
 * Every API response uses one of two envelopes so the frontend can handle
 * results and failures in a single, predictable way:
 *
 *   { "success": true,  "data": ..., "message"?: "..." }
 *   { "success": false, "error": { "code": "...", "message": "...", "details"?: [...] } }
 */

export const ERROR_CODES = [
  'BAD_REQUEST',
  'INVALID_JSON',
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'PLAN_LIMIT_REACHED',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'INVALID_FILE',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
  'AI_NOT_CONFIGURED',
  'INTERNAL_ERROR',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const validationIssueDetailSchema = z.object({
  /** Dot-separated location of the problem, e.g. `body.email` or `query.page`. */
  path: z.string(),
  message: z.string(),
});
export type ValidationIssueDetail = z.infer<typeof validationIssueDetailSchema>;

export const apiErrorBodySchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
  details: z.array(validationIssueDetailSchema).optional(),
  /** Present on unexpected server errors: matches the X-Request-Id header and the server log line. */
  requestId: z.string().optional(),
});
export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;

export const apiErrorResponseSchema = z.object({
  success: z.literal(false),
  error: apiErrorBodySchema,
});
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;

/** Builds a schema for a successful envelope wrapping `data`. */
export function apiSuccessResponseSchema<T extends z.ZodType>(data: T) {
  return z.object({
    success: z.literal(true),
    data,
    message: z.string().optional(),
  });
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  message?: string;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;
