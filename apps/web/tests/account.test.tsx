import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Role, SessionInfo } from '@catalogcraft/shared';
import { errorMessage } from '@/components/page-states';
import { ApiError } from '@/lib/api-client';
import { fail, mockApi, ok, renderRoute, sessionInfo } from './utils';

const session = (role: Role = 'owner', overrides: Partial<SessionInfo> = {}) => () => ok({ ...sessionInfo(role), ...overrides });
const member = { membershipId: 'm1', userId: 'u1', name: 'Ada Lovelace', email: 'ada@example.test', role: 'owner', joinedAt: '2026-01-15T10:00:00.000Z' };

describe('deleting the organization', () => {
  it('needs the exact name typed, then signs out an owner who belongs nowhere else', async () => {
    const { fetchMock } = mockApi({
      'GET /me': session(),
      'GET /organizations/current/members': () => ok([member]),
      'GET /organizations/current/invitations': () => ok([]),
      'DELETE /organizations/current': () => ok(null),
    });
    const { router } = renderRoute('/settings/organization');

    const button = await screen.findByRole('button', { name: 'Delete organization permanently' });
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Type “Analytical Agency” to confirm'), 'Analytical');
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Type “Analytical Agency” to confirm'), ' Agency');
    await userEvent.click(button);

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE');
    expect(JSON.parse(String(call![1]!.body))).toEqual({ confirmName: 'Analytical Agency' });
  });

  it('is only offered to the owner', async () => {
    mockApi({ 'GET /me': session('admin'), 'GET /organizations/current/members': () => ok([member]), 'GET /organizations/current/invitations': () => ok([]) });
    renderRoute('/settings/organization');
    expect(await screen.findByRole('heading', { name: 'Organization settings' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete organization permanently' })).not.toBeInTheDocument();
  });
});

describe('account page', () => {
  it('asks owners to delete their organization first', async () => {
    mockApi({ 'GET /me': session() });
    renderRoute('/settings/account');
    expect(await screen.findByText(/You own “Analytical Agency”/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete my account' })).not.toBeInTheDocument();
  });

  it('deletes a member’s account after the password is confirmed', async () => {
    let attempts = 0;
    mockApi({
      'GET /me': session('editor', { organizations: [{ id: 'o1', name: 'Analytical Agency', role: 'editor' }] }),
      'DELETE /me': () => {
        attempts += 1;
        return attempts === 1
          ? fail(400, 'VALIDATION_ERROR', 'That password is not correct.', [{ path: 'body.password', message: 'That password is not correct.' }])
          : ok(null);
      },
    });
    const { router } = renderRoute('/settings/account');

    await userEvent.type(await screen.findByLabelText('Confirm with your password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(await screen.findByText('That password is not correct.')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/settings/account'); // a wrong password doesn't sign you out

    await userEvent.clear(screen.getByLabelText('Confirm with your password'));
    await userEvent.type(screen.getByLabelText('Confirm with your password'), 'a-long-test-password');
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});

describe('error references', () => {
  it('shows the request id of unexpected server errors so it can be quoted to support', () => {
    expect(errorMessage(new ApiError('INTERNAL_ERROR', 'Something went wrong.', 500, [], 'abc-123'))).toBe(
      'Something went wrong. (Reference: abc-123)',
    );
    expect(errorMessage(new ApiError('NOT_FOUND', 'Not found.', 404))).toBe('Not found.');
  });
});

describe('changing the password', () => {
  it('sends the current and new password and confirms', async () => {
    const { fetchMock } = mockApi({ 'GET /me': session(), 'POST /auth/change-password': () => ok(null) });
    renderRoute('/settings/account');

    await userEvent.type(await screen.findByLabelText('Current password'), 'a-long-test-password');
    await userEvent.type(screen.getByLabelText('New password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText(/at least 10 characters/)).toBeInTheDocument(); // checked before sending

    await userEvent.clear(screen.getByLabelText('New password'));
    await userEvent.type(screen.getByLabelText('New password'), 'a-brand-new-password');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Password changed. Other devices have been signed out.')).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/auth/change-password'));
    expect(JSON.parse(String(call![1]!.body))).toEqual({ currentPassword: 'a-long-test-password', newPassword: 'a-brand-new-password' });
  });
});

describe('email status on the account page', () => {
  it('shows a verified badge once the address is confirmed', async () => {
    mockApi({ 'GET /me': session() });
    renderRoute('/settings/account');
    expect(await screen.findByText('Verified')).toBeInTheDocument();
    expect(screen.queryByText('Not verified')).not.toBeInTheDocument();
  });

  it('shows "Not verified" with a way to resend the link', async () => {
    const unverified = { ...sessionInfo('owner'), user: { ...sessionInfo().user, emailVerified: false } };
    const { fetchMock } = mockApi({
      'GET /me': () => ok(unverified),
      'GET /features': () => ok({ email: true, emailDelivery: 'smtp' }),
      'POST /auth/resend-verification': () => ok(null),
    });
    renderRoute('/settings/account');

    expect(await screen.findByText('Not verified')).toBeInTheDocument();
    const card = screen.getByText('Not verified').closest('[class*="flex-wrap"]')!;
    await userEvent.click(await within(card as HTMLElement).findByRole('button', { name: 'Resend link' }));
    expect(await screen.findByText('New link sent — check your inbox.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/auth/resend-verification'))).toBe(true);
  });
});
