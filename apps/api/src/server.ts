import { MongoStore } from 'connect-mongo';
import mongoose from 'mongoose';
import { createApp } from './app.js';
import { connectWithRetry, disconnectDatabase } from './config/database.js';
import { ConfigError, loadConfig, type AppConfig } from './config/env.js';
import { loadRootEnvFile } from './config/load-env-file.js';
import { createLogger } from './config/logger.js';
import { EnrichmentWorker } from './modules/enrichment/enrichment.worker.js';
import { RetentionScheduler } from './modules/retention/retention.js';
import { AnthropicProvider } from './services/ai/anthropic-provider.js';
import { createMailer } from './services/email/mailer.js';
import { createWebhookReporter } from './services/monitoring/error-alerts.js';
import { createStorage } from './services/storage/storage.js';

loadRootEnvFile();

function loadConfigOrExit(): AppConfig {
  try {
    return loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`\n${error.message}\n\nCopy .env.example to .env in the repository root and fix the values above.\n`);
      process.exit(1);
    }
    throw error;
  }
}

const config = loadConfigOrExit();
const logger = createLogger(config);
const shutdownController = new AbortController();

const connected = connectWithRetry(config.mongodbUri, logger, shutdownController.signal);

// Sessions share Mongoose's MongoDB connection instead of opening a second one.
// Until the database connects, requests that need sessions get a 503 anyway.
const sessionStore = MongoStore.create({
  clientPromise: connected.then(() => mongoose.connection.getClient()),
  collectionName: 'sessions',
  ttl: config.session.ttlMs / 1000,
  // Write the expiry back to MongoDB at most every 5 minutes, not on every request.
  touchAfter: 5 * 60,
});

const storage = createStorage(config);
logger.info(`File storage: ${config.storage.driver === 's3' ? `S3 bucket "${config.storage.bucket}"` : config.storageDir}`);
// AI is optional: without a key the app runs and AI features say they are not configured.
const ai = config.ai.apiKey ? new AnthropicProvider({ ...config.ai, apiKey: config.ai.apiKey }) : null;
if (!ai) logger.warn('AI enrichment is disabled: set AI_API_KEY in .env to enable it.');

const reportError = config.errorAlertWebhookUrl
  ? createWebhookReporter({ webhookUrl: config.errorAlertWebhookUrl, environment: config.nodeEnv, logger })
  : undefined;

const mailer = createMailer(config, logger);
logger.info(
  `Email: ${config.email.driver === 'smtp' ? `SMTP via ${config.email.smtp?.host}` : config.email.driver === 'log' ? 'written to this log (development)' : 'off'}`,
);

const app = createApp({ config, logger, sessionStore, storage, ai, mailer, reportError });

// The enrichment worker starts once the database is connected.
const worker = ai ? new EnrichmentWorker({ provider: ai, logger, concurrency: config.ai.concurrency }) : null;
// Deletes expired export files every few hours (see EXPORT_RETENTION_DAYS).
const retention = new RetentionScheduler({ storage, logger });
void connected.then(() => {
  if (shutdownController.signal.aborted) return;
  worker?.start();
  retention.start();
});

const server = app.listen(config.port, () => {
  logger.info(`API listening on http://localhost:${config.port}/api/v1 (${config.nodeEnv})`);
});

server.on('error', (error) => {
  logger.fatal({ err: error }, `Could not start the HTTP server on port ${config.port}.`);
  process.exit(1);
});

/** Stop accepting requests, let in-flight ones finish, then close MongoDB. */
async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received, shutting down`);
  shutdownController.abort();
  retention.stop();
  // Let products already being enriched finish and save; others resume after restart.
  await worker?.stop();
  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out; forcing exit');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close(async () => {
    try {
      await disconnectDatabase();
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'Error while closing the database connection');
      process.exit(1);
    }
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
  reportError?.({ message: `Unhandled promise rejection: ${reason instanceof Error ? reason.message : String(reason)}` });
});
// A crash leaves the process in an unknown state: log it, alert, and exit so the host restarts a clean one.
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception — exiting');
  reportError?.({ message: `Crashed: ${error.message}` });
  setTimeout(() => process.exit(1), 1_000).unref();
});
