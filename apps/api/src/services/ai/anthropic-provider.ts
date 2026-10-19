import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { AppConfig } from '../../config/env.js';
import { AiProviderError, type AiJsonRequest, type AiJsonResult, type AiProvider } from './provider.js';

/**
 * Models that support Anthropic's server-side refusal fallback. If the model
 * declines a request for safety reasons, the API retries it on a suitable
 * fallback model within the same call. Other models (e.g. Claude Haiku) simply
 * report the refusal, which we record as a failed row.
 */
const SERVER_FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);

type MessagesClient = Pick<Anthropic, 'beta'>;
type ProviderOptions = AppConfig['ai'] & { apiKey: string };

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private readonly client: MessagesClient;

  constructor(
    private readonly options: ProviderOptions,
    /** Injectable for tests; normally a real SDK client. */
    client?: MessagesClient,
  ) {
    this.model = options.model;
    // The SDK retries rate limits (429), overloads (5xx) and network errors
    // itself, with exponential backoff, up to `maxRetries` times.
    this.client = client ?? new Anthropic({ apiKey: options.apiKey, timeout: options.timeoutMs, maxRetries: options.maxRetries });
  }

  async generateJson<T>(request: AiJsonRequest<T>): Promise<AiJsonResult<T>> {
    let response;
    try {
      response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: this.options.maxOutputTokens,
        system: request.system,
        messages: [{ role: 'user', content: request.user }],
        // Structured output: the API constrains the answer to this JSON schema,
        // and the SDK validates it with the same Zod schema.
        output_config: { format: betaZodOutputFormat(request.schema), effort: this.options.effort },
        ...(SERVER_FALLBACK_MODELS.has(this.model)
          ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
          : {}),
      });
    } catch (error) {
      throw toProviderError(error);
    }

    const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
    const model = response.model;

    if (response.stop_reason === 'refusal') {
      return { ok: false, reason: 'refused', message: 'The AI declined to write copy for this product.', model, usage };
    }
    if (response.stop_reason === 'max_tokens') {
      return { ok: false, reason: 'truncated', message: 'The AI response was cut off before it finished.', model, usage };
    }
    if (response.parsed_output === null || response.parsed_output === undefined) {
      return { ok: false, reason: 'invalid_output', message: 'The AI response was not in the expected format.', model, usage };
    }
    return { ok: true, data: response.parsed_output as T, model, usage };
  }
}

/**
 * The human-readable message from an API error body
 * (`{ type: "error", error: { type, message } }`), shortened for display.
 * It describes the request problem, never the API key, so it is safe to show.
 */
function apiErrorMessage(error: InstanceType<typeof Anthropic.APIError>): string | null {
  const body = error.error as { error?: { message?: unknown } } | undefined;
  const message = body?.error?.message;
  return typeof message === 'string' && message.trim() ? message.trim().slice(0, 300) : null;
}

/** Maps SDK errors (most specific first) to the three kinds the worker acts on. */
function toProviderError(error: unknown): AiProviderError {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new AiProviderError('The AI service rejected the API key. Check AI_API_KEY.', 'configuration', { cause: error });
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new AiProviderError('The configured AI model was not found. Check AI_MODEL.', 'configuration', { cause: error });
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AiProviderError('The AI service is rate limiting requests. Try again shortly.', 'transient', { cause: error });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    // Includes timeouts (APIConnectionTimeoutError).
    return new AiProviderError('Could not reach the AI service (network error or timeout).', 'transient', { cause: error });
  }
  if (error instanceof Anthropic.BadRequestError) {
    const detail = apiErrorMessage(error);
    // Anthropic reports an empty credit balance as a plain 400 (no dedicated
    // error type), so it is recognised by its message. Like a bad key, it
    // affects every request: stop the run at once instead of failing each product.
    if (detail && /credit balance/i.test(detail)) {
      return new AiProviderError(
        'Your Anthropic account has no API credit left. Add credits under Plans & Billing at console.anthropic.com, then start enrichment again.',
        'configuration',
        { cause: error },
      );
    }
    return new AiProviderError(
      detail ? `The AI service rejected the request: ${detail}` : 'The AI service rejected the request.',
      'request',
      { cause: error },
    );
  }
  if (error instanceof Anthropic.APIError) {
    const transient = error.status === undefined || error.status >= 500;
    return new AiProviderError(
      transient ? 'The AI service is temporarily unavailable.' : `The AI service returned an error (${error.status}).`,
      transient ? 'transient' : 'request',
      { cause: error },
    );
  }
  return new AiProviderError('Unexpected error while calling the AI service.', 'request', { cause: error });
}
