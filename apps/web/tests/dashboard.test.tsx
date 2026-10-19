import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DashboardSummary, Role } from '@catalogcraft/shared';
import { avatarFor, timeAgo } from '@/features/dashboard/format';
import { weekOverWeek } from '@/features/dashboard/stat-card';
import { DASHBOARD_SUMMARY, dashboardSummary, healthBody, jsonResponse, mockApi, ok, renderRoute, sessionInfo } from './utils';

beforeEach(() => localStorage.clear());

function renderDashboard(summary: DashboardSummary, role: Role = 'owner') {
  // Hide the getting-started checklist so these tests focus on the figures.
  localStorage.setItem('catalogcraft:getting-started-dismissed:o1', '1');
  mockApi({
    'GET /me': () => ok(sessionInfo(role)),
    'GET /health': () => jsonResponse(healthBody()),
    [DASHBOARD_SUMMARY]: () => ok(summary),
    'GET /organizations/current/members': () => ok([]),
  });
  return renderRoute('/dashboard');
}

/** 30 days of figures where only the given days (counted back from today: 0 = today) have values. */
function withTrend(values: Record<number, { productsEnriched?: number; exports?: number }>): DashboardSummary['trend'] {
  return dashboardSummary().trend.map((day, i, all) => ({ ...day, ...values[all.length - 1 - i] }));
}

describe('dashboard', () => {
  it('greets the user and shows the headline figures', async () => {
    renderDashboard(
      dashboardSummary({
        clients: { used: 2, limit: null },
        recentClients: [{ id: 'e'.repeat(24), name: 'Recent Co', updatedAt: new Date().toISOString() }],
        products: { used: 120, limit: 2500 },
        jobs: { active: 1, activeLimit: null, needsReview: 2, failed: 1 },
        pendingSuggestions: 37,
        recentJobs: [{ id: 'f'.repeat(24), name: 'Spring import', status: 'failed', clientName: 'Recent Co', updatedAt: new Date().toISOString() }],
      }),
    );

    expect(await screen.findByRole('heading', { level: 1, name: /, Ada$/ })).toBeInTheDocument();
    expect(await screen.findByLabelText('120')).toBeInTheDocument(); // products enriched
    expect(screen.getByLabelText('37')).toBeInTheDocument(); // suggestions awaiting review
    expect(screen.getByText('2 jobs in review')).toBeInTheDocument();
    expect(screen.getByText('1 failed — open the job to see why')).toBeInTheDocument();
    expect(screen.getByText('This month · of 2,500 on your plan')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Products enriched this month' })).toHaveAttribute('aria-valuenow', '120');
    expect(screen.getByText('2 · unlimited')).toBeInTheDocument(); // client workspaces
    expect(screen.getByRole('link', { name: 'Spring import' })).toHaveAttribute('href', `/jobs/${'f'.repeat(24)}`);
    expect(screen.getByRole('link', { name: /Recent Co/ })).toHaveAttribute('href', `/clients/${'e'.repeat(24)}`);
    expect(screen.getByRole('link', { name: /New import/ })).toHaveAttribute('href', '/clients');
  });

  it('charts daily activity, switches series and can be read with the keyboard', async () => {
    renderDashboard(dashboardSummary({ trend: withTrend({ 0: { productsEnriched: 4, exports: 1 }, 2: { productsEnriched: 9 } }) }));

    expect(await screen.findByText('13 products enriched in the last 30 days')).toBeInTheDocument();
    const chart = screen.getByRole('img', { name: 'Chart of products enriched per day' });
    expect(screen.getByText(/Busiest day: .* with 9\./)).toBeInTheDocument();

    fireEvent.keyDown(chart, { key: 'ArrowLeft' }); // from today back to yesterday
    expect(chart).toHaveAccessibleName(/: 0 products enriched$/);
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    expect(chart).toHaveAccessibleName(/: 9 products enriched$/);

    await userEvent.click(screen.getByRole('radio', { name: 'Exports' }));
    expect(screen.getByText('1 exports in the last 30 days')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Chart of exports per day' })).toBeInTheDocument();
  });

  it('shows the week-over-week change on stat cards', async () => {
    renderDashboard(dashboardSummary({ trend: withTrend({ 1: { productsEnriched: 20 }, 9: { productsEnriched: 10 } }) }));
    expect(await screen.findByText('more than the previous week', { exact: false })).toBeInTheDocument();
    expect(screen.getByTitle('Last 7 days compared with the 7 days before')).toHaveTextContent('100%');
  });

  it('breaks jobs down by stage', async () => {
    renderDashboard(dashboardSummary({ jobsByStatus: { draft: 1, uploaded: 1, review: 2, completed: 3, failed: 1 } }));
    expect(await screen.findByText('8 jobs in total')).toBeInTheDocument();
    const legend = screen.getByRole('img', { name: /^Jobs by stage/ }).parentElement!;
    const count = (label: string) => within(legend).getByText(label).closest('li')!.lastElementChild!.textContent;
    expect(count('Setting up')).toBe('2');
    expect(count('In review')).toBe('2');
    expect(count('Completed')).toBe('3');
    expect(count('Failed')).toBe('1');
  });

  it('guides a brand-new agency with empty states', async () => {
    renderDashboard(dashboardSummary({ plan: 'trial', clients: { used: 0, limit: 1 }, products: { used: 0, limit: 25 }, jobs: { active: 0, activeLimit: 1, needsReview: 0, failed: 0 } }));
    expect(await screen.findByRole('link', { name: 'Create your first client' })).toHaveAttribute('href', '/clients/new');
    expect(screen.getByText('No imports yet')).toBeInTheDocument();
    expect(screen.getByText('No exports yet')).toBeInTheDocument();
    expect(screen.getByText('Enriched products will appear here.')).toBeInTheDocument();
    expect(screen.getByText('Client workspaces').closest('li')).toHaveTextContent('0 of 1'); // trial limit
  });

  it('hides actions a reviewer can’t take', async () => {
    renderDashboard(dashboardSummary(), 'reviewer');
    expect(await screen.findByRole('heading', { name: 'Activity' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /New import/ })).not.toBeInTheDocument();
    expect(screen.getByText('An owner or admin can add client workspaces.')).toBeInTheDocument();
  });
});

describe('dashboard helpers', () => {
  it('compares the last 7 days with the 7 before', () => {
    expect(weekOverWeek([...Array(7).fill(1), ...Array(7).fill(2)])).toBe(100);
    expect(weekOverWeek([...Array(7).fill(2), ...Array(7).fill(1)])).toBe(-50);
    expect(weekOverWeek(Array(14).fill(0))).toBeNull(); // nothing to compare with
  });

  it('formats relative times and avatars', () => {
    const now = Date.parse('2026-10-19T12:00:00Z');
    expect(timeAgo('2026-10-19T11:59:40Z', now)).toBe('just now');
    expect(timeAgo('2026-10-19T09:00:00Z', now)).toMatch(/3 hours ago/);
    expect(timeAgo('2026-10-18T12:00:00Z', now)).toMatch(/yesterday/);
    expect(avatarFor('Kitchen Co').initials).toBe('KC');
    expect(avatarFor('Acme').initials).toBe('AC');
    expect(avatarFor('Kitchen Co').tone).toBe(avatarFor('Kitchen Co').tone); // stable colour
  });
});
