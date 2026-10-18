import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { apiSuccessResponseSchema, healthSchema } from '@catalogcraft/shared';
import { testApp } from './helpers.js';

const healthResponse = apiSuccessResponseSchema(healthSchema);

describe('GET /api/v1/health', () => {
  it('returns ok when the database is connected', async () => {
    const res = await request(testApp({ databaseStatus: 'connected' })).get('/api/v1/health');

    expect(res.status).toBe(200);
    const body = healthResponse.parse(res.body);
    expect(body.data.status).toBe('ok');
    expect(body.data.checks.database).toBe('connected');
    expect(body.data.environment).toBe('test');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('stays 200 but reports degraded when the database is down (liveness)', async () => {
    const res = await request(testApp({ databaseStatus: 'disconnected' })).get('/api/v1/health');

    expect(res.status).toBe(200);
    const body = healthResponse.parse(res.body);
    expect(body.data.status).toBe('degraded');
    expect(body.data.checks.database).toBe('disconnected');
  });
});

describe('GET /api/v1/health/ready', () => {
  it('returns 200 when ready', async () => {
    const res = await request(testApp({ databaseStatus: 'connected' })).get('/api/v1/health/ready');
    expect(res.status).toBe(200);
  });

  it('returns 503 with the standard error envelope when the database is not connected', async () => {
    const res = await request(testApp({ databaseStatus: 'connecting' })).get('/api/v1/health/ready');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Database is connecting.' },
    });
  });
});
