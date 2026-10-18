import { z } from 'zod';

/** Mirrors Mongoose connection states, reduced to the ones we report. */
export const databaseStatusSchema = z.enum(['connected', 'connecting', 'disconnected', 'disconnecting']);
export type DatabaseStatus = z.infer<typeof databaseStatusSchema>;

export const healthSchema = z.object({
  /** `ok` when every dependency is reachable, `degraded` otherwise. */
  status: z.enum(['ok', 'degraded']),
  service: z.string(),
  version: z.string(),
  environment: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  timestamp: z.iso.datetime(),
  checks: z.object({
    database: databaseStatusSchema,
  }),
});
export type Health = z.infer<typeof healthSchema>;
