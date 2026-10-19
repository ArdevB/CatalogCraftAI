import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DashboardSummary, InvitationPreview, Member, Role, SessionInfo } from '@catalogcraft/shared';
import { DASHBOARD_SUMMARY, dashboardSummary, fail, healthBody, jsonResponse, mockApi, ok, renderRoute, sessionInfo, unauthenticated } from './utils';

const TOKEN = 'T'.repeat(43);
const ORG_2 = 'b'.repeat(24);
const EMPTY_CLIENTS = { items: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 1 }, allowance: { used: 0, limit: null } };

const session = (role: Role = 'owner', overrides: Partial<SessionInfo> = {}) => () => ok({ ...sessionInfo(role), ...overrides });

const preview = (overrides: Partial<InvitationPreview> = {}): InvitationPreview => ({
  organizationName: 'Analytical Agency',
  email: 'grace@example.test',
  role: 'editor',
  invitedByName: 'Ada Lovelace',
  expiresAt: '2026-10-26T10:00:00.000Z',
  status: 'pending',
  ...overrides,
});

const member = (userId: string, name: string, role: Role): Member => ({
  membershipId: `m-${userId}`,
  userId,
  name,
  email: `${name.split(' ')[0]!.toLowerCase()}@example.test`,
  role,
  joinedAt: '2026-01-15T10:00:00.000Z',
});
const TEAM = [member('u1', 'Ada Lovelace', 'owner'), member('u2', 'Grace Hopper', 'editor'), member('u3', 'Alan Turing', 'admin')];

const usage = () =>
  ok({
    plan: 'agency',
    period: { start: '2026-10-01T00:00:00.000Z', end: '2026-11-01T00:00:00.000Z' },
    products: { used: 0, reserved: 0, limit: 2500 },
    aiRequests: 0,
    failedRequests: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
    ai: { configured: false, model: null },
    limits: { clientWorkspaces: { used: 1, limit: null }, members: { used: 3, limit: 3 }, activeJobs: { used: 0, limit: null } },
  });

describe('invite page', () => {
  it('lets someone new create an account and join', async () => {
    const { fetchMock } = mockApi({
      'GET /me': unauthenticated,
      [`GET /invitations/${TOKEN}`]: () => ok(preview()),
      [`POST /invitations/${TOKEN}/register`]: () =>
        ok({ ...sessionInfo('editor'), user: { id: 'u2', name: 'Grace Hopper', email: 'grace@example.test', emailVerified: true } }, 201),
    });
    const { router } = renderRoute(`/invite/${TOKEN}`);

    expect(await screen.findByRole('heading', { name: 'Join Analytical Agency' })).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace invited grace@example.test to join Analytical Agency as editor.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Create account and join' }));
    expect(await screen.findByText('Enter your name.')).toBeInTheDocument(); // validated before sending

    await userEvent.type(screen.getByLabelText('Your name'), 'Grace Hopper');
    await userEvent.type(screen.getByLabelText('Choose a password'), 'a-long-test-password');
    await userEvent.click(screen.getByRole('button', { name: 'Create account and join' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/register'));
    expect(JSON.parse(String(call![1]!.body))).toEqual({ name: 'Grace Hopper', password: 'a-long-test-password' });
  });

  it('lets an existing account sign in from the link', async () => {
    const { fetchMock } = mockApi({
      'GET /me': unauthenticated,
      [`GET /invitations/${TOKEN}`]: () => ok(preview()),
      [`POST /invitations/${TOKEN}/sign-in`]: () => fail(401, 'UNAUTHENTICATED', 'Email or password is incorrect.'),
    });
    renderRoute(`/invite/${TOKEN}`);

    await userEvent.click(await screen.findByRole('button', { name: 'Sign in instead' }));
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in and join' }));

    expect(await screen.findByText('Email or password is incorrect.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/sign-in'))).toBe(true);
  });

  it('lets a signed-in user with the invited email join in one click', async () => {
    const { fetchMock } = mockApi({
      'GET /me': session('owner', { user: { id: 'u2', name: 'Grace', email: 'Grace@example.test', emailVerified: true } }),
      [`GET /invitations/${TOKEN}`]: () => ok(preview()),
      [`POST /invitations/${TOKEN}/accept`]: () => ok(sessionInfo('editor')),
    });
    const { router } = renderRoute(`/invite/${TOKEN}`);

    await userEvent.click(await screen.findByRole('button', { name: 'Join Analytical Agency' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/accept') && init?.method === 'POST')).toBe(true);
  });

  it('explains when you are signed in with a different email', async () => {
    mockApi({ 'GET /me': session(), [`GET /invitations/${TOKEN}`]: () => ok(preview()) });
    renderRoute(`/invite/${TOKEN}`);

    expect(await screen.findByText(/This invitation is for grace@example.test, but you’re signed in as ada@example.test/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out and continue as grace@example.test' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Join/ })).not.toBeInTheDocument();
  });

  it.each([
    ['expired', 'This invitation has expired.'],
    ['revoked', 'This invitation was cancelled.'],
    ['accepted', 'This invitation has already been used.'],
  ] as const)('explains an %s invitation', async (status, message) => {
    mockApi({ 'GET /me': unauthenticated, [`GET /invitations/${TOKEN}`]: () => ok(preview({ status })) });
    renderRoute(`/invite/${TOKEN}`);
    expect(await screen.findByText(new RegExp(message))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /join/i })).not.toBeInTheDocument();
  });

  it('explains an invalid link', async () => {
    mockApi({ 'GET /me': unauthenticated, [`GET /invitations/${TOKEN}`]: () => fail(404, 'NOT_FOUND', 'This invitation link is not valid.') });
    renderRoute(`/invite/${TOKEN}`);
    expect(await screen.findByText(/This invitation link is not valid. Check that you copied all of it./)).toBeInTheDocument();
  });
});

describe('team management', () => {
  it('creates an invitation link to share, and can cancel pending ones', async () => {
    let invitations: unknown[] = [];
    const api = mockApi({
      'GET /me': session(),
      'GET /organizations/current/members': () => ok(TEAM),
      'GET /organizations/current/invitations': () => ok(invitations),
      'GET /usage': usage,
      'POST /organizations/current/invitations': (body) => {
        const invitation = {
          id: 'i1',
          email: (body as { email: string }).email,
          role: 'reviewer',
          invitedBy: { id: 'u1', name: 'Ada Lovelace' },
          createdAt: '2026-10-19T10:00:00.000Z',
          expiresAt: '2026-10-26T10:00:00.000Z',
        };
        invitations = [invitation];
        return ok({ invitation, token: TOKEN, emailed: false }, 201);
      },
      'DELETE /organizations/current/invitations/i1': () => {
        invitations = [];
        return ok(null);
      },
    });
    renderRoute('/settings/organization');

    expect(await screen.findByText('3 of 3 seats used — pending invitations count too.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Email'), 'new@example.test');
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'reviewer');
    await userEvent.click(screen.getByRole('button', { name: 'Create invitation link' }));

    expect(await screen.findByLabelText('Invitation link')).toHaveValue(`${window.location.origin}/invite/${TOKEN}`);
    const sent = api.fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/invitations') && init?.method === 'POST');
    expect(JSON.parse(String(sent![1]!.body))).toMatchObject({ email: 'new@example.test', role: 'reviewer' });

    await userEvent.click(await screen.findByRole('button', { name: 'Cancel invitation for new@example.test' }));
    expect(await screen.findByText('No pending invitations.')).toBeInTheDocument();
  });

  it('lets the owner change roles and remove members after confirming', async () => {
    let team = TEAM;
    const { fetchMock } = mockApi({
      'GET /me': session(),
      'GET /organizations/current/members': () => ok(team),
      'GET /organizations/current/invitations': () => ok([]),
      'GET /usage': usage,
      'PATCH /organizations/current/members/m-u2': () => ok(null),
      'DELETE /organizations/current/members/m-u2': () => {
        team = team.filter((m) => m.userId !== 'u2');
        return ok(null);
      },
    });
    renderRoute('/settings/organization');

    const roleSelect = await screen.findByLabelText('Role for Grace Hopper');
    expect(screen.queryByLabelText('Role for Ada Lovelace')).not.toBeInTheDocument(); // the owner (you) can't be changed
    await userEvent.selectOptions(roleSelect, 'reviewer');
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/members/m-u2') && init?.method === 'PATCH' && init.body === '{"role":"reviewer"}')).toBe(true),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Remove Grace Hopper' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Remove Grace Hopper?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Remove Grace' }));
    await waitFor(() => expect(screen.queryByText('Grace Hopper')).not.toBeInTheDocument());
  });

  it('shows admins only the controls they may use', async () => {
    mockApi({
      'GET /me': session('admin', { user: { id: 'u3', name: 'Alan Turing', email: 'alan@example.test', emailVerified: true } }),
      'GET /organizations/current/members': () => ok(TEAM),
      'GET /organizations/current/invitations': () => ok([]),
      'GET /usage': usage,
    });
    renderRoute('/settings/organization');

    const roleSelect = await screen.findByLabelText('Role for Grace Hopper');
    expect(within(roleSelect).queryByRole('option', { name: 'Admin' })).not.toBeInTheDocument();
    expect(within(screen.getByLabelText('Role')).queryByRole('option', { name: 'Admin' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leave organization' })).toBeInTheDocument();
  });

  it('gives editors a read-only list and a way to leave', async () => {
    const { fetchMock } = mockApi({
      'GET /me': session('editor', { user: { id: 'u2', name: 'Grace Hopper', email: 'grace@example.test', emailVerified: true } }),
      'GET /organizations/current/members': () => ok(TEAM),
      'DELETE /organizations/current/members/m-u2': () => ok(null),
    });
    renderRoute('/settings/organization');

    expect(await screen.findByRole('cell', { name: 'grace@example.test' })).toBeInTheDocument(); // the members table, not the sidebar
    expect(screen.queryByRole('heading', { name: 'Invite a teammate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Leave organization' }));
    await userEvent.click(screen.getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true));
  });
});

describe('content rules', () => {
  it('saves agency-wide prohibited claims, one per line', async () => {
    const { fetchMock } = mockApi({
      'GET /me': session(),
      'GET /organizations/current/members': () => ok(TEAM),
      'GET /organizations/current/invitations': () => ok([]),
      'GET /usage': usage,
      'PATCH /organizations/current': (body) => ok({ ...sessionInfo().organization, contentRules: (body as { contentRules: unknown }).contentRules }),
    });
    renderRoute('/settings/organization');

    await userEvent.type(await screen.findByLabelText('Prohibited claims'), 'guaranteed{enter}  cures  {enter}{enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Save rules' }));

    expect(await screen.findByText(/Content rules saved/)).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(String(call![1]!.body))).toEqual({ contentRules: { prohibitedClaims: ['guaranteed', 'cures'] } });
  });

  it('are read-only for editors', async () => {
    mockApi({
      'GET /me': session('editor', {
        organization: { ...sessionInfo().organization, contentRules: { prohibitedClaims: ['guaranteed'] } },
      }),
      'GET /organizations/current/members': () => ok(TEAM),
    });
    renderRoute('/settings/organization');
    expect(await screen.findByText('guaranteed')).toBeInTheDocument();
    expect(screen.queryByLabelText('Prohibited claims')).not.toBeInTheDocument();
  });
});

describe('organization switcher', () => {
  it('appears for people in several organizations and switches the whole app', async () => {
    const organizations = [
      { id: 'o1', name: 'Analytical Agency', role: 'owner' as const },
      { id: ORG_2, name: 'Second Studio', role: 'editor' as const },
    ];
    const { fetchMock } = mockApi({
      'GET /me': session('owner', { organizations }),
      'GET /clients?page=1&pageSize=20': () => ok(EMPTY_CLIENTS),
      'POST /auth/switch-organization': () =>
        ok({ ...sessionInfo('editor'), organization: { ...sessionInfo().organization, id: ORG_2, name: 'Second Studio' }, organizations }),
    });
    const { router } = renderRoute('/clients');

    const switcher = await screen.findByRole('combobox', { name: 'Organization' });
    expect(switcher).toHaveValue('o1');
    await userEvent.selectOptions(switcher, ORG_2);

    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
    expect(screen.getByRole('combobox', { name: 'Organization' })).toHaveValue(ORG_2);
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/auth/switch-organization'));
    expect(JSON.parse(String(call![1]!.body))).toEqual({ organizationId: ORG_2 });
  });

  it('is hidden for people in one organization', async () => {
    mockApi({ 'GET /me': session(), 'GET /clients?page=1&pageSize=20': () => ok(EMPTY_CLIENTS) });
    renderRoute('/clients');
    expect(await screen.findByRole('link', { name: 'Clients' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Organization' })).not.toBeInTheDocument();
  });
});

describe('getting started checklist', () => {
  beforeEach(() => localStorage.clear());

  const summary = (overrides: Partial<DashboardSummary> = {}): DashboardSummary => ({
    ...dashboardSummary(),
    clients: { used: 1, limit: null },
    recentClients: [{ id: 'e'.repeat(24), name: 'Kitchen Co', updatedAt: '2026-10-10T00:00:00.000Z' }],
    products: { used: 0, limit: 2500 },
    recentExports: [],
    jobs: { active: 1, activeLimit: null, needsReview: 1, failed: 0 },
    recentJobs: [{ id: 'f'.repeat(24), name: 'Spring', status: 'review', clientName: 'Kitchen Co', updatedAt: '2026-10-11T00:00:00.000Z' }],
    ...overrides,
  });

  it('ticks off steps from real data and can be hidden for good', async () => {
    mockApi({
      'GET /me': session(),
      'GET /health': () => jsonResponse(healthBody()),
      [DASHBOARD_SUMMARY]: () => ok(summary()),
      'GET /organizations/current/members': () => ok(TEAM.slice(0, 1)),
    });
    const view = renderRoute('/dashboard');

    expect(await screen.findByRole('heading', { name: 'Getting started' })).toBeInTheDocument();
    expect(await screen.findByText('3 of 6 done')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Export a clean CSV' })).toHaveAttribute('href', '/jobs');
    expect(screen.getByRole('link', { name: 'Invite your team' })).toHaveAttribute('href', '/settings/organization');
    expect(screen.queryByRole('link', { name: 'Create a client workspace' })).not.toBeInTheDocument(); // done

    await userEvent.click(screen.getByRole('button', { name: 'Hide the getting started checklist' }));
    expect(screen.queryByRole('heading', { name: 'Getting started' })).not.toBeInTheDocument();

    view.unmount();
    renderRoute('/dashboard');
    expect(await screen.findByRole('heading', { name: 'Activity' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Getting started' })).not.toBeInTheDocument();
  });

  it('disappears once everything is done', async () => {
    mockApi({
      'GET /me': session('owner', { organization: { ...sessionInfo().organization, contentRules: { prohibitedClaims: ['guaranteed'] } } }),
      'GET /health': () => jsonResponse(healthBody()),
      [DASHBOARD_SUMMARY]: () =>
        ok(summary({ recentExports: [{ id: 'x1', jobId: 'f'.repeat(24), filename: 'spring.csv', rowCount: 3, createdAt: '2026-10-12T00:00:00.000Z' }] })),
      'GET /organizations/current/members': () => ok(TEAM),
    });
    renderRoute('/dashboard');

    expect(await screen.findByRole('link', { name: 'spring.csv' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Getting started' })).not.toBeInTheDocument());
  });
});
