import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BRAND_PROFILE, type Job, type JobEnrichment, type Role, type UsageSummary } from '@catalogcraft/shared';
import { fail, mockApi, ok, renderRoute, sessionInfo } from './utils';

const JOB_ID = 'a'.repeat(24);
const CLIENT_ID = 'c'.repeat(24);
const session = (role: Role = 'owner') => () => ok(sessionInfo(role));

const enrichment = (overrides: Partial<JobEnrichment> = {}): JobEnrichment => ({
  fields: ['title', 'description'],
  language: 'en-GB',
  includeWarningRows: true,
  model: 'claude-opus-5-5',
  promptVersion: 'product-enrichment@1',
  totalRows: 3,
  processedRows: 0,
  succeededRows: 0,
  failedRows: 0,
  cancelRequested: false,
  startedAt: null,
  finishedAt: null,
  ...overrides,
});

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: JOB_ID,
    name: 'Spring catalogue',
    status: 'ready',
    client: { id: CLIENT_ID, name: 'Kitchen Co' },
    createdBy: { id: 'u1', name: 'Ada Lovelace' },
    file: { filename: 'p.csv', fileType: 'csv', sizeBytes: 900, sheets: ['CSV'], uploadedAt: '2026-10-18T10:00:00.000Z' },
    importConfig: { sheetName: null, headerRow: 1, mapping: { sku: 0, title: 1 }, headers: ['SKU', 'Name'] },
    counts: { totalRows: 4, validRows: 2, warningRows: 1, failedRows: 1, skippedEmptyRows: 0 },
    issueSummary: [],
    lastError: null,
    enrichment: null,
    review: null,
    createdAt: '2026-10-18T10:00:00.000Z',
    updatedAt: '2026-10-18T10:05:00.000Z',
    ...overrides,
  };
}

const usage = (overrides: Partial<UsageSummary> = {}): UsageSummary => ({
  plan: 'agency',
  period: { start: '2026-10-01T00:00:00.000Z', end: '2026-11-01T00:00:00.000Z' },
  products: { used: 100, reserved: 0, limit: 2500 },
  aiRequests: 104,
  failedRequests: 4,
  inputTokens: 52_000,
  outputTokens: 21_000,
  estimatedCostUsd: 0.63,
  ai: { configured: true, model: 'claude-opus-5-5' },
  limits: {
    clientWorkspaces: { used: 2, limit: null },
    members: { used: 2, limit: 3 },
    activeJobs: { used: 1, limit: null },
  },
  ...overrides,
});

const client = () =>
  ok({ id: CLIENT_ID, name: 'Kitchen Co', internalReference: null, brandProfile: { ...DEFAULT_BRAND_PROFILE, defaultLanguage: 'fr' }, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' });
const emptyRows = () => ok({ items: [], pagination: { page: 1, pageSize: 25, totalItems: 0, totalPages: 0 } });

function readyApi(extra: Record<string, (body: unknown) => Response> = {}) {
  return mockApi({
    'GET /me': session(),
    [`GET /jobs/${JOB_ID}`]: () => ok(makeJob()),
    'GET /ai/status': () => ok({ configured: true, model: 'claude-opus-5-5' }),
    [`GET /clients/${CLIENT_ID}`]: client,
    'GET /usage': () => ok(usage()),
    [`GET /jobs/${JOB_ID}/rows?page=1&pageSize=25`]: emptyRows,
    ...extra,
  });
}

describe('enrichment settings', () => {
  it('starts enrichment with the chosen fields, client language and row scope', async () => {
    let sent: unknown;
    readyApi({
      [`POST /jobs/${JOB_ID}/enrich`]: (body) => {
        sent = body;
        return ok(makeJob({ status: 'queued', enrichment: enrichment({ fields: ['title', 'tags'], language: 'fr', includeWarningRows: false, totalRows: 2 }) }), 202);
      },
    });
    renderRoute(`/jobs/${JOB_ID}`);

    expect(await screen.findByRole('heading', { name: 'Improve with AI' })).toBeInTheDocument();
    // The client's language is the default; 3 rows without errors would be sent.
    await waitFor(() => expect(screen.getByLabelText('Language')).toHaveValue('fr'));
    expect(screen.getByText('3 products')).toBeInTheDocument();
    expect(screen.getByText(/Your plan has 2,400 products left/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: /Description/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Tags/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Include rows with warnings/ }));
    expect(screen.getByText('2 products')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Generate suggestions' }));

    expect(await screen.findByText('Waiting to start…')).toBeInTheDocument();
    expect(sent).toEqual({ fields: ['title', 'tags'], language: 'fr', includeWarningRows: false });
  });

  it('explains when AI is not configured and cannot be started', async () => {
    readyApi({ 'GET /ai/status': () => ok({ configured: false, model: null }) });
    renderRoute(`/jobs/${JOB_ID}`);

    expect(await screen.findByText(/AI enrichment isn’t set up on this server yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate suggestions' })).toBeDisabled();
  });

  it('blocks runs larger than the remaining monthly allowance', async () => {
    readyApi({ 'GET /usage': () => ok(usage({ plan: 'trial', products: { used: 24, reserved: 0, limit: 25 } })) });
    renderRoute(`/jobs/${JOB_ID}`);

    expect(await screen.findByText(/more than your plan has left this month/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate suggestions' })).toBeDisabled();
  });

  it('shows server errors such as a plan limit reached by another job', async () => {
    readyApi({ [`POST /jobs/${JOB_ID}/enrich`]: () => fail(403, 'PLAN_LIMIT_REACHED', 'This needs 3 products, but your plan has 0 of 25 left this month.') });
    renderRoute(`/jobs/${JOB_ID}`);

    await userEvent.click(await screen.findByRole('button', { name: 'Generate suggestions' }));
    expect(await screen.findByText(/your plan has 0 of 25 left/)).toBeInTheDocument();
  });

  it('is not offered to reviewers', async () => {
    mockApi({
      'GET /me': session('reviewer'),
      [`GET /jobs/${JOB_ID}`]: () => ok(makeJob()),
      [`GET /jobs/${JOB_ID}/rows?page=1&pageSize=25`]: emptyRows,
    });
    renderRoute(`/jobs/${JOB_ID}`);

    expect(await screen.findByText('Product rows')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Improve with AI' })).not.toBeInTheDocument();
  });
});

describe('enrichment progress', () => {
  it('shows progress and can stop the run', async () => {
    let stopped = false;
    mockApi({
      'GET /me': session(),
      [`GET /jobs/${JOB_ID}`]: () =>
        ok(makeJob({ status: 'processing', enrichment: enrichment({ processedRows: 1, succeededRows: 1, cancelRequested: stopped }) })),
      [`POST /jobs/${JOB_ID}/enrich/cancel`]: () => {
        stopped = true;
        return ok(makeJob({ status: 'processing', enrichment: enrichment({ processedRows: 1, succeededRows: 1, cancelRequested: true }), updatedAt: '2026-10-18T10:06:00.000Z' }));
      },
    });
    renderRoute(`/jobs/${JOB_ID}`);

    expect(await screen.findByText('Generating suggestions…')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Enrichment progress' })).toHaveAttribute('aria-valuenow', '1');
    expect(screen.getByText(/1 of 3 products \(33%\)/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Stop enrichment' }));
    expect(await screen.findByText('Stopping after the current products…')).toBeInTheDocument();
    expect(stopped).toBe(true);
  });
});

describe('usage page', () => {
  it('shows this month’s usage, cost estimate and AI status to owners', async () => {
    mockApi({ 'GET /me': session(), 'GET /usage': () => ok(usage()) });
    renderRoute('/usage');

    expect(await screen.findByRole('heading', { name: 'Usage and plan' })).toBeInTheDocument();
    expect(screen.getByText('$0.63')).toBeInTheDocument();
    // Plan limits: in use vs. included, one row per limit.
    const limitCells = (name: string) =>
      Array.from(screen.getByRole('rowheader', { name }).closest('tr')!.querySelectorAll('td'), (cell) => cell.textContent);
    expect(limitCells('Products enriched this month')).toEqual(['100', '2,500']);
    expect(limitCells('Client workspaces')).toEqual(['2', 'Unlimited']);
    expect(limitCells('Team members (incl. pending invitations)')).toEqual(['2', '3']);
    expect(screen.getByText('Enabled — model claude-opus-5-5.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Usage' })).toHaveAttribute('href', '/usage');
  });

  it('is hidden from roles without access', async () => {
    mockApi({ 'GET /me': session('editor') });
    renderRoute('/usage');

    expect(await screen.findByText('Only owners and admins can see usage and plan details.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Usage' })).not.toBeInTheDocument();
  });
});
