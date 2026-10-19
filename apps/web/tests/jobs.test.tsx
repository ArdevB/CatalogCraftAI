import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BRAND_PROFILE, type Job, type Preview, type Role } from '@catalogcraft/shared';
import { fail, mockApi, ok, renderRoute, sessionInfo } from './utils';

const JOB_ID = 'a'.repeat(24);
const CLIENT_ID = 'c'.repeat(24);
const session = (role: Role = 'owner') => () => ok(sessionInfo(role));

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: JOB_ID,
    name: 'Spring catalogue',
    status: 'draft',
    client: { id: CLIENT_ID, name: 'Kitchen Co' },
    createdBy: { id: 'u1', name: 'Ada Lovelace' },
    file: null,
    importConfig: null,
    counts: { totalRows: 0, validRows: 0, warningRows: 0, failedRows: 0, skippedEmptyRows: 0 },
    issueSummary: [],
    lastError: null,
    enrichment: null,
    createdAt: '2026-10-18T10:00:00.000Z',
    updatedAt: '2026-10-18T10:00:00.000Z',
    ...overrides,
  };
}

const uploadedFile = { filename: 'products.csv', fileType: 'csv' as const, sizeBytes: 2048, sheets: ['CSV'], uploadedAt: '2026-10-18T10:01:00.000Z' };

const preview: Preview = {
  fileType: 'csv',
  sheets: ['CSV'],
  sheetName: null,
  headerRow: 1,
  headers: ['Item Code', 'Name', 'RRP'],
  sampleRows: [
    { rowNumber: 2, values: ['MUG-1', 'Stoneware mug', '12.50'] },
    { rowNumber: 3, values: ['MUG-2', 'Enamel mug', 'abc'] },
  ],
  totalDataRows: 2,
  skippedEmptyRows: 0,
  maxRows: 2000,
  exceedsRowLimit: false,
  suggestedMapping: { sku: 0, title: 1, price: 2 },
  notices: [],
};

const validatedJob = makeJob({
  status: 'ready',
  file: uploadedFile,
  importConfig: { sheetName: null, headerRow: 1, mapping: { sku: 0, title: 1, price: 2 }, headers: preview.headers },
  counts: { totalRows: 2, validRows: 1, warningRows: 0, failedRows: 1, skippedEmptyRows: 0 },
  issueSummary: [{ field: 'price', type: 'invalid', severity: 'error', count: 1, example: 'Price “abc” is not a valid number.' }],
  updatedAt: '2026-10-18T10:05:00.000Z',
});

const rows = {
  items: [
    { id: 'r1', rowNumber: 2, sourceIdentifier: 'MUG-1', status: 'valid', original: { sku: 'MUG-1', title: 'Stoneware mug', price: '12.50' }, issues: [], suggestions: [], enrichment: null },
    {
      id: 'r2',
      rowNumber: 3,
      sourceIdentifier: 'MUG-2',
      status: 'error',
      original: { sku: 'MUG-2', title: 'Enamel mug', price: 'abc' },
      issues: [{ field: 'price', type: 'invalid', severity: 'error', message: 'Price “abc” is not a valid number.' }],
      suggestions: [],
      enrichment: null,
    },
  ],
  pagination: { page: 1, pageSize: 25, totalItems: 2, totalPages: 1 },
};
const errorRows = { items: [rows.items[1]], pagination: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 } };

describe('starting an import from a client', () => {
  it('creates a job and opens it on the upload step', async () => {
    let created: unknown;
    mockApi({
      'GET /me': session(),
      [`GET /clients/${CLIENT_ID}`]: () =>
        ok({ id: CLIENT_ID, name: 'Kitchen Co', internalReference: null, brandProfile: DEFAULT_BRAND_PROFILE, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' }),
      [`GET /jobs?page=1&pageSize=10&clientId=${CLIENT_ID}`]: () => ok({ items: [], pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 0 } }),
      'POST /jobs': (body) => {
        created = body;
        return ok(makeJob(), 201);
      },
      [`GET /jobs/${JOB_ID}`]: () => ok(makeJob()),
    });
    const { router } = renderRoute(`/clients/${CLIENT_ID}`);

    expect(await screen.findByText('No imports yet. Start one with “New import”.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'New import' }));

    expect(await screen.findByRole('heading', { name: 'Upload a catalogue file' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/jobs/${JOB_ID}`);
    expect(created).toEqual({ clientId: CLIENT_ID });
  });

  it('shows the plan limit message when no more jobs are allowed', async () => {
    mockApi({
      'GET /me': session(),
      [`GET /clients/${CLIENT_ID}`]: () =>
        ok({ id: CLIENT_ID, name: 'Kitchen Co', internalReference: null, brandProfile: DEFAULT_BRAND_PROFILE, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' }),
      [`GET /jobs?page=1&pageSize=10&clientId=${CLIENT_ID}`]: () => ok({ items: [], pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 0 } }),
      'POST /jobs': () => fail(403, 'PLAN_LIMIT_REACHED', 'Your plan allows 1 active job at a time.'),
    });
    renderRoute(`/clients/${CLIENT_ID}`);

    await userEvent.click(await screen.findByRole('button', { name: 'New import' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your plan allows 1 active job at a time.');
  });
});

describe('upload step', () => {
  it('rejects unsupported files in the browser without uploading', async () => {
    const { fetchMock } = mockApi({ 'GET /me': session(), [`GET /jobs/${JOB_ID}`]: () => ok(makeJob()) });
    renderRoute(`/jobs/${JOB_ID}`);

    const input = await screen.findByLabelText('Catalogue file');
    await userEvent.upload(input, new File(['hello'], 'notes.txt', { type: 'text/plain' }), { applyAccept: false });

    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a .csv or .xlsx file.');
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/upload'))).toBe(false);
  });

  it('uploads the file as multipart form data and moves on to mapping', async () => {
    let uploaded: File | undefined;
    mockApi({
      'GET /me': session(),
      [`GET /jobs/${JOB_ID}`]: () => ok(makeJob()),
      [`POST /jobs/${JOB_ID}/upload`]: (body) => {
        uploaded = (body as FormData).get('file') as File;
        return ok(makeJob({ status: 'uploaded', file: uploadedFile, updatedAt: '2026-10-18T10:01:00.000Z' }));
      },
      [`POST /jobs/${JOB_ID}/preview`]: () => ok(preview),
    });
    renderRoute(`/jobs/${JOB_ID}`);

    const input = await screen.findByLabelText('Catalogue file');
    await userEvent.upload(input, new File(['SKU,Name\nA,B'], 'products.csv', { type: 'text/csv' }));

    expect(await screen.findByRole('heading', { name: 'Map columns' })).toBeInTheDocument();
    expect(uploaded?.name).toBe('products.csv');
  });

  it('shows server errors for invalid files', async () => {
    mockApi({
      'GET /me': session(),
      [`GET /jobs/${JOB_ID}`]: () => ok(makeJob()),
      [`POST /jobs/${JOB_ID}/upload`]: () => fail(422, 'INVALID_FILE', 'This file has an .xlsx name but is not a valid Excel workbook.'),
    });
    renderRoute(`/jobs/${JOB_ID}`);

    await userEvent.upload(await screen.findByLabelText('Catalogue file'), new File(['x'], 'fake.xlsx'));
    expect(await screen.findByRole('alert')).toHaveTextContent('not a valid Excel workbook');
  });
});

describe('mapping step', () => {
  const uploadedJob = makeJob({ status: 'uploaded', file: uploadedFile });

  it('pre-fills suggestions, previews rows, then saves the mapping and validates', async () => {
    let savedMapping: unknown;
    let validated = false;
    mockApi({
      'GET /me': session(),
      [`GET /jobs/${JOB_ID}`]: () => ok(validated ? validatedJob : uploadedJob),
      [`POST /jobs/${JOB_ID}/preview`]: () => ok(preview),
      [`PUT /jobs/${JOB_ID}/mapping`]: (body) => {
        savedMapping = body;
        return ok({ ...uploadedJob, importConfig: validatedJob.importConfig, updatedAt: '2026-10-18T10:04:00.000Z' });
      },
      [`POST /jobs/${JOB_ID}/validate`]: () => {
        validated = true;
        return ok(validatedJob);
      },
      [`GET /jobs/${JOB_ID}/rows?page=1&pageSize=25`]: () => ok(rows),
    });
    renderRoute(`/jobs/${JOB_ID}`);

    expect(await screen.findByLabelText('SKU')).toHaveValue('0');
    expect(screen.getByLabelText('Title')).toHaveValue('1');
    expect(screen.getByLabelText('Price')).toHaveValue('2');
    expect(screen.getByText('e.g. Stoneware mug')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Enamel mug' })).toBeInTheDocument();

    // Map the brand column manually: there isn't one, so map RRP to nothing and back.
    await userEvent.selectOptions(screen.getByLabelText('Price'), '');
    await userEvent.selectOptions(screen.getByLabelText('Price'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Save mapping and validate' }));

    expect(await screen.findByRole('heading', { name: 'Issues found' })).toBeInTheDocument();
    expect(savedMapping).toEqual({ sheetName: null, headerRow: 1, mapping: { sku: 0, title: 1, price: 2 } });
  });

  it('blocks validation until an identifier is mapped, and flags reused columns', async () => {
    mockApi({
      'GET /me': session(),
      [`GET /jobs/${JOB_ID}`]: () => ok(uploadedJob),
      [`POST /jobs/${JOB_ID}/preview`]: () => ok(preview),
    });
    renderRoute(`/jobs/${JOB_ID}`);

    await userEvent.selectOptions(await screen.findByLabelText('SKU'), '');
    expect(screen.getByText('Map a SKU or Product ID column so every product can be identified.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save mapping and validate' })).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText('SKU'), '0');
    await userEvent.selectOptions(screen.getByLabelText('Brand'), '1');
    expect(screen.getByText('Column “Name” is mapped to Title and Brand.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save mapping and validate' })).toBeDisabled();
  });

  it('warns when the sheet is over the row limit', async () => {
    mockApi({
      'GET /me': session(),
      [`GET /jobs/${JOB_ID}`]: () => ok(uploadedJob),
      [`POST /jobs/${JOB_ID}/preview`]: () => ok({ ...preview, exceedsRowLimit: true }),
    });
    renderRoute(`/jobs/${JOB_ID}`);

    expect(await screen.findByText(/more than 2,000 product rows/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save mapping and validate' })).toBeDisabled();
  });
});

describe('validation report', () => {
  it('summarizes results and filters rows on the server', async () => {
    const { fetchMock } = mockApi({
      'GET /me': session(),
      [`GET /jobs/${JOB_ID}`]: () => ok(validatedJob),
      [`GET /jobs/${JOB_ID}/rows?page=1&pageSize=25`]: () => ok(rows),
      [`GET /jobs/${JOB_ID}/rows?page=1&pageSize=25&status=error`]: () => ok(errorRows),
      [`GET /jobs/${JOB_ID}/rows?page=1&pageSize=25&field=price`]: () => ok(errorRows),
    });
    renderRoute(`/jobs/${JOB_ID}`);

    expect(await screen.findByText('Product rows')).toBeInTheDocument();
    expect(screen.getByText(/e\.g\. Price “abc” is not a valid number\./)).toBeInTheDocument();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('MUG-1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Errors' }));
    await waitFor(() => expect(within(screen.getByRole('table')).queryByText('MUG-1')).not.toBeInTheDocument());
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('status=error'))).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'All rows' }));
    await userEvent.click(screen.getByRole('button', { name: 'Show rows' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('field=price'))).toBe(true));
  });

  it('explains why a job failed and offers ways to fix it', async () => {
    mockApi({
      'GET /me': session(),
      [`GET /jobs/${JOB_ID}`]: () =>
        ok(makeJob({ status: 'failed', file: uploadedFile, importConfig: validatedJob.importConfig, lastError: 'This sheet has more than 2,000 product rows.' })),
    });
    renderRoute(`/jobs/${JOB_ID}`);

    expect(await screen.findByRole('alert')).toHaveTextContent('more than 2,000 product rows');
    expect(screen.getByRole('button', { name: 'Edit mapping' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Replace file' }));
    expect(screen.getByRole('heading', { name: 'Replace the file' })).toBeInTheDocument();
  });

  it('shows "not found" for unknown or other agencies’ jobs', async () => {
    mockApi({ 'GET /me': session(), [`GET /jobs/${JOB_ID}`]: () => fail(404, 'NOT_FOUND', 'Job not found.') });
    renderRoute(`/jobs/${JOB_ID}`);
    expect(await screen.findByRole('heading', { name: 'Job not found' })).toBeInTheDocument();
  });
});

describe('roles', () => {
  it('shows reviewers a read-only message instead of the upload form', async () => {
    mockApi({ 'GET /me': session('reviewer'), [`GET /jobs/${JOB_ID}`]: () => ok(makeJob()) });
    renderRoute(`/jobs/${JOB_ID}`);

    expect(await screen.findByText(/Owners, admins and editors can upload and map files/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Catalogue file')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete job' })).not.toBeInTheDocument();
  });
});

describe('jobs list', () => {
  it('lists jobs and filters by status', async () => {
    const { fetchMock } = mockApi({
      'GET /me': session(),
      'GET /jobs?page=1&pageSize=20': () =>
        ok({ items: [validatedJob], pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 } }),
      'GET /jobs?page=1&pageSize=20&status=failed': () => ok({ items: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } }),
    });
    renderRoute('/jobs');

    expect(await screen.findByRole('link', { name: 'Spring catalogue' })).toHaveAttribute('href', `/jobs/${JOB_ID}`);
    expect(within(screen.getByRole('table')).getByText('Validated')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'failed');
    expect(await screen.findByText('No jobs with this status')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('status=failed'))).toBe(true);
  });
});
