import { fileURLToPath } from 'node:url';
import { startLocalStack } from './local-stack.js';

/**
 * Started by Playwright (see playwright.config.ts): the built web app and the
 * API on one port, with a throwaway database and a scripted AI.
 */
const port = Number(process.env.E2E_PORT ?? 4199);
const webDistDir = fileURLToPath(new URL('../../web/dist', import.meta.url));

const stack = await startLocalStack({ port, webDistDir, aiLatencyMs: 150 });
console.log(`E2E stack ready on ${stack.url}`);

const stop = () => {
  void stack.close().finally(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
