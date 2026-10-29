import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EmailTokenModel } from '../src/modules/auth/email-token.model.js';
import { createMailer, DisabledMailer, LogMailer, SmtpMailer } from '../src/services/email/mailer.js';
import { invitationEmail } from '../src/services/email/templates.js';
import { browser, connectTestDatabase, dbTestApp, disconnectTestDatabase, newAgency, registration, testConfig } from './helpers.js';
import { CaptureMailer } from './mock-mailer.js';

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);

const PASSWORD = 'a-long-test-password';
const NEW_PASSWORD = 'a-brand-new-password';

/** Password-reset emails are sent in the background; wait until one with a link to `path` arrives. */
async function waitForEmail(mailer: CaptureMailer, to: string, path = 'reset-password') {
  await vi.waitFor(() => mailer.tokenFor(to, path));
  return mailer.last(to)!;
}

describe('email verification', () => {
  it('emails a link at sign-up that confirms the address once', async () => {
    const mailer = new CaptureMailer();
    const app = dbTestApp({ APP_URL: 'https://app.example.test' }, { mailer });
    const agency = await newAgency(app);
    const email = agency.input.email.toLowerCase();

    const message = mailer.last(email)!;
    expect(message.subject).toBe('Confirm your email address');
    expect(message.text).toContain('https://app.example.test/verify-email/');
    expect(message.html).toContain(agency.input.name);
    expect((await agency.client.get('/api/v1/me')).body.data.user.emailVerified).toBe(false);

    const token = mailer.tokenFor(email, 'verify-email');
    expect(JSON.stringify(await EmailTokenModel.find().lean())).not.toContain(token); // only a hash is stored
    expect((await browser(app).post('/api/v1/auth/verify-email').send({ token })).status).toBe(200);
    expect((await agency.client.get('/api/v1/me')).body.data.user.emailVerified).toBe(true);

    expect((await browser(app).post('/api/v1/auth/verify-email').send({ token })).status).toBe(400); // used
    expect((await browser(app).post('/api/v1/auth/verify-email').send({ token: 'A'.repeat(43) })).status).toBe(400);
    expect((await browser(app).post('/api/v1/auth/verify-email').send({ token: 'short' })).status).toBe(400);
  });

  it('can resend the link, which replaces the old one', async () => {
    const mailer = new CaptureMailer();
    const app = dbTestApp({}, { mailer });
    const agency = await newAgency(app);
    const email = agency.input.email.toLowerCase();
    const first = mailer.tokenFor(email, 'verify-email');

    expect((await agency.client.post('/api/v1/auth/resend-verification')).status).toBe(200);
    const second = mailer.tokenFor(email, 'verify-email');
    expect(second).not.toBe(first);
    expect((await browser(app).post('/api/v1/auth/verify-email').send({ token: first })).status).toBe(400);
    expect((await browser(app).post('/api/v1/auth/verify-email').send({ token: second })).status).toBe(200);

    const again = await agency.client.post('/api/v1/auth/resend-verification');
    expect(again.body.message).toBe('Your email address is already confirmed.');
  });

  it('never blocks sign-up when email is off or failing', async () => {
    const plain = await newAgency(dbTestApp());
    expect((await plain.client.post('/api/v1/auth/resend-verification')).status).toBe(503);

    const mailer = new CaptureMailer();
    mailer.fail = true;
    const res = await browser(dbTestApp({}, { mailer })).post('/api/v1/auth/register').send(registration());
    expect(res.status).toBe(201);
  });
});

describe('password reset', () => {
  it('emails a one-time link, sets the new password and signs out every session', async () => {
    const mailer = new CaptureMailer();
    const app = dbTestApp({}, { mailer });
    const agency = await newAgency(app);
    const email = agency.input.email.toLowerCase();

    const res = await browser(app).post('/api/v1/auth/forgot-password').send({ email });
    expect(res.status).toBe(200);
    const message = await waitForEmail(mailer, email);
    expect(message.subject).toBe('Reset your CatalogCraft password');
    const token = mailer.tokenFor(email, 'reset-password');

    const weak = await browser(app).post('/api/v1/auth/reset-password').send({ token, password: 'short' });
    expect(weak.status).toBe(400);
    expect((await browser(app).post('/api/v1/auth/reset-password').send({ token, password: NEW_PASSWORD })).status).toBe(200);

    expect((await agency.client.get('/api/v1/me')).status).toBe(401); // old session ended
    expect((await browser(app).post('/api/v1/auth/login').send({ email, password: PASSWORD })).status).toBe(401);
    const login = await browser(app).post('/api/v1/auth/login').send({ email, password: NEW_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.data.user.emailVerified).toBe(true); // the link proved the address

    expect((await browser(app).post('/api/v1/auth/reset-password').send({ token, password: 'yet-another-password' })).status).toBe(400);
  });

  it('answers the same for unknown addresses and sends nothing', async () => {
    const mailer = new CaptureMailer();
    const app = dbTestApp({}, { mailer });
    const known = await newAgency(app);
    const before = mailer.sent.length;

    const unknown = await browser(app).post('/api/v1/auth/forgot-password').send({ email: 'nobody@example.test' });
    const real = await browser(app).post('/api/v1/auth/forgot-password').send({ email: known.input.email });
    expect(unknown.status).toBe(200);
    expect(unknown.body.message).toBe(real.body.message);
    await waitForEmail(mailer, known.input.email.toLowerCase());
    expect(mailer.sent.length).toBe(before + 1);
    expect(mailer.last('nobody@example.test')).toBeUndefined();
  });

  it('expires links, and a newer link replaces an older one', async () => {
    const mailer = new CaptureMailer();
    const app = dbTestApp({}, { mailer });
    const agency = await newAgency(app);
    const email = agency.input.email.toLowerCase();

    await browser(app).post('/api/v1/auth/forgot-password').send({ email });
    await waitForEmail(mailer, email);
    const first = mailer.tokenFor(email, 'reset-password');
    await browser(app).post('/api/v1/auth/forgot-password').send({ email });
    await vi.waitFor(() => expect(mailer.tokenFor(email, 'reset-password')).not.toBe(first));
    const second = mailer.tokenFor(email, 'reset-password');

    expect((await browser(app).post('/api/v1/auth/reset-password').send({ token: first, password: NEW_PASSWORD })).status).toBe(400);
    await EmailTokenModel.updateMany({ purpose: 'reset-password', usedAt: null }, { expiresAt: new Date(Date.now() - 1000) });
    const expired = await browser(app).post('/api/v1/auth/reset-password').send({ token: second, password: NEW_PASSWORD });
    expect(expired.status).toBe(400);
    expect(expired.body.error.message).toMatch(/expired/);
  });

  it('is rate-limited, and explains when email is off', async () => {
    const mailer = new CaptureMailer();
    const app = dbTestApp({ EMAIL_RATE_LIMIT_MAX: '2' }, { mailer });
    const client = browser(app);
    for (let i = 0; i < 2; i += 1) expect((await client.post('/api/v1/auth/forgot-password').send({ email: 'x@example.test' })).status).toBe(200);
    expect((await client.post('/api/v1/auth/forgot-password').send({ email: 'x@example.test' })).status).toBe(429);

    const off = await browser(dbTestApp()).post('/api/v1/auth/forgot-password').send({ email: 'x@example.test' });
    expect(off.status).toBe(503);
    expect(off.body.error.message).toMatch(/administrator/);
  });
});

describe('emailed invitations', () => {
  it('emails the link unless asked not to, and joining through it confirms the address', async () => {
    const mailer = new CaptureMailer();
    const app = dbTestApp({}, { mailer });
    const owner = await newAgency(app, { plan: 'agency' });

    const res = await owner.client.post('/api/v1/organizations/current/invitations').send({ email: 'new@example.test', role: 'editor' });
    expect(res.body.data.emailed).toBe(true);
    const message = mailer.last('new@example.test')!;
    expect(message.subject).toContain(owner.input.organizationName);
    expect(mailer.tokenFor('new@example.test', 'invite')).toBe(res.body.data.token);

    const quiet = await owner.client.post('/api/v1/organizations/current/invitations').send({ email: 'quiet@example.test', role: 'editor', sendEmail: false });
    expect(quiet.body.data.emailed).toBe(false);
    expect(mailer.last('quiet@example.test')).toBeUndefined();

    const joined = await browser(app).post(`/api/v1/invitations/${res.body.data.token}/register`).send({ name: 'New Person', password: PASSWORD });
    expect(joined.body.data.user.emailVerified).toBe(true);
  });

  it('still creates the invitation when the email can’t be sent', async () => {
    const mailer = new CaptureMailer();
    const app = dbTestApp({}, { mailer });
    const owner = await newAgency(app, { plan: 'agency' });
    mailer.fail = true;
    const res = await owner.client.post('/api/v1/organizations/current/invitations').send({ email: 'later@example.test', role: 'editor' });
    expect(res.status).toBe(201);
    expect(res.body.data.emailed).toBe(false);
  });
});

describe('email configuration', () => {
  it('reports whether email is available to the sign-in pages', async () => {
    expect((await request(dbTestApp()).get('/api/v1/features')).body.data).toEqual({ email: false, emailDelivery: 'none' });
    expect((await request(dbTestApp({}, { mailer: new CaptureMailer() })).get('/api/v1/features')).body.data).toEqual({ email: true, emailDelivery: 'smtp' });
    const logged = dbTestApp({}, { mailer: new LogMailer(pino({ level: 'silent' })) });
    expect((await request(logged).get('/api/v1/features')).body.data).toEqual({ email: true, emailDelivery: 'log' });
  });

  it('defaults sensibly and refuses unsafe setups', () => {
    expect(testConfig().email).toMatchObject({ driver: 'log', appUrl: 'http://localhost:5173' });
    expect(testConfig({ APP_URL: 'https://app.example.test/' }).email.appUrl).toBe('https://app.example.test');
    expect(() => testConfig({ EMAIL_DRIVER: 'smtp' })).toThrow(/SMTP_HOST is required[\s\S]*EMAIL_FROM is required/);
    expect(() => testConfig({ NODE_ENV: 'production', EMAIL_DRIVER: 'log' })).toThrow(/development only/);
    const smtp = { EMAIL_DRIVER: 'smtp', SMTP_HOST: 'smtp.example.test' };
    expect(() => testConfig({ ...smtp, EMAIL_FROM: 'CatalogCraft' })).toThrow(/EMAIL_FROM needs an email address/);
    expect(testConfig({ ...smtp, EMAIL_FROM: 'CatalogCraft <no-reply@example.test>' }).email.from).toBe('CatalogCraft <no-reply@example.test>');
    expect(testConfig({ ...smtp, EMAIL_FROM: 'no-reply@example.test' }).email.driver).toBe('smtp');
    expect(testConfig({ NODE_ENV: 'production' }).email.driver).toBe('none');

    const logger = pino({ level: 'silent' });
    expect(createMailer(testConfig({ EMAIL_DRIVER: 'none' }), logger)).toBeInstanceOf(DisabledMailer);
    expect(createMailer(testConfig(), logger)).toBeInstanceOf(LogMailer);
    expect(createMailer(testConfig({ EMAIL_DRIVER: 'smtp', SMTP_HOST: 'smtp.example.test', EMAIL_FROM: 'CC <no-reply@example.test>' }), logger)).toBeInstanceOf(SmtpMailer);
  });

  it('sends through SMTP with the configured sender', async () => {
    const sendMail = vi.fn(async () => ({}));
    const mailer = new SmtpMailer({ from: 'CC <no-reply@example.test>', host: 'h', port: 587, secure: false, user: 'u', password: 'p' }, { sendMail });
    await mailer.send({ to: 'a@example.test', subject: 'Hi', text: 'T', html: '<p>H</p>' });
    expect(sendMail).toHaveBeenCalledWith({ from: 'CC <no-reply@example.test>', to: 'a@example.test', subject: 'Hi', text: 'T', html: '<p>H</p>' });
  });

  it('escapes names inside email HTML', () => {
    const message = invitationEmail({ to: 'a@example.test', inviterName: '<script>x</script>', organizationName: 'A & B', role: 'editor', url: 'https://x.test/invite/t', days: 7 });
    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;');
    expect(message.html).toContain('A &amp; B');
  });
});

