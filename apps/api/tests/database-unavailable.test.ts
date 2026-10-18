import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '@catalogcraft/shared';
import { testApp } from './helpers.js';

describe('when the database is unavailable', () => {
  it('answers database-backed routes with a clear 503 instead of hanging or crashing', async () => {
    const app = testApp({ databaseStatus: 'disconnected' });

    const me = await request(app).get('/api/v1/me');
    const login = await request(app)
      .post('/api/v1/auth/login')
      .set(CSRF_HEADER, CSRF_HEADER_VALUE)
      .send({ email: 'a@b.test', password: 'x' });

    for (const res of [me, login]) {
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
    }
  });

  it('keeps the health endpoint working', async () => {
    const res = await request(testApp({ databaseStatus: 'disconnected' })).get('/api/v1/health');
    expect(res.status).toBe(200);
  });
});
