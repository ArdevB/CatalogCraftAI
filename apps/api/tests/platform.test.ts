import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import express from 'express';
import session from 'express-session';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createLogger, redactUrl } from '../src/config/logger.js';
import { createErrorHandler } from '../src/middleware/error-handler.js';
import { createWebhookReporter, scrubErrorMessage } from '../src/services/monitoring/error-alerts.js';
import { createStorage, LocalFileStorage, S3FileStorage } from '../src/services/storage/storage.js';
import { AppError } from '../src/utils/app-error.js';
import { testApp, testConfig, testStorage } from './helpers.js';

describe('S3-compatible storage', () => {
  const options = { bucket: 'catalogcraft-private', region: 'auto', accessKeyId: 'k', secretAccessKey: 's' };

  it('puts, gets and deletes objects in the configured bucket', async () => {
    const send = vi.fn(async (command: unknown) =>
      command instanceof GetObjectCommand ? { Body: { transformToByteArray: async () => new Uint8Array([104, 105]) } } : {},
    );
    const storage = new S3FileStorage(options, { send } as never);
    const key = 'organizations/o1/uploads/a.csv';

    await storage.put(key, Buffer.from('hi'));
    expect((await storage.get(key)).toString()).toBe('hi');
    await storage.delete(key);

    const [put, get, del] = send.mock.calls.map(([command]) => command as PutObjectCommand | GetObjectCommand | DeleteObjectCommand);
    expect(put).toBeInstanceOf(PutObjectCommand);
    expect(put!.input).toMatchObject({ Bucket: 'catalogcraft-private', Key: key, ContentLength: 2 });
    expect(get!.input).toEqual({ Bucket: 'catalogcraft-private', Key: key });
    expect(del).toBeInstanceOf(DeleteObjectCommand);
  });

  it('refuses unsafe keys before calling the service', async () => {
    const send = vi.fn();
    const storage = new S3FileStorage(options, { send } as never);
    await expect(storage.get('../other-bucket/secret')).rejects.toThrow(/unsafe storage key/);
    await expect(storage.put('/absolute', Buffer.from(''))).rejects.toThrow(/unsafe storage key/);
    expect(send).not.toHaveBeenCalled();
  });

  it('is chosen by STORAGE_DRIVER, which requires the bucket and keys', () => {
    expect(createStorage(testConfig())).toBeInstanceOf(LocalFileStorage);
    const s3 = testConfig({ STORAGE_DRIVER: 's3', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's', S3_ENDPOINT: 'https://x.r2.cloudflarestorage.com' });
    expect(createStorage(s3)).toBeInstanceOf(S3FileStorage);
    expect(() => testConfig({ STORAGE_DRIVER: 's3' })).toThrow(/S3_BUCKET is required[\s\S]*S3_ACCESS_KEY_ID is required/);
  });
});

describe('serving the web app from the API', () => {
  const distDir = path.join(tmpdir(), `catalogcraft-web-${Date.now()}`);
  beforeAll(async () => {
    await mkdir(path.join(distDir, 'assets'), { recursive: true });
    await writeFile(path.join(distDir, 'index.html'), '<!doctype html><div id="root"></div>');
    await writeFile(path.join(distDir, 'assets', 'index-abc123.js'), 'console.log(1)');
  });
  afterAll(() => rm(distDir, { recursive: true, force: true }));

  const app = () => testApp({ env: { WEB_DIST_DIR: distDir } });

  it('serves pages with their own security policy and lets the browser router handle any path', async () => {
    const page = await request(app()).get('/clients/123');
    expect(page.status).toBe(200);
    expect(page.text).toContain('<div id="root">');
    expect(page.headers['cache-control']).toBe('no-cache');
    const csp = page.headers['content-security-policy'];
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-eval');
  });

  it('caches hashed assets for a long time and 404s missing ones', async () => {
    const asset = await request(app()).get('/assets/index-abc123.js');
    expect(asset.status).toBe(200);
    expect(asset.headers['cache-control']).toContain('immutable');
    expect((await request(app()).get('/assets/missing.js')).status).toBe(404);
  });

  it('keeps the API JSON-only with its strict policy', async () => {
    const res = await request(app()).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect((await request(app()).get('/api')).body.error.code).toBe('NOT_FOUND');
  });

  it('is off unless WEB_DIST_DIR is set', async () => {
    expect((await request(testApp()).get('/clients')).body.error.code).toBe('NOT_FOUND');
  });
});

describe('error monitoring', () => {
  function errorApp(handler: express.RequestHandler, report = vi.fn()) {
    const app = express();
    app.use(pinoHttp({ logger: createLogger(testConfig({ LOG_LEVEL: 'silent' })), genReqId: () => 'req-42' }));
    app.get('/boom', handler);
    app.use(createErrorHandler(report));
    return { app, report };
  }

  it('returns a reference for unexpected errors and reports them', async () => {
    const { app, report } = errorApp(() => {
      throw new Error('database exploded');
    });
    const res = await request(app).get('/boom?secret=1');
    expect(res.status).toBe(500);
    expect(res.body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'Something went wrong on our side. Please try again.', requestId: 'req-42' });
    expect(report).toHaveBeenCalledWith({ message: 'Error: database exploded', requestId: 'req-42', route: 'GET /boom' });
  });

  it('does not report or tag expected errors', async () => {
    const { app, report } = errorApp(() => {
      throw new AppError('NOT_FOUND', 'Client not found.');
    });
    const res = await request(app).get('/boom');
    expect(res.body.error).toEqual({ code: 'NOT_FOUND', message: 'Client not found.' });
    expect(report).not.toHaveBeenCalled();
  });

  it('sends throttled webhook alerts without personal data', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const report = createWebhookReporter({
      webhookUrl: 'https://hooks.example.test/x',
      environment: 'production',
      logger: pino({ level: 'silent' }),
      fetchImpl,
    });
    report({ message: 'E11000 duplicate key error collection: users index: email_1 dup key: { email: "ada@example.test" }', requestId: 'r1' });
    report({ message: 'second' });
    report({ message: 'third' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as { text: string; content: string };
    expect(body.text).toContain('[production]');
    expect(body.text).toContain('Request id: r1');
    expect(body.text).not.toContain('ada@example.test');
    expect(body.content).toBe(body.text);
  });

  it('scrubs emails and duplicate values from messages', () => {
    expect(scrubErrorMessage('User bob@corp.example failed')).toBe('User [email] failed');
    expect(scrubErrorMessage('dup key: { sku: "SECRET" }')).toBe('dup key: [redacted]');
  });

  it('only accepts an https webhook URL', () => {
    expect(() => testConfig({ ERROR_ALERT_WEBHOOK_URL: 'http://hooks.example.test' })).toThrow(/https/);
    expect(testConfig({ ERROR_ALERT_WEBHOOK_URL: 'https://hooks.example.test/a' }).errorAlertWebhookUrl).toBe('https://hooks.example.test/a');
  });
});

describe('request logs', () => {
  it('never contain invitation tokens', async () => {
    const lines: string[] = [];
    const logger = pino({ level: 'info' }, { write: (line: string) => lines.push(line) });
    const config = testConfig();
    const app = createApp({ config, logger, sessionStore: new session.MemoryStore(), storage: testStorage, ai: null, getDatabaseStatus: () => 'connected' });
    const token = 'A'.repeat(43);

    await request(app).get(`/api/v1/invitations/${token}`);
    await new Promise((resolve) => setImmediate(resolve));
    const logged = lines.join('\n');
    expect(logged).toContain('/api/v1/invitations/[token]');
    expect(logged).not.toContain(token);
  });

  it('redacts only the token part of the URL', () => {
    expect(redactUrl('/api/v1/invitations/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG/accept')).toBe('/api/v1/invitations/[token]/accept');
    expect(redactUrl('/api/v1/organizations/current/invitations')).toBe('/api/v1/organizations/current/invitations');
  });
});

describe('local storage', () => {
  it('refuses keys that could escape the storage folder', async () => {
    const storage = new LocalFileStorage(path.join(tmpdir(), `catalogcraft-local-${Date.now()}`));
    for (const key of ['../outside.csv', 'organizations/../../outside.csv', '/etc/passwd', 'C:\\Windows\\win.ini', '']) {
      await expect(storage.put(key, Buffer.from('x')), key).rejects.toThrow(/unsafe storage key|escapes the storage root/);
    }
  });
});
