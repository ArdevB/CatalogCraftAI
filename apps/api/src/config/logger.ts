import { pino, type Logger } from 'pino';
import type { AppConfig } from './env.js';
import { SERVICE_NAME } from './app-info.js';

/**
 * Structured (JSON) logging. Hosting providers and log tools can search and
 * filter JSON logs; in development we pretty-print them for readability.
 *
 * `redact` strips secrets and personal data from anything we log, so a
 * careless `logger.info({ req })` can never leak a session cookie.
 */
export function createLogger(config: Pick<AppConfig, 'logLevel' | 'nodeEnv'>): Logger {
  return pino({
    name: SERVICE_NAME,
    level: config.nodeEnv === 'test' ? 'silent' : config.logLevel,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.password',
        '*.passwordHash',
        '*.apiKey',
        '*.token',
      ],
      censor: '[redacted]',
    },
    ...(config.nodeEnv === 'development'
      ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } } }
      : {}),
  });
}

/**
 * Invitation links carry their secret token in the URL path. Logs are read by
 * more people (and tools) than the database, so request URLs are logged with
 * the token removed.
 */
export function redactUrl(url: string | undefined): string | undefined {
  return url?.replace(/\/invitations\/[A-Za-z0-9_-]{20,}/g, '/invitations/[token]');
}
