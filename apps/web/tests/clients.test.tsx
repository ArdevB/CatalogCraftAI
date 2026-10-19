import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BRAND_PROFILE, type Client, type Role } from '@catalogcraft/shared';
import { fail, mockApi, ok, renderRoute, sessionInfo } from './utils';

function makeClient(overrides: Partial<Client> = {}): Client {
  return {
    id: '64b7f0c2a1b2c3d4e5f60718',
    name: 'Northwind Home Goods',
    internalReference: 'NW-1',
    brandProfile: {
      ...DEFAULT_BRAND_PROFILE,
      brandTone: 'Warm and plain-spoken',
      prohibitedClaims: ['eco-friendly'],
      defaultLanguage: 'en-GB',
    },
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
    ...overrides,
  };
}

function listBody(items: Client[], options: { page?: number; totalPages?: number; limit?: number | null } = {}) {
  return {
    items,
    pagination: {
      page: options.page ?? 1,
      pageSize: 20,
      totalItems: items.length,
      totalPages: options.totalPages ?? 1,
    },
    allowance: { used: items.length, limit: options.limit === undefined ? null : options.limit },
  };
}

const session = (role: Role = 'owner') => () => ok(sessionInfo(role));

describe('clients list', () => {
  it('shows clients with links, and the workspace allowance', async () => {
    mockApi({
      'GET /me': session(),
      'GET /clients?page=1&pageSize=20': () => ok(listBody([makeClient()], { limit: 3 })),
    });
    renderRoute('/clients');

    const link = await screen.findByRole('link', { name: 'Northwind Home Goods' });
    expect(link).toHaveAttribute('href', '/clients/64b7f0c2a1b2c3d4e5f60718');
    expect(screen.getByText('English (UK)')).toBeInTheDocument();
    expect(screen.getByText(/1 of 3 client workspaces used/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New client' })).toHaveAttribute('href', '/clients/new');
  });

  it('shows an empty state with a call to action', async () => {
    mockApi({ 'GET /me': session(), 'GET /clients?page=1&pageSize=20': () => ok(listBody([])) });
    renderRoute('/clients');

    expect(await screen.findByText('No clients yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create your first client' })).toHaveAttribute('href', '/clients/new');
  });

  it('disables "New client" when the plan limit is reached', async () => {
    mockApi({
      'GET /me': session(),
      'GET /clients?page=1&pageSize=20': () => ok(listBody([makeClient()], { limit: 1 })),
    });
    renderRoute('/clients');

    expect(await screen.findByRole('button', { name: 'New client' })).toBeDisabled();
    expect(screen.getByText(/Plan limit reached/)).toBeInTheDocument();
  });

  it('hides management actions from roles that cannot manage clients', async () => {
    mockApi({ 'GET /me': session('reviewer'), 'GET /clients?page=1&pageSize=20': () => ok(listBody([])) });
    renderRoute('/clients');

    expect(await screen.findByText('Ask an owner or admin to add one.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /new client|create your first client/i })).not.toBeInTheDocument();
  });

  it('searches on the server after typing stops', async () => {
    const { fetchMock } = mockApi({
      'GET /me': session(),
      'GET /clients?page=1&pageSize=20': () => ok(listBody([makeClient(), makeClient({ id: 'b'.repeat(24), name: 'Acme' })])),
      'GET /clients?page=1&pageSize=20&search=acme': () => ok(listBody([makeClient({ id: 'b'.repeat(24), name: 'Acme' })])),
    });
    renderRoute('/clients');

    await screen.findByRole('link', { name: 'Northwind Home Goods' });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search clients' }), 'acme');

    await waitFor(() => expect(screen.queryByRole('link', { name: 'Northwind Home Goods' })).not.toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Acme' })).toBeInTheDocument();
    // Debounced: one search request, not one per keystroke.
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('search=')).length).toBe(1);
  });

  it('pages through results', async () => {
    mockApi({
      'GET /me': session(),
      'GET /clients?page=1&pageSize=20': () => ok(listBody([makeClient()], { page: 1, totalPages: 2 })),
      'GET /clients?page=2&pageSize=20': () =>
        ok(listBody([makeClient({ id: 'c'.repeat(24), name: 'Zephyr' })], { page: 2, totalPages: 2 })),
    });
    renderRoute('/clients');

    expect(await screen.findByText('Page 1 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByRole('link', { name: 'Zephyr' })).toBeInTheDocument();
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('offers a retry when loading fails', async () => {
    const { handlers } = mockApi({
      'GET /me': session(),
      'GET /clients?page=1&pageSize=20': () => fail(503, 'SERVICE_UNAVAILABLE', 'Database unavailable.'),
    });
    renderRoute('/clients');

    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable.');
    handlers['GET /clients?page=1&pageSize=20'] = () => ok(listBody([makeClient()]));
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'Northwind Home Goods' })).toBeInTheDocument();
  });
});

describe('creating a client', () => {
  it('validates, submits the brand profile as lists, and opens the new client', async () => {
    let submitted: unknown;
    const created = makeClient({ id: 'd'.repeat(24), name: 'Bake Supply' });
    mockApi({
      'GET /me': session(),
      'POST /clients': (body) => {
        submitted = body;
        return ok(created, 201);
      },
      [`GET /clients/${created.id}`]: () => ok(created),
    });
    renderRoute('/clients/new');

    await userEvent.click(await screen.findByRole('button', { name: 'Create client' }));
    expect(await screen.findByText('Enter a client name.')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Client name'), 'Bake Supply');
    await userEvent.selectOptions(screen.getByLabelText('Default language'), 'fr');
    const titleLength = screen.getByLabelText('Maximum title length');
    await userEvent.clear(titleLength);
    await userEvent.type(titleLength, '90');
    await userEvent.type(screen.getByLabelText('Prohibited claims'), 'best ever{enter}{enter}  organic  ');
    await userEvent.click(screen.getByRole('button', { name: 'Create client' }));

    expect(await screen.findByRole('heading', { name: 'Bake Supply' })).toBeInTheDocument();
    expect(submitted).toEqual({
      name: 'Bake Supply',
      brandProfile: {
        brandTone: '',
        targetAudience: '',
        preferredTerminology: [],
        prohibitedClaims: ['best ever', 'organic'],
        defaultLanguage: 'fr',
        maxTitleLength: 90,
      },
    });
  });

  it('shows plan-limit and field errors from the server', async () => {
    const { handlers } = mockApi({
      'GET /me': session(),
      'POST /clients': () =>
        fail(403, 'PLAN_LIMIT_REACHED', 'Your plan includes 1 client workspace. Upgrade to add more clients.'),
    });
    renderRoute('/clients/new');

    await userEvent.type(await screen.findByLabelText('Client name'), 'Second');
    await userEvent.click(screen.getByRole('button', { name: 'Create client' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Upgrade to add more clients.');

    handlers['POST /clients'] = () =>
      fail(400, 'VALIDATION_ERROR', 'The request contains invalid data.', [
        { path: 'body.brandProfile.prohibitedClaims.0', message: 'Prohibited claims entries must be at most 200 characters.' },
      ]);
    await userEvent.click(screen.getByRole('button', { name: 'Create client' }));
    expect(await screen.findByText('Prohibited claims entries must be at most 200 characters.')).toBeInTheDocument();
    expect(screen.getByLabelText('Prohibited claims')).toHaveAttribute('aria-invalid', 'true');
  });

  it('tells roles without permission instead of showing the form', async () => {
    mockApi({ 'GET /me': session('editor') });
    renderRoute('/clients/new');

    expect(await screen.findByText('Only owners and admins can create client workspaces.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create client' })).not.toBeInTheDocument();
  });
});

describe('client detail', () => {
  const client = makeClient();

  it('shows the brand profile', async () => {
    mockApi({ 'GET /me': session(), [`GET /clients/${client.id}`]: () => ok(client) });
    renderRoute(`/clients/${client.id}`);

    expect(await screen.findByRole('heading', { name: 'Northwind Home Goods' })).toBeInTheDocument();
    expect(screen.getByText('Warm and plain-spoken')).toBeInTheDocument();
    expect(screen.getByText('eco-friendly')).toBeInTheDocument();
    expect(screen.getByText('English (UK)')).toBeInTheDocument();
  });

  it('shows "not found" for unknown or other agencies’ clients', async () => {
    mockApi({ 'GET /me': session(), [`GET /clients/${client.id}`]: () => fail(404, 'NOT_FOUND', 'Client not found.') });
    renderRoute(`/clients/${client.id}`);

    expect(await screen.findByRole('heading', { name: 'Client not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to clients' })).toHaveAttribute('href', '/clients');
  });

  it('deletes only after confirmation, then returns to the list', async () => {
    let deleted = false;
    mockApi({
      'GET /me': session(),
      [`GET /clients/${client.id}`]: () => ok(client),
      [`DELETE /clients/${client.id}`]: () => {
        deleted = true;
        return ok(null);
      },
      'GET /clients?page=1&pageSize=20': () => ok(listBody([])),
    });
    const { router } = renderRoute(`/clients/${client.id}`);

    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('alertdialog');
    expect(deleted).toBe(false);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete client' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/clients'));
    expect(deleted).toBe(true);
  });

  it('hides edit and delete from roles that cannot manage clients', async () => {
    mockApi({ 'GET /me': session('reviewer'), [`GET /clients/${client.id}`]: () => ok(client) });
    renderRoute(`/clients/${client.id}`);

    await screen.findByRole('heading', { name: 'Northwind Home Goods' });
    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });
});

describe('editing a client', () => {
  it('pre-fills the form and saves changes, clearing an emptied reference', async () => {
    const client = makeClient();
    let patched: unknown;
    mockApi({
      'GET /me': session(),
      [`GET /clients/${client.id}`]: () => ok(client),
      [`PATCH /clients/${client.id}`]: (body) => {
        patched = body;
        return ok({ ...client, name: 'Northwind Renamed', internalReference: null });
      },
    });
    const { router } = renderRoute(`/clients/${client.id}/edit`);

    const name = await screen.findByLabelText('Client name');
    expect(name).toHaveValue('Northwind Home Goods');
    expect(screen.getByLabelText('Prohibited claims')).toHaveValue('eco-friendly');

    await userEvent.clear(name);
    await userEvent.type(name, 'Northwind Renamed');
    await userEvent.clear(screen.getByLabelText('Internal reference (optional)'));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/clients/${client.id}`));
    expect(patched).toMatchObject({
      name: 'Northwind Renamed',
      internalReference: null,
      brandProfile: { prohibitedClaims: ['eco-friendly'], defaultLanguage: 'en-GB' },
    });
  });
});
