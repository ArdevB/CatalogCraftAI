import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { CatalogRow, ExportRecord, Job, ReviewSummary, Role, Suggestion } from '@catalogcraft/shared';
import { fail, mockApi, ok, renderRoute, sessionInfo } from './utils';

const JOB_ID = 'a'.repeat(24);
const ROW_ID = 'b'.repeat(24);
const session = (role: Role = 'owner') => () => ok(sessionInfo(role));

const summary = (overrides: Partial<ReviewSummary> = {}): ReviewSummary => ({
  pending: 2,
  approved: 0,
  edited: 0,
  rejected: 0,
  failed: 1,
  eligibleForBulkApproval: 1,
  ...overrides,
});

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: JOB_ID,
    name: 'Spring catalogue',
    status: 'review',
    client: { id: 'c'.repeat(24), name: 'Kitchen Co' },
    createdBy: { id: 'u1', name: 'Ada Lovelace' },
    file: { filename: 'p.csv', fileType: 'csv', sizeBytes: 900, sheets: ['CSV'], uploadedAt: '2026-10-18T10:00:00.000Z' },
    importConfig: { sheetName: null, headerRow: 1, mapping: { sku: 0, title: 1, price: 2 }, headers: ['SKU', 'Name', 'Price'] },
    counts: { totalRows: 3, validRows: 2, warningRows: 0, failedRows: 1, skippedEmptyRows: 0 },
    issueSummary: [],
    lastError: null,
    enrichment: {
      fields: ['title', 'description'],
      language: 'en',
      includeWarningRows: true,
      model: 'claude-opus-5-5',
      promptVersion: 'product-enrichment@1',
      totalRows: 2,
      processedRows: 2,
      succeededRows: 2,
      failedRows: 0,
      cancelRequested: false,
      startedAt: '2026-10-18T10:05:00.000Z',
      finishedAt: '2026-10-18T10:06:00.000Z',
    },
    review: summary(),
    createdAt: '2026-10-18T10:00:00.000Z',
    updatedAt: '2026-10-18T10:06:00.000Z',
    ...overrides,
  };
}

const suggestion = (overrides: Partial<Suggestion>): Suggestion => ({
  field: 'title',
  value: 'Blue stoneware mug',
  status: 'pending',
  warnings: [],
  model: 'claude-opus-5-5',
  promptVersion: 'product-enrichment@1',
  generatedAt: '2026-10-18T10:06:00.000Z',
  editedValue: null,
  reviewedAt: null,
  ...overrides,
});

function makeRow(suggestions: Suggestion[]): CatalogRow {
  return {
    id: ROW_ID,
    rowNumber: 2,
    sourceIdentifier: 'MUG-1',
    status: 'valid',
    original: { sku: 'MUG-1', title: 'mug blue', description: 'A mug.' },
    issues: [],
    suggestions,
    enrichment: { status: 'done', error: null, missingFacts: [], notes: [] },
  };
}

const page = (items: CatalogRow[]) => ok({ items, pagination: { page: 1, pageSize: 25, totalItems: items.length, totalPages: 1 } });
const exportRecord: ExportRecord = {
  id: 'e'.repeat(24),
  jobId: JOB_ID,
  filename: 'kitchen-co-spring-catalogue-202610181010.csv',
  rowCount: 2,
  columnCount: 3,
  changedCells: 1,
  sizeBytes: 120,
  createdBy: { id: 'u1', name: 'Ada Lovelace' },
  createdAt: '2026-10-18T10:10:00.000Z',
  downloadCount: 0,
};

function reviewApi(row: CatalogRow, extra: Record<string, (body: unknown) => Response> = {}, role: Role = 'owner') {
  return mockApi({
    'GET /me': session(role),
    [`GET /jobs/${JOB_ID}`]: () => ok(makeJob()),
    [`GET /jobs/${JOB_ID}/rows?page=1&pageSize=25&suggestion=pending`]: () => page([row]),
    [`GET /jobs/${JOB_ID}/rows?page=1&pageSize=25`]: () => page([]),
    [`GET /jobs/${JOB_ID}/exports`]: () => ok([]),
    [`GET /jobs/${JOB_ID}/activity`]: () => ok([]),
    'GET /ai/status': () => ok({ configured: true, model: 'claude-opus-5-5' }),
    ...extra,
  });
}

describe('reviewing suggestions', () => {
  it('approves a suggestion', async () => {
    let sent: unknown;
    const row = makeRow([suggestion({})]);
    reviewApi(row, {
      [`PATCH /jobs/${JOB_ID}/rows/${ROW_ID}`]: (body) => {
        sent = body;
        return ok(makeRow([suggestion({ status: 'approved' })]));
      },
    });
    renderRoute(`/jobs/${JOB_ID}`);

    expect(await screen.findByText('Blue stoneware mug')).toBeInTheDocument();
    expect(screen.getByText('mug blue')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve Title for MUG-1' }));
    await waitFor(() => expect(sent).toEqual({ field: 'title', action: 'approve' }));
  });

  it('edits a suggestion with the reviewer’s own text and shows brand-rule errors', async () => {
    const sent: unknown[] = [];
    reviewApi(makeRow([suggestion({})]), {
      [`PATCH /jobs/${JOB_ID}/rows/${ROW_ID}`]: (body) => {
        sent.push(body);
        return sent.length === 1
          ? fail(400, 'VALIDATION_ERROR', '“eco-friendly” is a prohibited claim for this client.')
          : ok(makeRow([suggestion({ status: 'edited', editedValue: 'Hand-glazed mug' })]));
      },
    });
    renderRoute(`/jobs/${JOB_ID}`);

    await userEvent.click(await screen.findByRole('button', { name: 'Edit Title for MUG-1' }));
    const box = screen.getByRole('textbox', { name: 'Edit Title' });
    await userEvent.clear(box);
    await userEvent.type(box, 'Eco-friendly mug');
    await userEvent.click(screen.getByRole('button', { name: 'Save & use this' }));
    expect(await screen.findByText('“eco-friendly” is a prohibited claim for this client.')).toBeInTheDocument();

    await userEvent.clear(box);
    await userEvent.type(box, 'Hand-glazed mug');
    await userEvent.click(screen.getByRole('button', { name: 'Save & use this' }));
    await waitFor(() => expect(sent[1]).toEqual({ field: 'title', action: 'edit', value: 'Hand-glazed mug' }));
  });

  it('shows warnings and never offers "Approve" for blocked suggestions', async () => {
    reviewApi(
      makeRow([
        suggestion({ warnings: ["Mentions “500”, which doesn't appear in the product data. Check before approving."] }),
        suggestion({ field: 'description', value: 'An eco-friendly mug.', status: 'failed', warnings: ['Uses the prohibited claim “eco-friendly”.'] }),
      ]),
    );
    renderRoute(`/jobs/${JOB_ID}`);

    expect(await screen.findByText(/Mentions “500”/)).toBeInTheDocument();
    expect(screen.getByText('Uses the prohibited claim “eco-friendly”.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve Title for MUG-1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve Description for MUG-1' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Description for MUG-1' })).toBeInTheDocument();
  });

  it('bulk-approves eligible suggestions and selected rows', async () => {
    const sent: unknown[] = [];
    reviewApi(makeRow([suggestion({})]), {
      [`POST /jobs/${JOB_ID}/approve`]: (body) => {
        sent.push(body);
        return ok({ updated: 1 });
      },
    });
    renderRoute(`/jobs/${JOB_ID}`);

    await userEvent.click(await screen.findByRole('button', { name: 'Approve all without warnings (1)' }));
    expect(await screen.findByText('1 suggestion updated.')).toBeInTheDocument();
    expect(screen.getByText('Suggestions with warnings must be approved one by one.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select MUG-1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Approve selected (1)' }));
    await waitFor(() => expect(sent).toEqual([{}, { rowIds: [ROW_ID] }]));
  });

  it('is read-only for editors', async () => {
    reviewApi(makeRow([suggestion({})]), {}, 'editor');
    renderRoute(`/jobs/${JOB_ID}`);

    expect(await screen.findByText('Blue stoneware mug')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Approve (Title|all|selected)/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Title for MUG-1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Select MUG-1' })).not.toBeInTheDocument();
  });
});

describe('export', () => {
  it('creates an export with the chosen fields and offers the download', async () => {
    let sent: unknown;
    reviewApi(makeRow([]), {
      [`POST /jobs/${JOB_ID}/export`]: (body) => {
        sent = body;
        return ok(exportRecord, 201);
      },
    });
    renderRoute(`/jobs/${JOB_ID}`);

    expect(await screen.findByText('2 suggestions are still pending and won’t be included until approved.')).toBeInTheDocument();
    const fields = screen.getByRole('group', { name: 'Fields' });
    // Mapped fields (SKU, Title, Price) plus Description, which has suggestions.
    expect(within(fields).getAllByRole('checkbox')).toHaveLength(4);
    await userEvent.click(within(fields).getByRole('checkbox', { name: 'Price' }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Include rows with validation errors/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Create export' }));

    const link = await screen.findByRole('link', { name: `Download ${exportRecord.filename}` });
    expect(link).toHaveAttribute('href', `/api/v1/exports/${exportRecord.id}/download`);
    expect(sent).toEqual({ fields: ['sku', 'title', 'description'], includeUnmappedColumns: true, includeErrorRows: true });
  });

  it('lists previous exports with download links', async () => {
    reviewApi(makeRow([]), { [`GET /jobs/${JOB_ID}/exports`]: () => ok([{ ...exportRecord, downloadCount: 3 }]) });
    renderRoute(`/jobs/${JOB_ID}`);

    const link = await screen.findByRole('link', { name: `Download ${exportRecord.filename}` });
    expect(link).toHaveAttribute('href', `/api/v1/exports/${exportRecord.id}/download`);
  });

  it('shows export errors', async () => {
    reviewApi(makeRow([]), { [`POST /jobs/${JOB_ID}/export`]: () => fail(409, 'CONFLICT', 'There are no rows to export with these options.') });
    renderRoute(`/jobs/${JOB_ID}`);

    await userEvent.click(await screen.findByRole('button', { name: 'Create export' }));
    expect(await screen.findByText('There are no rows to export with these options.')).toBeInTheDocument();
  });
});

describe('activity', () => {
  it('shows who did what for owners', async () => {
    reviewApi(makeRow([]), {
      [`GET /jobs/${JOB_ID}/activity`]: () =>
        ok([
          { id: '1', action: 'suggestions.bulk_approved', actor: { id: 'u1', name: 'Ada Lovelace' }, rowNumber: null, field: null, count: 12, createdAt: '2026-10-18T10:09:00.000Z' },
          { id: '2', action: 'suggestion.edited', actor: { id: 'u2', name: 'Grace Hopper' }, rowNumber: 4, field: 'seoTitle', count: null, createdAt: '2026-10-18T10:08:00.000Z' },
        ]),
    });
    renderRoute(`/jobs/${JOB_ID}`);

    expect(await screen.findByText('bulk-approved 12 suggestions')).toBeInTheDocument();
    expect(screen.getByText('edited the seo title on row 4')).toBeInTheDocument();
  });
});
