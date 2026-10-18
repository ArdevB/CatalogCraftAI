import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import { permissionsForRole, type Role, type SessionInfo } from '@catalogcraft/shared';
import { createQueryClient } from '@/lib/query-client';
import { routes } from '@/routes/router';

function testQueryClient() {
  const client = createQueryClient();
  // No retries in tests so error states appear immediately.
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retry: false } });
  return client;
}

export function renderRoute(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <QueryClientProvider client={testQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, router };
}

export function renderWithQuery(ui: ReactElement) {
  return render(<QueryClientProvider client={testQueryClient()}>{ui}</QueryClientProvider>);
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export function ok(data: unknown, status = 200): Response {
  return jsonResponse({ success: true, data }, status);
}

export function fail(status: number, code: string, message: string, details?: unknown[]): Response {
  return jsonResponse({ success: false, error: { code, message, ...(details ? { details } : {}) } }, status);
}

export const unauthenticated = () => fail(401, 'UNAUTHENTICATED', 'Please sign in to continue.');

/** Replaces global fetch with a mock that returns the given responses in order. */
export function mockFetch(...responses: Array<Response | Error>) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const response of responses) {
    if (response instanceof Error) fetchMock.mockRejectedValueOnce(response);
    else fetchMock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

type Handler = (body: unknown) => Response;

/**
 * A fake API keyed by "METHOD /path" (path without /api/v1). Handlers can be
 * reassigned during a test to simulate the server changing state.
 */
export function mockApi(handlers: Record<string, Handler>) {
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input).replace(/^\/api\/v1/, '');
    const key = `${init?.method ?? 'GET'} ${path}`;
    const handler = handlers[key];
    if (!handler) return fail(404, 'NOT_FOUND', `No mock for ${key}`);
    const body = init?.body instanceof FormData ? init.body : init?.body ? JSON.parse(String(init.body)) : undefined;
    return handler(body);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, handlers };
}

export function sessionInfo(role: Role = 'owner'): SessionInfo {
  return {
    user: { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.test' },
    organization: {
      id: 'o1',
      name: 'Analytical Agency',
      plan: 'trial',
      subscriptionStatus: 'trialing',
      createdAt: '2026-01-15T10:00:00.000Z',
    },
    role,
    permissions: permissionsForRole(role),
  };
}

export function healthBody(database: 'connected' | 'disconnected' = 'connected') {
  return {
    success: true,
    data: {
      status: database === 'connected' ? 'ok' : 'degraded',
      service: 'catalogcraft-api',
      version: '0.1.0',
      environment: 'test',
      uptimeSeconds: 12.3,
      timestamp: new Date().toISOString(),
      checks: { database },
    },
  };
}
