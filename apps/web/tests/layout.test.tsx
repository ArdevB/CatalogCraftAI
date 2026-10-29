import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DASHBOARD_SUMMARY, dashboardSummary, healthBody, jsonResponse, mockApi, ok, renderRoute, sessionInfo } from './utils';

beforeEach(() => localStorage.clear());

function mockSignedIn(role: Parameters<typeof sessionInfo>[0] = 'owner') {
  localStorage.setItem('catalogcraft:getting-started-dismissed:o1', '1');
  mockApi({
    'GET /me': () => ok(sessionInfo(role)),
    'GET /health': () => jsonResponse(healthBody()),
    [DASHBOARD_SUMMARY]: () => ok(dashboardSummary()),
    'GET /clients?page=1&pageSize=20': () =>
      ok({ items: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 1 }, allowance: { used: 0, limit: null } }),
  });
}

/** Pretend to be a phone: the desktop media query doesn't match. */
function asPhone() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe('sidebar navigation', () => {
  it('lists every section in the sidebar and marks the current page', async () => {
    mockSignedIn();
    renderRoute('/dashboard');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    const links = ['Dashboard', 'Clients', 'Jobs', 'Usage', 'Organization', 'Account'].map((name) => screen.getByRole('link', { name }));
    for (const link of links) expect(nav).toContainElement(link);
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');

    await userEvent.click(screen.getByRole('link', { name: 'Clients' }));
    await waitFor(() => expect(screen.getByRole('link', { name: 'Clients' })).toHaveAttribute('aria-current', 'page'));
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
  });

  it('hides sections a role can’t use', async () => {
    mockSignedIn('editor');
    renderRoute('/dashboard');
    expect(await screen.findByRole('link', { name: 'Jobs' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Usage' })).not.toBeInTheDocument();
  });

  it('starts as a slim icon rail, keeps links readable, and remembers when it is expanded', async () => {
    mockSignedIn();
    const view = renderRoute('/dashboard');
    const expand = await screen.findByRole('button', { name: 'Expand sidebar' });
    expect(expand).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('link', { name: 'Clients' })).toBeInTheDocument(); // the label is a tooltip, still its name

    await userEvent.click(expand);
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toHaveAttribute('aria-pressed', 'false');
    expect(localStorage.getItem('catalogcraft:sidebar-collapsed')).toBe('0');

    view.unmount();
    renderRoute('/dashboard');
    expect(await screen.findByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument();
  });

  it('becomes a drawer on small screens that closes with Escape or after choosing a page', async () => {
    asPhone();
    mockSignedIn();
    renderRoute('/dashboard');

    const sidebar = await screen.findByRole('complementary', { name: 'Sidebar', hidden: true });
    expect(sidebar).toHaveAttribute('inert'); // closed: out of reach for keyboards and screen readers
    const open = screen.getByRole('button', { name: 'Open navigation' });

    await userEvent.click(open);
    expect(open).toHaveAttribute('aria-expanded', 'true');
    expect(sidebar).not.toHaveAttribute('inert');
    await userEvent.keyboard('{Escape}');
    expect(open).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(open);
    await userEvent.click(screen.getByRole('link', { name: 'Clients' }));
    expect(open).toHaveAttribute('aria-expanded', 'false');
    expect(await screen.findByRole('heading', { name: 'Clients' })).toBeInTheDocument();
  });
});
