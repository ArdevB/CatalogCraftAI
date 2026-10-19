import type { Logger } from 'pino';

export type ErrorEvent = {
  message: string;
  requestId?: string;
  /** e.g. "POST /api/v1/jobs/…/export" — never a query string or body. */
  route?: string;
};

export type ErrorReporter = (event: ErrorEvent) => void;

/** Error messages can quote data (a duplicate-key error names the duplicated value): strip that before it leaves the server. */
export function scrubErrorMessage(message: string): string {
  return message
    .replace(/dup key:.*$/s, 'dup key: [redacted]')
    .replace(/[^\s@"'<>]+@[^\s@"'<>]+\.[a-z]{2,}/gi, '[email]')
    .slice(0, 300);
}

/**
 * Free error alerts: posts a one-line message to a Slack or Discord incoming
 * webhook (`ERROR_ALERT_WEBHOOK_URL`). Only the error message, request id and
 * route are sent — never request bodies, product data or personal details.
 *
 * At most one alert a minute; errors in between are counted and mentioned in
 * the next alert, so a crash loop can't flood the channel.
 */
export function createWebhookReporter(options: {
  webhookUrl: string;
  environment: string;
  logger: Logger;
  minIntervalMs?: number;
  fetchImpl?: typeof fetch;
}): ErrorReporter {
  const minInterval = options.minIntervalMs ?? 60_000;
  const send = options.fetchImpl ?? fetch;
  let lastSentAt = 0;
  let suppressed = 0;

  return (event) => {
    const now = Date.now();
    if (now - lastSentAt < minInterval) {
      suppressed += 1;
      return;
    }
    lastSentAt = now;
    const extra = suppressed > 0 ? ` (+${suppressed} more since the last alert)` : '';
    suppressed = 0;
    const text =
      `CatalogCraft API error [${options.environment}]: ${scrubErrorMessage(event.message)}${extra}` +
      (event.route ? `\nRoute: ${event.route}` : '') +
      (event.requestId ? `\nRequest id: ${event.requestId} (search the logs for it)` : '');

    // Slack reads `text`, Discord reads `content`; each ignores the other.
    send(options.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, content: text }),
      signal: AbortSignal.timeout(5_000),
    }).catch((error: unknown) => options.logger.warn({ err: error }, 'Could not send the error alert'));
  };
}
