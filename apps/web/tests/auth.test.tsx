import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CSRF_HEADER } from '@catalogcraft/shared';
import { safeRedirectPath } from '@/features/auth/route-guards';
import { fail, healthBody, jsonResponse, mockApi, ok, renderRoute, sessionInfo, unauthenticated } from './utils';

const health = () => jsonResponse(healthBody());

describe('safeRedirectPath', () => {
  it.each([
    ['/settings/organization', '/settings/organization'],
    [null, '/dashboard'],
    ['https://evil.example', '/dashboard'],
    ['//evil.example/path', '/dashboard'],
    ['/\\evil.example', '/dashboard'],
  ])('%s → %s', (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });
});

describe('protected routes', () => {
  it('sends signed-out visitors to the login page, remembering where they were going', async () => {
    mockApi({ 'GET /me': unauthenticated });
    const { router } = renderRoute('/settings/organization');

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe('?next=%2Fsettings%2Forganization');
  });

  it('shows a retryable error if the session check fails for another reason', async () => {
    const { handlers } = mockApi({ 'GET /me': () => fail(503, 'SERVICE_UNAVAILABLE', 'Database unavailable.') });
    renderRoute('/dashboard');

    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable.');
    handlers['GET /me'] = () => ok(sessionInfo());
    handlers['GET /health'] = health;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: /^Good (morning|afternoon|evening), Ada$/ })).toBeInTheDocument();
  });

  it('returns to the login page when the session expires mid-use', async () => {
    mockApi({
      'GET /me': () => ok(sessionInfo()),
      'GET /organizations/current/members': unauthenticated,
    });
    const { router } = renderRoute('/settings/organization');

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });
});

describe('login', () => {
  it('validates the form in the browser before calling the API', async () => {
    const { fetchMock } = mockApi({ 'GET /me': unauthenticated });
    renderRoute('/login');

    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('signs in and continues to the page the user originally wanted', async () => {
    let submitted: unknown;
    const { fetchMock } = mockApi({
      'GET /me': unauthenticated,
      'POST /auth/login': (body) => {
        submitted = body;
        return ok(sessionInfo());
      },
      'GET /organizations/current/members': () => ok([]),
    });
    renderRoute('/login?next=%2Fsettings%2Forganization');

    await userEvent.type(await screen.findByLabelText('Email'), '  Ada@Example.TEST ');
    await userEvent.type(screen.getByLabelText('Password'), 'my secret phrase');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Organization settings' })).toBeInTheDocument();
    expect(submitted).toEqual({ email: 'ada@example.test', password: 'my secret phrase' });
    const loginCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/auth/login'));
    expect(loginCall?.[1]?.headers).toMatchObject({ [CSRF_HEADER]: '1' });
    expect(loginCall?.[1]?.credentials).toBe('include');
  });

  it('shows the server’s error for wrong credentials', async () => {
    mockApi({
      'GET /me': unauthenticated,
      'POST /auth/login': () => fail(401, 'UNAUTHENTICATED', 'Invalid email or password.'),
    });
    renderRoute('/login');

    await userEvent.type(await screen.findByLabelText('Email'), 'ada@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('skips the login page for users who are already signed in', async () => {
    mockApi({ 'GET /me': () => ok(sessionInfo()), 'GET /health': health });
    renderRoute('/login');

    expect(await screen.findByRole('heading', { name: /^Good (morning|afternoon|evening), Ada$/ })).toBeInTheDocument();
  });
});

describe('registration', () => {
  async function fillRegistration() {
    await userEvent.type(await screen.findByLabelText('Your name'), 'Ada Lovelace');
    await userEvent.type(screen.getByLabelText('Work email'), 'ada@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'a long passphrase');
    await userEvent.type(screen.getByLabelText('Agency / organization name'), 'Analytical Agency');
  }

  it('creates the account and opens the dashboard', async () => {
    let submitted: unknown;
    mockApi({
      'GET /me': unauthenticated,
      'GET /health': health,
      'POST /auth/register': (body) => {
        submitted = body;
        return ok(sessionInfo(), 201);
      },
    });
    renderRoute('/register');

    await fillRegistration();
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('heading', { name: /^Good (morning|afternoon|evening), Ada$/ })).toBeInTheDocument();
    expect(submitted).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.test',
      password: 'a long passphrase',
      organizationName: 'Analytical Agency',
    });
  });

  it('enforces the minimum password length before submitting', async () => {
    mockApi({ 'GET /me': unauthenticated });
    renderRoute('/register');

    await userEvent.type(await screen.findByLabelText('Password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Password must be at least 10 characters.')).toBeInTheDocument();
  });

  it('shows a duplicate-email conflict from the server', async () => {
    mockApi({
      'GET /me': unauthenticated,
      'POST /auth/register': () =>
        fail(409, 'CONFLICT', 'An account with this email already exists. Try signing in instead.'),
    });
    renderRoute('/register');

    await fillRegistration();
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('An account with this email already exists.');
  });

  it('places server validation errors next to the right field', async () => {
    mockApi({
      'GET /me': unauthenticated,
      'POST /auth/register': () =>
        fail(400, 'VALIDATION_ERROR', 'The request contains invalid data.', [
          { path: 'body.organizationName', message: 'Organization name is not allowed.' },
        ]),
    });
    renderRoute('/register');

    await fillRegistration();
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    const field = screen.getByLabelText('Agency / organization name');
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByText('Organization name is not allowed.')).toBeInTheDocument();
  });
});

describe('signed-in area', () => {
  it('signs out and returns to the login page', async () => {
    let signedIn = true;
    mockApi({
      'GET /me': () => (signedIn ? ok(sessionInfo()) : unauthenticated()),
      'GET /health': health,
      'POST /auth/logout': () => {
        signedIn = false;
        return ok(null);
      },
    });
    const { router } = renderRoute('/dashboard');

    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('lets an owner rename the organization and lists the team', async () => {
    let patched: unknown;
    mockApi({
      'GET /me': () => ok(sessionInfo('owner')),
      'GET /organizations/current/members': () =>
        ok([
          {
            membershipId: 'm1',
            userId: 'u1',
            name: 'Ada Lovelace',
            email: 'ada@example.test',
            role: 'owner',
            joinedAt: '2026-01-15T10:00:00.000Z',
          },
        ]),
      'PATCH /organizations/current': (body) => {
        patched = body;
        return ok({ ...sessionInfo().organization, name: 'Renamed Agency' });
      },
    });
    renderRoute('/settings/organization');

    const table = await screen.findByRole('table');
    expect(within(table).getByText('ada@example.test')).toBeInTheDocument();
    expect(within(table).getByText('(you)')).toBeInTheDocument();

    const nameInput = screen.getByLabelText('Organization name');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Renamed Agency');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Organization name saved.')).toBeInTheDocument();
    expect(patched).toEqual({ name: 'Renamed Agency' });
    // The sidebar (which reads the session) shows the new name too.
    expect(screen.getByRole('complementary', { name: 'Sidebar' })).toHaveTextContent('Renamed Agency');
  });

  it('shows organization details read-only to roles that cannot edit them', async () => {
    mockApi({
      'GET /me': () => ok(sessionInfo('reviewer')),
      'GET /organizations/current/members': () => ok([]),
    });
    renderRoute('/settings/organization');

    expect(await screen.findByText('Only owners and admins can change these details.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Organization name')).not.toBeInTheDocument();
  });
});
