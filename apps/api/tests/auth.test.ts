import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiSuccessResponseSchema, CSRF_HEADER, CSRF_HEADER_VALUE, sessionInfoSchema } from '@catalogcraft/shared';
import { UserModel } from '../src/modules/auth/user.model.js';
import { MembershipModel } from '../src/modules/memberships/membership.model.js';
import { OrganizationModel } from '../src/modules/organizations/organization.model.js';
import {
  browser,
  connectTestDatabase,
  dbTestApp,
  disconnectTestDatabase,
  registration,
  TEST_ORIGIN,
} from './helpers.js';

const sessionResponse = apiSuccessResponseSchema(sessionInfoSchema);

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);

function sessionCookie(res: request.Response): string | undefined {
  const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
  return cookies?.find((cookie) => cookie.startsWith('cc.sid='));
}

describe('POST /auth/register', () => {
  it('creates the user, an organization and an owner membership, and signs in', async () => {
    const app = dbTestApp();
    const input = registration({ email: 'Owner@Example.TEST' });
    const res = await browser(app).post('/api/v1/auth/register').send(input);

    expect(res.status).toBe(201);
    const { data } = sessionResponse.parse(res.body);
    expect(data.user.email).toBe('owner@example.test');
    expect(data.role).toBe('owner');
    expect(data.organization).toMatchObject({ name: input.organizationName, plan: 'trial' });
    expect(data.permissions).toContain('organization:delete');

    const cookie = sessionCookie(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const user = await UserModel.findOne({ email: 'owner@example.test' }).select('+passwordHash').lean();
    expect(user?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user?.passwordHash).not.toContain(input.password);
    const org = await OrganizationModel.findById(data.organization.id).lean();
    expect(org?.ownerUserId.toString()).toBe(data.user.id);
    expect(await MembershipModel.countDocuments({ userId: data.user.id, role: 'owner' })).toBe(1);
  });

  it('never returns the password hash', async () => {
    const res = await browser(dbTestApp()).post('/api/v1/auth/register').send(registration());
    expect(JSON.stringify(res.body)).not.toMatch(/argon2|passwordHash/);
  });

  it('rejects a duplicate email regardless of letter case', async () => {
    const app = dbTestApp();
    const input = registration({ email: 'dupe@example.test' });
    await browser(app).post('/api/v1/auth/register').send(input).expect(201);

    const res = await browser(app)
      .post('/api/v1/auth/register')
      .send({ ...input, email: 'DUPE@example.test' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(await UserModel.countDocuments({ email: 'dupe@example.test' })).toBe(1);
  });

  it('returns field-level validation errors', async () => {
    const res = await browser(dbTestApp())
      .post('/api/v1/auth/register')
      .send({ name: '', email: 'nope', password: 'short', organizationName: '' });

    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual([
      'body.email',
      'body.name',
      'body.organizationName',
      'body.password',
    ]);
  });

  it('ignores attempts to choose a role or organization', async () => {
    const res = await browser(dbTestApp())
      .post('/api/v1/auth/register')
      .send({ ...registration(), role: 'reviewer', organizationId: '64b7f0c2a1b2c3d4e5f60718' });

    expect(res.status).toBe(201);
    expect(res.body.data.role).toBe('owner');
    expect(res.body.data.organization.id).not.toBe('64b7f0c2a1b2c3d4e5f60718');
  });
});

describe('POST /auth/login and GET /me', () => {
  it('signs in with valid credentials and returns the session info from /me', async () => {
    const app = dbTestApp();
    const input = registration();
    await browser(app).post('/api/v1/auth/register').send(input);

    const client = browser(app);
    const login = await client.post('/api/v1/auth/login').send({ email: input.email.toUpperCase(), password: input.password });
    expect(login.status).toBe(200);
    expect(sessionResponse.parse(login.body).data.user.email).toBe(input.email);

    const me = await client.get('/api/v1/me');
    expect(me.status).toBe(200);
    expect(sessionResponse.parse(me.body).data).toMatchObject({ role: 'owner', user: { email: input.email } });
    expect(await UserModel.findOne({ email: input.email }).then((u) => u?.lastLoginAt)).toBeInstanceOf(Date);
  });

  it('gives the same generic error for a wrong password and an unknown email', async () => {
    const app = dbTestApp();
    const input = registration();
    await browser(app).post('/api/v1/auth/register').send(input);

    const wrongPassword = await browser(app)
      .post('/api/v1/auth/login')
      .send({ email: input.email, password: 'not-the-password' });
    const unknownEmail = await browser(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.test', password: 'whatever-password' });

    for (const res of [wrongPassword, unknownEmail]) {
      expect(res.status).toBe(401);
      expect(res.body.error).toEqual({ code: 'UNAUTHENTICATED', message: 'Invalid email or password.' });
      expect(sessionCookie(res)).toBeUndefined();
    }
  });

  it('issues a new session id at login (session fixation protection)', async () => {
    const app = dbTestApp();
    const input = registration();
    const client = browser(app);
    const registered = await client.post('/api/v1/auth/register').send(input);
    const loggedIn = await client.post('/api/v1/auth/login').send({ email: input.email, password: input.password });

    const idOf = (res: request.Response) => sessionCookie(res)?.split(';')[0];
    expect(idOf(loggedIn)).toBeDefined();
    expect(idOf(loggedIn)).not.toBe(idOf(registered));
  });

  it('requires a session for /me', async () => {
    const res = await request(dbTestApp()).get('/api/v1/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('ends the session immediately when the user is disabled', async () => {
    const app = dbTestApp();
    const input = registration();
    const client = browser(app);
    await client.post('/api/v1/auth/register').send(input).expect(201);

    await UserModel.updateOne({ email: input.email }, { status: 'disabled' });

    expect((await client.get('/api/v1/me')).status).toBe(401);
    const login = await browser(app).post('/api/v1/auth/login').send({ email: input.email, password: input.password });
    expect(login.status).toBe(403);
  });
});

describe('POST /auth/logout', () => {
  it('destroys the session server-side so the old cookie stops working', async () => {
    const app = dbTestApp();
    const client = browser(app);
    const registered = await client.post('/api/v1/auth/register').send(registration());
    const stolenCookie = sessionCookie(registered)!.split(';')[0]!;

    const logout = await client.post('/api/v1/auth/logout');
    expect(logout.status).toBe(200);
    expect(sessionCookie(logout)).toMatch(/Expires=Thu, 01 Jan 1970/);

    expect((await client.get('/api/v1/me')).status).toBe(401);
    // Replaying the old cookie does not work either: the session no longer exists.
    expect((await request(app).get('/api/v1/me').set('Cookie', stolenCookie)).status).toBe(401);
  });
});

describe('CSRF protection', () => {
  it('rejects state-changing requests without the anti-forgery header', async () => {
    const res = await request(dbTestApp()).post('/api/v1/auth/login').send({ email: 'a@b.test', password: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects state-changing requests from another origin', async () => {
    const res = await request(dbTestApp())
      .post('/api/v1/auth/login')
      .set(CSRF_HEADER, CSRF_HEADER_VALUE)
      .set('Origin', 'https://evil.example')
      .send({ email: 'a@b.test', password: 'x' });
    expect(res.status).toBe(403);
  });

  it('allows the web app origin', async () => {
    const res = await request(dbTestApp())
      .post('/api/v1/auth/login')
      .set(CSRF_HEADER, CSRF_HEADER_VALUE)
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'a@b.test', password: 'wrong-password' });
    expect(res.status).toBe(401);
  });
});

describe('credential rate limiting', () => {
  it('blocks repeated failed logins from the same IP', async () => {
    const app = dbTestApp({ AUTH_RATE_LIMIT_MAX: '3' });
    const attempt = () =>
      browser(app).post('/api/v1/auth/login').send({ email: 'victim@example.test', password: 'guess-guess' });

    for (let i = 0; i < 3; i += 1) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });
});
