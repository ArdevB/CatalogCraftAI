import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Loads the repository-root `.env` in local development. In production the
 * hosting platform injects environment variables directly and no file exists.
 * Works from both `src/config` (tsx) and `dist/config` (built) — same depth.
 */
export function loadRootEnvFile(): void {
  const rootEnvFile = fileURLToPath(new URL('../../../../.env', import.meta.url));
  if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);
}
