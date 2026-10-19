import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UserModel } from '../src/modules/auth/user.model.js';
import { browser, connectTestDatabase, dbTestApp, disconnectTestDatabase, newAgency } from './helpers.js';

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);

const OLD = 'a-long-test-password';
const NEW = 'a-brand-new-password';

describe('changing your password', () => {
  it('keeps this session, signs out every other one, and swaps the password', async () => {
    const app = dbTestApp();
    const agency = await newAgency(app);
    const laptop = browser(app);
    await laptop.post('/api/v1/auth/login').send({ email: agency.input.email, password: OLD }).expect(200);

    const res = await agency.client.post('/api/v1/auth/change-password').send({ currentPassword: OLD, newPassword: NEW });
    expect(res.status).toBe(200);
    expect((await agency.client.get('/api/v1/me')).status).toBe(200);

    const stale = await laptop.get('/api/v1/me');
    expect(stale.status).toBe(401);
    expect(stale.body.error.message).toBe('Your password was changed. Please sign in again.');

    expect((await browser(app).post('/api/v1/auth/login').send({ email: agency.input.email, password: OLD })).status).toBe(401);
    expect((await browser(app).post('/api/v1/auth/login').send({ email: agency.input.email, password: NEW })).status).toBe(200);
  });

  it('needs the current password and a valid new one', async () => {
    const app = dbTestApp();
    const agency = await newAgency(app);
    const wrong = await agency.client.post('/api/v1/auth/change-password').send({ currentPassword: 'not-it-at-all', newPassword: NEW });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.details[0].path).toBe('body.currentPassword');
    expect((await agency.client.get('/api/v1/me')).status).toBe(200); // a wrong password never signs you out

    const weak = await agency.client.post('/api/v1/auth/change-password').send({ currentPassword: OLD, newPassword: 'short' });
    expect(weak.status).toBe(400);
    expect(weak.body.error.details[0].path).toBe('body.newPassword');
    expect((await browser(app).post('/api/v1/auth/change-password').send({ currentPassword: OLD, newPassword: NEW })).status).toBe(401);
  });

  it('ends every session when an operator resets the password (npm run reset-password)', async () => {
    const app = dbTestApp();
    const agency = await newAgency(app);
    await UserModel.updateOne({ _id: agency.userId }, { $inc: { authVersion: 1 } }); // what the script does, besides the new hash
    expect((await agency.client.get('/api/v1/me')).status).toBe(401);
  });
});
