import express from 'express';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { apiErrorResponseSchema } from '@catalogcraft/shared';
import { createLogger } from '../src/config/logger.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { AppError } from '../src/utils/app-error.js';
import { testApp, testConfig } from './helpers.js';

/** A minimal app with the real error handler, for routes that throw on purpose. */
function errorApp(handler: express.RequestHandler) {
  const app = express();
  app.use(pinoHttp({ logger: createLogger(testConfig()) }));
  app.get('/boom', handler);
  app.use(errorHandler);
  return app;
}

describe('error handling', () => {
  it('returns a JSON 404 for unknown routes', async () => {
    const res = await request(testApp()).get('/api/v1/does-not-exist');

    expect(res.status).toBe(404);
    expect(apiErrorResponseSchema.parse(res.body).error.code).toBe('NOT_FOUND');
  });

  it('rejects malformed JSON bodies with INVALID_JSON', async () => {
    const res = await request(testApp())
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('rejects oversized JSON bodies with PAYLOAD_TOO_LARGE', async () => {
    const res = await request(testApp())
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ blob: 'x'.repeat(1_100_000) }));

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('turns AppError into its status and safe message', async () => {
    const res = await request(
      errorApp(() => {
        throw new AppError('CONFLICT', 'A client with this name already exists.');
      }),
    ).get('/boom');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'CONFLICT', message: 'A client with this name already exists.' },
    });
  });

  it('hides internal details of unexpected errors, including from async handlers', async () => {
    const res = await request(
      errorApp(async () => {
        throw new Error('connection string mongodb://admin:secret@db leaked');
      }),
    ).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('secret');
    expect(res.body).not.toHaveProperty('stack');
  });
});

describe('security middleware', () => {
  it('sets security headers and a request id, and hides the framework', async () => {
    const res = await request(testApp()).get('/api/v1/health');

    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('allows credentialed CORS requests from the configured web origin', async () => {
    const res = await request(testApp()).get('/api/v1/health').set('Origin', 'http://localhost:5173');

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not grant CORS access to other origins', async () => {
    const res = await request(testApp()).get('/api/v1/health').set('Origin', 'https://evil.example');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rate limits with the standard error envelope', async () => {
    const app = testApp({ env: { RATE_LIMIT_MAX: '2' } });
    await request(app).get('/api/v1/health');
    await request(app).get('/api/v1/health');
    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});
