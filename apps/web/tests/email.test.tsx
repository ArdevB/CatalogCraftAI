import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fail, mockApi, ok, renderRoute, sessionInfo, unauthenticated } from './utils';

const TOKEN = 'R'.repeat(43);
const features = (email: boolean, emailDelivery = email ? 'smtp' : 'none') => () => ok({ email, emailDelivery });

describe('forgot password', () => {
  it('is offered on the sign-in page', async () => {
    mockApi({ 'GET /me': unauthenticated });
    renderRoute('/login');
    expect(await screen.findByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password');
  });

  it('emails a reset link and says the same thing for any address', async () => {
    const { fetchMock } = mockApi({ 'GET /me': unauthenticated, 'GET /features': features(true), 'POST /auth/forgot-password': () => ok(null) });
    renderRoute('/forgot-password');

    await userEvent.type(await screen.findByLabelText('Email'), 'ada@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Email me a reset link' }));

    expect(await screen.findByText('Check your inbox')).toBeInTheDocument();
    expect(screen.getByText(/If an account uses ada@example.test/)).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/forgot-password'));
    expect(JSON.parse(String(call![1]!.body))).toEqual({ email: 'ada@example.test' });
  });

  it('says when emails are only printed in the terminal (development)', async () => {
    mockApi({ 'GET /me': unauthenticated, 'GET /features': features(true, 'log'), 'POST /auth/forgot-password': () => ok(null) });
    renderRoute('/forgot-password');
    await userEvent.type(await screen.findByLabelText('Email'), 'ada@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Email me a reset link' }));
    expect(await screen.findByText(/emails aren’t really sent. Open the link printed in the API terminal/)).toBeInTheDocument();
  });

  it('points to the administrator when the server can’t send email', async () => {
    mockApi({ 'GET /me': unauthenticated, 'GET /features': features(false) });
    renderRoute('/forgot-password');
    expect(await screen.findByText(/Ask your agency’s administrator/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Email me a reset link' })).not.toBeInTheDocument();
  });
});

describe('reset password', () => {
  it('sets the new password and returns to sign-in with a confirmation', async () => {
    const { fetchMock } = mockApi({ 'GET /me': unauthenticated, 'POST /auth/reset-password': () => ok(null) });
    const { router } = renderRoute(`/reset-password/${TOKEN}`);

    await userEvent.type(await screen.findByLabelText('New password'), 'a-brand-new-password');
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(await screen.findByText('Password changed. Sign in with your new password.')).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/reset-password'));
    expect(JSON.parse(String(call![1]!.body))).toEqual({ token: TOKEN, password: 'a-brand-new-password' });
  });

  it('explains an expired or used link and offers a new one', async () => {
    mockApi({ 'GET /me': unauthenticated, 'POST /auth/reset-password': () => fail(400, 'BAD_REQUEST', 'This link is invalid or has expired. Ask for a new one.') });
    renderRoute(`/reset-password/${TOKEN}`);
    await userEvent.type(await screen.findByLabelText('New password'), 'a-brand-new-password');
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByText(/invalid or has expired/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Get a new link' })).toHaveAttribute('href', '/forgot-password');
  });
});

describe('email confirmation', () => {
  it('confirms the address from the link', async () => {
    const { fetchMock } = mockApi({ 'GET /me': unauthenticated, 'POST /auth/verify-email': () => ok(null) });
    renderRoute(`/verify-email/${TOKEN}`);
    expect(await screen.findByText('Email address confirmed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/verify-email'))).toHaveLength(1);
  });

  it('explains a link that doesn’t work', async () => {
    mockApi({ 'GET /me': unauthenticated, 'POST /auth/verify-email': () => fail(400, 'BAD_REQUEST', 'This link is invalid or has expired. Ask for a new one.') });
    renderRoute(`/verify-email/${TOKEN}`);
    expect(await screen.findByText('This link didn’t work')).toBeInTheDocument();
  });

  it('reminds signed-in users who haven’t confirmed yet, and can resend the link', async () => {
    const unverified = { ...sessionInfo(), user: { ...sessionInfo().user, emailVerified: false } };
    mockApi({
      'GET /me': () => ok(unverified),
      'GET /features': features(true),
      'GET /clients?page=1&pageSize=20': () =>
        ok({ items: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 1 }, allowance: { used: 0, limit: null } }),
      'POST /auth/resend-verification': () => ok(null),
    });
    renderRoute('/clients');

    expect(await screen.findByText(/Please confirm your email address — we sent a link to ada@example.test/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Resend link' }));
    expect(await screen.findByText(/We sent a new link to ada@example.test/)).toBeInTheDocument();
  });

  it('doesn’t nag when the address is confirmed or email is off', async () => {
    const unverified = { ...sessionInfo(), user: { ...sessionInfo().user, emailVerified: false } };
    mockApi({
      'GET /me': () => ok(unverified),
      'GET /features': features(false),
      'GET /clients?page=1&pageSize=20': () =>
        ok({ items: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 1 }, allowance: { used: 0, limit: null } }),
    });
    renderRoute('/clients');
    expect(await screen.findByRole('heading', { name: 'Clients' })).toBeInTheDocument();
    expect(screen.queryByText(/Please confirm your email address/)).not.toBeInTheDocument();
  });
});

describe('emailed invitations', () => {
  it('offers to email the link and says when it did', async () => {
    const member = { membershipId: 'm1', userId: 'u1', name: 'Ada Lovelace', email: 'ada@example.test', role: 'owner', joinedAt: '2026-01-15T10:00:00.000Z' };
    const { fetchMock } = mockApi({
      'GET /me': () => ok(sessionInfo()),
      'GET /features': features(true),
      'GET /organizations/current/members': () => ok([member]),
      'GET /organizations/current/invitations': () => ok([]),
      'POST /organizations/current/invitations': () =>
        ok(
          {
            invitation: { id: 'i1', email: 'new@example.test', role: 'editor', invitedBy: { id: 'u1', name: 'Ada' }, createdAt: '2026-10-19T10:00:00.000Z', expiresAt: '2026-10-26T10:00:00.000Z' },
            token: 'T'.repeat(43),
            emailed: true,
          },
          201,
        ),
    });
    renderRoute('/settings/organization');

    expect(await screen.findByLabelText('Email the link to them')).toBeChecked();
    await userEvent.type(screen.getByLabelText('Email'), 'new@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Send invitation' }));

    expect(await screen.findByText('We emailed the invitation to new@example.test. You can also copy the link:')).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(call![1]!.body))).toEqual({ email: 'new@example.test', role: 'editor', sendEmail: true });
  });
});
