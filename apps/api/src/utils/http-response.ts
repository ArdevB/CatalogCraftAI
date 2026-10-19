import type { Response } from 'express';
import type { ApiErrorResponse, ApiSuccessResponse, ErrorCode, ValidationIssueDetail } from '@catalogcraft/shared';

export function sendSuccess<T>(res: Response, data: T, options: { status?: number; message?: string } = {}): void {
  const body: ApiSuccessResponse<T> = { success: true, data };
  if (options.message) body.message = options.message;
  res.status(options.status ?? 200).json(body);
}

export function sendError(
  res: Response,
  status: number,
  code: ErrorCode,
  message: string,
  details?: ValidationIssueDetail[],
  /** Only for unexpected errors, so the user can quote it to support. */
  requestId?: string,
): void {
  const body: ApiErrorResponse = { success: false, error: { code, message } };
  if (details && details.length > 0) body.error.details = details;
  if (requestId) body.error.requestId = requestId;
  res.status(status).json(body);
}
