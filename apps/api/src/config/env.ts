import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),

  SESSION_SECRET: z
    .string({ error: 'SESSION_SECRET is required (see .env.example for how to generate one).' })
    .min(32, 'SESSION_SECRET must be at least 32 characters. Generate one as shown in .env.example.')
    .refine((value) => !value.includes('<') && !value.includes('change-me'), {
      error: 'SESSION_SECRET still contains the placeholder from .env.example. Generate a real one.',
    }),
  SESSION_TTL_HOURS: z.coerce.number().min(1).max(24 * 30).default(72),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().trim().min(1).default('./storage'),
  S3_BUCKET: z.string().trim().optional(),
  S3_REGION: z.string().trim().default('auto'),
  S3_ENDPOINT: z.url({ protocol: /^https?$/, error: 'S3_ENDPOINT must be an http(s) URL.' }).optional(),
  S3_ACCESS_KEY_ID: z.string().trim().optional(),
  S3_SECRET_ACCESS_KEY: z.string().trim().optional(),
  S3_FORCE_PATH_STYLE: z.stringbool().default(false),

  /** Optional: serve the built web app from the API (one service, same origin). */
  WEB_DIST_DIR: z.string().trim().optional(),
  UPLOAD_MAX_MB: z.coerce.number().min(1).max(50).default(10),
  IMPORT_MAX_ROWS: z.coerce.number().int().min(1).max(50_000).default(2_000),

  /** Optional: without a key the app runs, and AI features explain they are not configured. */
  /** Optional Slack/Discord incoming-webhook URL for error alerts. */
  ERROR_ALERT_WEBHOOK_URL: z.url({ protocol: /^https$/, error: 'ERROR_ALERT_WEBHOOK_URL must be an https URL.' }).optional(),

  AI_API_KEY: z.string().trim().optional(),
  ANTHROPIC_API_KEY: z.string().trim().optional(),
  AI_MODEL: z.string().trim().min(1).default('claude-opus-5-5'),
  AI_EFFORT: z.enum(['low', 'medium', 'high']).default('low'),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(16_000).default(4_000),
  AI_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(600_000).default(90_000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  AI_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(3),
}).superRefine((env, ctx) => {
  if (env.STORAGE_DRIVER !== 's3') return;
  for (const key of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
    if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required when STORAGE_DRIVER=s3.` });
  }
});

/** Repository root (this file lives in apps/api/{src,dist}/config). */
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

export type AppConfig = Readonly<{
  nodeEnv: z.infer<typeof envSchema>['NODE_ENV'];
  isProduction: boolean;
  port: number;
  logLevel: (typeof LOG_LEVELS)[number];
  mongodbUri: string;
  webOrigins: readonly string[];
  trustProxyHops: number;
  rateLimit: Readonly<{ windowMs: number; max: number; authMax: number }>;
  session: Readonly<{ secret: string; ttlMs: number }>;
  /** Absolute directory for private files (uploads, exports). Never served directly. */
  storageDir: string;
  storage: Readonly<
    | { driver: 'local' }
    | {
        driver: 's3';
        bucket: string;
        region: string;
        endpoint: string | undefined;
        accessKeyId: string;
        secretAccessKey: string;
        forcePathStyle: boolean;
      }
  >;
  errorAlertWebhookUrl: string | null;
  /** Absolute path of the built web app to serve, or `null` when the web app is hosted separately. */
  webDistDir: string | null;
  imports: Readonly<{ maxUploadBytes: number; maxRows: number }>;
  ai: Readonly<{
    /** `null` when no key is configured: AI features are then disabled. */
    apiKey: string | null;
    model: string;
    effort: 'low' | 'medium' | 'high';
    maxOutputTokens: number;
    timeoutMs: number;
    maxRetries: number;
    /** Products processed at the same time by the background worker. */
    concurrency: number;
  }>;
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
    rateLimit: Object.freeze({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX,
      authMax: env.AUTH_RATE_LIMIT_MAX,
    }),
    session: Object.freeze({ secret: env.SESSION_SECRET, ttlMs: env.SESSION_TTL_HOURS * 60 * 60 * 1000 }),
    storageDir: path.resolve(REPO_ROOT, env.STORAGE_LOCAL_DIR),
    storage: Object.freeze(
      env.STORAGE_DRIVER === 's3'
        ? {
            driver: 's3' as const,
            bucket: env.S3_BUCKET!,
            region: env.S3_REGION,
            endpoint: env.S3_ENDPOINT,
            accessKeyId: env.S3_ACCESS_KEY_ID!,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
            forcePathStyle: env.S3_FORCE_PATH_STYLE,
          }
        : { driver: 'local' as const },
    ),
    errorAlertWebhookUrl: env.ERROR_ALERT_WEBHOOK_URL ?? null,
    webDistDir: env.WEB_DIST_DIR ? path.resolve(REPO_ROOT, env.WEB_DIST_DIR) : null,
    imports: Object.freeze({ maxUploadBytes: Math.round(env.UPLOAD_MAX_MB * 1024 * 1024), maxRows: env.IMPORT_MAX_ROWS }),
    ai: Object.freeze({
      apiKey: env.AI_API_KEY || env.ANTHROPIC_API_KEY || null,
      model: env.AI_MODEL,
      effort: env.AI_EFFORT,
      maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS,
      timeoutMs: env.AI_TIMEOUT_MS,
      maxRetries: env.AI_MAX_RETRIES,
      concurrency: env.AI_CONCURRENCY,
    }),
  });
}
