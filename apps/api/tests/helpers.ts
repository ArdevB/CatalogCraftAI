import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MongoStore } from 'connect-mongo';
import session from 'express-session';
import mongoose from 'mongoose';
import request from 'supertest';
import { inject } from 'vitest';
import {
  CSRF_HEADER,
  CSRF_HEADER_VALUE,
  type DatabaseStatus,
  type PlanId,
  type RegisterInput,
  type Role,
} from '@catalogcraft/shared';
import { createApp } from '../src/app.js';
import { ensureIndexes, getDatabaseStatus } from '../src/config/database.js';
import { loadConfig, type AppConfig } from '../src/config/env.js';
import { createLogger } from '../src/config/logger.js';
import type { AiProvider } from '../src/services/ai/provider.js';
import { LocalFileStorage } from '../src/services/storage/storage.js';
// Importing the models registers them with Mongoose.
import '../src/modules/auth/user.model.js';
import '../src/modules/catalog-jobs/catalog-job.model.js';
import '../src/modules/catalog-rows/catalog-row.model.js';
import '../src/modules/clients/client.model.js';
import '../src/modules/usage/usage-event.model.js';
import '../src/modules/audit/audit-log.model.js';
import '../src/modules/exports/export.model.js';
import { MembershipModel } from '../src/modules/memberships/membership.model.js';
import { OrganizationModel } from '../src/modules/organizations/organization.model.js';

export const TEST_ORIGIN = 'http://localhost:5173';

/** Private storage for this test file, in a throwaway temp folder. */
export const testStorageDir = path.join(tmpdir(), `catalogcraft-test-${randomUUID()}`);
export const testStorage = new LocalFileStorage(testStorageDir);

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    MONGODB_URI: 'mongodb://127.0.0.1:27017/catalogcraft-test',
    WEB_ORIGIN: TEST_ORIGIN,
    SESSION_SECRET: 'test-session-secret-that-is-long-enough-1234',
    STORAGE_LOCAL_DIR: testStorageDir,
    ...overrides,
  });
}

/** App without a database, for middleware tests. Sessions live in memory. */
export function testApp(options: { databaseStatus?: DatabaseStatus; env?: Record<string, string>; ai?: AiProvider | null } = {}) {
  const config = testConfig(options.env);
  return createApp({
    config,
    logger: createLogger(config),
    sessionStore: new session.MemoryStore(),
    storage: testStorage,
    ai: options.ai ?? null,
    getDatabaseStatus: () => options.databaseStatus ?? 'connected',
  });
}

/** Connects Mongoose to a fresh, uniquely named database in the test MongoDB. */
export async function connectTestDatabase(): Promise<void> {
  await mongoose.connect(inject('mongoUri'), { dbName: `test_${randomUUID().slice(0, 8)}` });
  // Same index build as the real server, so duplicate-key behaviour is real in tests.
  await ensureIndexes();
}

export async function disconnectTestDatabase(): Promise<void> {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await rm(testStorageDir, { recursive: true, force: true });
}

/** The full app wired to the test database, with sessions stored in MongoDB like production. */
export function dbTestApp(env: Record<string, string> = {}, options: { ai?: AiProvider | null } = {}) {
  const config = testConfig(env);
  return createApp({
    config,
    logger: createLogger(config),
    sessionStore: MongoStore.create({ client: mongoose.connection.getClient(), ttl: 3600 }),
    storage: testStorage,
    ai: options.ai ?? null,
    getDatabaseStatus,
  });
}

/** A cookie-keeping client that sends the anti-forgery header like the real web app. */
export function browser(app: Parameters<typeof request.agent>[0]) {
  const agent = request.agent(app);
  agent.set(CSRF_HEADER, CSRF_HEADER_VALUE).set('Origin', TEST_ORIGIN);
  return agent;
}

type App = ReturnType<typeof dbTestApp>;

/** Registers a new agency through the API and returns a signed-in client plus its ids. */
export async function newAgency(app: App, options: { plan?: PlanId } = {}) {
  const client = browser(app);
  const input = registration();
  const res = await client.post('/api/v1/auth/register').send(input).expect(201);
  const organizationId = res.body.data.organization.id as string;
  if (options.plan) await OrganizationModel.updateOne({ _id: organizationId }, { plan: options.plan });
  return { client, input, userId: res.body.data.user.id as string, organizationId };
}

/**
 * There is no invitation flow yet, so tests add teammates directly in the
 * database and then sign in as them through the real login endpoint.
 */
export async function addTeammate(app: App, organizationId: string, role: Role) {
  const other = await newAgency(app);
  await MembershipModel.deleteMany({ userId: other.userId });
  await OrganizationModel.deleteOne({ _id: other.organizationId });
  await MembershipModel.create({ organizationId, userId: other.userId, role });

  const client = browser(app);
  await client.post('/api/v1/auth/login').send({ email: other.input.email, password: other.input.password }).expect(200);
  return { client, userId: other.userId };
}

let counter = 0;
export function registration(overrides: Partial<RegisterInput> = {}): RegisterInput {
  counter += 1;
  return {
    name: `Test User ${counter}`,
    email: `user${counter}-${randomUUID().slice(0, 6)}@example.test`,
    password: 'a-long-test-password',
    organizationName: `Agency ${counter}`,
    ...overrides,
  };
}
