import mongoose from 'mongoose';
import type { Logger } from 'pino';
import type { DatabaseStatus } from '@catalogcraft/shared';

/**
 * By default Mongoose queues queries while disconnected and waits forever.
 * Turning that off makes requests fail fast with a clear "database
 * unavailable" error instead of hanging.
 */
mongoose.set('bufferCommands', false);
mongoose.set('strictQuery', true);
// With buffering off, Mongoose's automatic index build would run before the
// connection exists and fail silently. We build indexes explicitly instead,
// right after connecting (see `ensureIndexes`).
mongoose.set('autoCreate', false);
mongoose.set('autoIndex', false);

const RETRY_DELAY_MS = 5_000;

export function getDatabaseStatus(): DatabaseStatus {
  switch (mongoose.connection.readyState) {
    case mongoose.ConnectionStates.connected:
      return 'connected';
    case mongoose.ConnectionStates.connecting:
      return 'connecting';
    case mongoose.ConnectionStates.disconnecting:
      return 'disconnecting';
    default:
      return 'disconnected';
  }
}

/**
 * Creates every index declared on the registered models (unique emails,
 * one membership per user per organization, tenant lookups…). Safe to run on
 * every start: existing indexes are left as they are.
 */
export async function ensureIndexes(): Promise<void> {
  await Promise.all(Object.values(mongoose.models).map((model) => model.createIndexes()));
}

/** Hides credentials when a URI has to appear in logs. */
export function redactMongoUri(uri: string): string {
  return uri.replace(/\/\/([^@/]+)@/, '//[credentials]@');
}

/**
 * Connects to MongoDB, retrying until it succeeds or `signal` is aborted.
 *
 * The HTTP server starts independently, so the health endpoint can report
 * "database disconnected" while we keep retrying — useful in development when
 * MongoDB has not been started yet. After the first successful connection,
 * the MongoDB driver handles reconnection itself.
 */
export async function connectWithRetry(uri: string, logger: Logger, signal?: AbortSignal): Promise<void> {
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));

  let attempt = 0;
  while (!signal?.aborted) {
    attempt += 1;
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 5_000 });
      logger.info({ uri: redactMongoUri(uri) }, 'MongoDB connected');
      try {
        await ensureIndexes();
      } catch (error) {
        // Usually means existing data violates a unique index. The API keeps
        // running, but uniqueness is not guaranteed until the data is fixed.
        logger.error({ err: error }, 'Failed to create MongoDB indexes');
      }
      return;
    } catch (error) {
      logger.error(
        { err: error, attempt, uri: redactMongoUri(uri) },
        `MongoDB connection failed; retrying in ${RETRY_DELAY_MS / 1000}s. Check MONGODB_URI and that MongoDB is running.`,
      );
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
