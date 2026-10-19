import type { Logger } from 'pino';
import { EXPORT_RETENTION_DAYS } from '@catalogcraft/shared';
import type { FileStorage } from '../../services/storage/storage.js';
import { ExportModel } from '../exports/export.model.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 200;

/**
 * Deletes export files older than EXPORT_RETENTION_DAYS, and their records.
 * Nothing is lost: the reviewed rows stay, so the job can be exported again.
 * Returns how many exports were removed.
 */
export async function sweepExpiredExports(storage: FileStorage, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - EXPORT_RETENTION_DAYS * DAY_MS);
  let removed = 0;
  for (;;) {
    const expired = await ExportModel.find({ createdAt: { $lt: cutoff } }).select('storageKey').limit(BATCH).lean();
    if (expired.length === 0) return removed;
    // File first, then record: if deleting the file fails, the record stays and the next sweep retries.
    const results = await Promise.allSettled(expired.map((item) => storage.delete(item.storageKey)));
    const deletable = expired.filter((_, index) => results[index]!.status === 'fulfilled').map((item) => item._id);
    await ExportModel.deleteMany({ _id: { $in: deletable } });
    removed += deletable.length;
    if (deletable.length < expired.length) return removed; // storage trouble: stop, try again next time
  }
}

/** Runs the retention sweep shortly after start-up and then every few hours. */
export class RetentionScheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly options: { storage: FileStorage; logger: Logger; intervalMs?: number },
  ) {}

  start(): void {
    const run = () => {
      sweepExpiredExports(this.options.storage)
        .then((removed) => {
          if (removed > 0) this.options.logger.info({ removed }, 'Deleted expired export files');
        })
        .catch((error: unknown) => this.options.logger.error({ err: error }, 'Retention sweep failed'));
    };
    this.timer = setInterval(run, this.options.intervalMs ?? 6 * 60 * 60 * 1000);
    this.timer.unref();
    setTimeout(run, 30_000).unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
