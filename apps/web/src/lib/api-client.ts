import { z } from 'zod';
import {
  apiErrorResponseSchema,
  apiSuccessResponseSchema,
  type ErrorCode,
  type ValidationIssueDetail,
} from '@catalogcraft/shared';

/**
 * In development, `/api/v1` is proxied by Vite to the Express server. In
 * production, either serve the API under the same domain or set
 * VITE_API_BASE_URL (e.g. https://api.example.com/api/v1).
 */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';

const successEnvelopeSchema = apiSuccessResponseSchema(z.unknown());

/** Error codes that only the browser can produce (the request never got a valid answer). */
export type ClientErrorCode = 'NETWORK_ERROR' | 'INVALID_RESPONSE';

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | ClientErrorCode,
    message: string,
    readonly status: number | null,
    readonly details: ValidationIssueDetail[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
};

/**
 * Calls the API and returns the validated `data` field.
 *
 * Every response is checked against a Zod schema, so a mismatched or broken
 * response becomes a clear `INVALID_RESPONSE` error instead of `undefined`
 * values silently flowing through the UI.
 */
export async function apiRequest<T extends z.ZodType>(
  path: string,
  dataSchema: T,
  { method = 'GET', body, signal }: RequestOptions = {},
): Promise<z.infer<T>> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      signal,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('NETWORK_ERROR', 'Could not reach the CatalogCraft API. Check that it is running.', null);
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new ApiError(
      'INVALID_RESPONSE',
      `The API returned an unreadable response (HTTP ${response.status}).`,
      response.status,
    );
  }

  if (!response.ok) {
    const failure = apiErrorResponseSchema.safeParse(json);
    if (failure.success) {
      const { code, message, details } = failure.data.error;
      throw new ApiError(code, message, response.status, details);
    }
    throw new ApiError('INVALID_RESPONSE', `The API request failed (HTTP ${response.status}).`, response.status);
  }

  const envelope = successEnvelopeSchema.safeParse(json);
  const data = envelope.success ? dataSchema.safeParse(envelope.data.data) : null;
  if (!data?.success) {
    throw new ApiError('INVALID_RESPONSE', 'The API returned data in an unexpected format.', response.status);
  }
  return data.data;
}
