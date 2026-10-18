import type { DatabaseStatus } from '@catalogcraft/shared';
import { createApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config/env.js';
import { createLogger } from '../src/config/logger.js';

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    MONGODB_URI: 'mongodb://127.0.0.1:27017/catalogcraft-test',
    WEB_ORIGIN: 'http://localhost:5173',
    ...overrides,
  });
}

export function testApp(options: { databaseStatus?: DatabaseStatus; env?: Record<string, string> } = {}) {
  const config = testConfig(options.env);
  return createApp({
    config,
    logger: createLogger(config),
    getDatabaseStatus: () => options.databaseStatus ?? 'connected',
  });
}
