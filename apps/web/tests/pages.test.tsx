import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SystemStatusCard } from '@/features/system/system-status-card';
import {
  healthBody,
  jsonResponse,
  mockApi,
  mockFetch,
  renderRoute,
  renderWithQuery,
  unauthenticated,
} from './utils';

describe('SystemStatusCard', () => {
  it('shows a loading state, then the live API and database status', async () => {
    mockFetch(jsonResponse(healthBody('connected')));
    renderWithQuery(<SystemStatusCard />);

    expect(screen.getByRole('status')).toHaveTextContent('Checking system status');
    expect(await screen.findByText('Online')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('0.1.0')).toBeInTheDocument();
  });

  it('explains a disconnected database', async () => {
    mockFetch(jsonResponse(healthBody('disconnected')));
    renderWithQuery(<SystemStatusCard />);

    expect(await screen.findByText('Disconnected')).toBeInTheDocument();
    expect(screen.getByText(/cannot reach MongoDB/i)).toBeInTheDocument();
  });

  it('shows an error with a working retry when the API is unreachable', async () => {
    const fetchMock = mockFetch(new TypeError('Failed to fetch'), jsonResponse(healthBody('connected')));
    renderWithQuery(<SystemStatusCard />);

    expect(await screen.findByRole('alert')).toHaveTextContent('API unavailable');

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Online')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('routing', () => {
  it('renders the landing page at / with sign-in options for visitors', async () => {
    mockApi({ 'GET /health': () => jsonResponse(healthBody()), 'GET /me': unauthenticated });
    renderRoute('/');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/clean, enrich, review and export/i);
    expect(await screen.findByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/register');
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    expect(await screen.findByText('Online')).toBeInTheDocument();
  });

  it('renders a not-found page for unknown paths', () => {
    renderRoute('/no/such/page');

    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/');
  });
});
