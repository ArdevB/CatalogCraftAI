import { z } from 'zod';

/**
 * All configuration comes from environment variables and is validated once at
 * startup. If something is missing or malformed the API refuses to start and
 * says exactly which variable is wrong — far easier to debug than a crash deep
 * inside a request handler later.
 */

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),

  MONGODB_URI: z
    .string({ error: 'MONGODB_URI is required (see .env.example).' })
    .trim()
    .regex(/^mongodb(\+srv)?:\/\/.+/, {
      // Show only the scheme part of the value (never credentials) so typos such
      // as quotes or a duplicated "MONGODB_URI=" prefix are easy to spot.
      error: (issue) =>
        `MONGODB_URI must start with mongodb:// or mongodb+srv:// (yours starts with "${String(issue.input).split('//')[0]}//…")`,
    }),

  WEB_ORIGIN: z
    .string()
    .default('http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.url({ protocol: /^https?$/, error: 'WEB_ORIGIN must contain http(s) URLs.' })).min(1)),

  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
});

export type AppConfig = Readonly<{
  nodeEnv: z.infer<typeof envSchema>['NODE_ENV'];
  isProduction: boolean;
  port: number;
  logLevel: (typeof LOG_LEVELS)[number];
  mongodbUri: string;
  webOrigins: readonly string[];
  trustProxyHops: number;
  rateLimit: Readonly<{ windowMs: number; max: number }>;
}>;

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid environment configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  // Treat empty strings ("PORT=") as unset so defaults apply.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const result = envSchema.safeParse(cleaned);

  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`),
    );
  }

  const env = result.data;
  return Object.freeze({
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    mongodbUri: env.MONGODB_URI,
    webOrigins: Object.freeze([...env.WEB_ORIGIN]),
    trustProxyHops: env.TRUST_PROXY_HOPS,
    rateLimit: Object.freeze({ windowMs: env.RATE_LIMIT_WINDOW_MS, max: env.RATE_LIMIT_MAX }),
  });
}
