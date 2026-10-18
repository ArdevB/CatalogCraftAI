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
