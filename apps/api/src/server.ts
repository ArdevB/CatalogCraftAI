import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { connectWithRetry, disconnectDatabase } from './config/database.js';
import { ConfigError, loadConfig, type AppConfig } from './config/env.js';
import { createLogger } from './config/logger.js';

// Load the repository-root `.env` in local development. In production, the
// hosting platform injects environment variables directly and no file exists.
const rootEnvFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

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
const app = createApp({ config, logger });
const shutdownController = new AbortController();

const server = app.listen(config.port, () => {
  logger.info(`API listening on http://localhost:${config.port}/api/v1 (${config.nodeEnv})`);
});

server.on('error', (error) => {
  logger.fatal({ err: error }, `Could not start the HTTP server on port ${config.port}.`);
  process.exit(1);
});

void connectWithRetry(config.mongodbUri, logger, shutdownController.signal);

/** Stop accepting requests, let in-flight ones finish, then close MongoDB. */
async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received, shutting down`);
  shutdownController.abort();
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
});
