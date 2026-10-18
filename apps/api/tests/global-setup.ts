import { MongoMemoryServer } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

/**
 * Starts one throwaway MongoDB for the whole test run. Each test file then
 * uses its own randomly named database inside it, so files can run in
 * parallel without seeing each other's data. No real database is touched.
 *
 * The first run downloads a MongoDB binary (~800 MB, cached afterwards).
 */
let server: MongoMemoryServer | undefined;

export async function setup(project: TestProject): Promise<void> {
  server = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  project.provide('mongoUri', server.getUri());
}

export async function teardown(): Promise<void> {
  await server?.stop();
}

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}
