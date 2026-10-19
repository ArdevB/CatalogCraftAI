import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BRAND_PROFILE, type CatalogRow, type Job, type JobEnrichment, type Role, type UsageSummary } from '@catalogcraft/shared';
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

describe('suggestions', () => {
  const doneRow: CatalogRow = {
    id: 'r1',
    rowNumber: 2,
    sourceIdentifier: 'MUG-1',
    status: 'valid',
    original: { sku: 'MUG-1', title: 'Mug stoneware blue' },
    issues: [],
    suggestions: [
      {
        field: 'title',
        value: 'Blue stoneware mug, 350 ml',
        status: 'pending',
        warnings: ["Mentions “350”, which doesn't appear in the product data. Check before approving."],
        model: 'claude-opus-5-5',
        promptVersion: 'product-enrichment@1',
        generatedAt: '2026-10-18T10:06:00.000Z',
      },
    ],
    enrichment: { status: 'done', error: null, missingFacts: ['capacity'], notes: [] },
  };
  const failedRow: CatalogRow = {
    ...doneRow,
    id: 'r2',
    rowNumber: 3,
    sourceIdentifier: 'MUG-2',
    suggestions: [],
    enrichment: { status: 'failed', error: 'The AI declined to write copy for this product.', missingFacts: [], notes: [] },
  };
  const page = (items: CatalogRow[]) => ok({ items, pagination: { page: 1, pageSize: 25, totalItems: items.length, totalPages: 1 } });

  it('shows each suggestion beside the original, with warnings and failures', async () => {
    mockApi({
      'GET /me': session(),
      [`GET /jobs/${JOB_ID}`]: () =>
        ok(makeJob({ status: 'review', enrichment: enrichment({ processedRows: 3, succeededRows: 2, failedRows: 1, finishedAt: '2026-10-18T10:07:00.000Z' }) })),
      [`GET /jobs/${JOB_ID}/rows?page=1&pageSize=25&enrichment=done`]: () => page([doneRow]),
      [`GET /jobs/${JOB_ID}/rows?page=1&pageSize=25&enrichment=failed`]: () => page([failedRow]),
      [`GET /jobs/${JOB_ID}/rows?page=1&pageSize=25`]: emptyRows,
    });
    renderRoute(`/jobs/${JOB_ID}`);

    const card = (await screen.findByRole('heading', { name: 'AI suggestions' })).closest('div')!.parentElement!;
    expect(within(card).getByText(/2 products have suggestions, 1 failed/)).toBeInTheDocument();
    expect(await screen.findByText('Blue stoneware mug, 350 ml')).toBeInTheDocument();
    expect(screen.getByText('Mug stoneware blue')).toBeInTheDocument();
    expect(screen.getByText(/Mentions “350”/)).toBeInTheDocument();
    expect(screen.getByText(/Missing facts: capacity/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Failed' }));
    expect(await screen.findByText('The AI declined to write copy for this product.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate more suggestions' })).toBeInTheDocument();
  });
});

describe('usage page', () => {
  it('shows this month’s usage, cost estimate and AI status to owners', async () => {
    mockApi({ 'GET /me': session(), 'GET /usage': () => ok(usage()) });
    renderRoute('/usage');

    expect(await screen.findByRole('heading', { name: 'Usage and plan' })).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('$0.63')).toBeInTheDocument();
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
