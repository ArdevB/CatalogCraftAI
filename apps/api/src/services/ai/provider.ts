import type { z } from 'zod';

/**
 * The boundary between business logic and any particular AI vendor.
 * Enrichment code only ever talks to this interface, so switching provider
 * (or using a mock in tests) never touches the rest of the app.
 */
export interface AiProvider {
  /** e.g. "anthropic" — stored with each suggestion for traceability. */
  readonly name: string;
  readonly model: string;
  /** Asks for a JSON answer matching `schema`. Throws `AiProviderError` when the service itself fails. */
  generateJson<T>(request: AiJsonRequest<T>): Promise<AiJsonResult<T>>;
}

export type AiUsage = { inputTokens: number; outputTokens: number };

export type AiJsonRequest<T> = {
  system: string;
  user: string;
  schema: z.ZodType<T>;
};

/** The model answered, but not always usably. Nothing is ever saved from a failed result. */
export type AiJsonResult<T> =
  | { ok: true; data: T; model: string; usage: AiUsage }
  | {
      ok: false;
      reason: 'refused' | 'truncated' | 'invalid_output';
      message: string;
      model: string;
      usage: AiUsage;
    };

/**
 * The AI service could not be used at all.
 * - `transient`: rate limit, overload, timeout, network — worth trying later.
 * - `configuration`: bad API key, unknown model, no permission — stop and fix settings.
 * - `request`: the service rejected this particular request.
 */
export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'transient' | 'configuration' | 'request',
    options: { cause?: unknown } = {},
  ) {
    super(message, options);
    this.name = 'AiProviderError';
  }
}
