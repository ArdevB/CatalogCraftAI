import { describe, expect, it } from 'vitest';
import { bulkReviewSchema, canTransition, exportRequestSchema, hasPermission, reviewActionSchema } from '../src/index.js';

describe('reviewActionSchema', () => {
  it('accepts approve/reject/reset without a value and edit with one', () => {
    expect(reviewActionSchema.parse({ field: 'title', action: 'approve' })).toEqual({ field: 'title', action: 'approve' });
    expect(reviewActionSchema.parse({ field: 'title', action: 'edit', value: '  Better title ' })).toEqual({
      field: 'title',
      action: 'edit',
      value: 'Better title',
    });
  });

  it.each([
    ['an edit without text', { field: 'title', action: 'edit' }],
    ['an edit with only spaces', { field: 'title', action: 'edit', value: '   ' }],
    ['a protected field', { field: 'price', action: 'approve' }],
    ['an unknown action', { field: 'title', action: 'publish' }],
  ])('rejects %s', (_label, input) => {
    expect(reviewActionSchema.safeParse(input).success).toBe(false);
  });
});

describe('bulkReviewSchema', () => {
  it('limits selections and only allows content fields', () => {
    expect(bulkReviewSchema.safeParse({}).success).toBe(true);
    expect(bulkReviewSchema.safeParse({ rowIds: Array(501).fill('64b7f0c2a1b2c3d4e5f60718') }).success).toBe(false);
    expect(bulkReviewSchema.safeParse({ fields: ['sku'] }).success).toBe(false);
  });
});

describe('exportRequestSchema', () => {
  it('defaults to keeping unmapped columns and leaving out error rows', () => {
    expect(exportRequestSchema.parse({ fields: ['sku', 'title'] })).toEqual({
      fields: ['sku', 'title'],
      includeUnmappedColumns: true,
      includeErrorRows: false,
    });
    expect(exportRequestSchema.safeParse({ fields: [] }).success).toBe(false);
  });
});

describe('review and export lifecycle', () => {
  it.each([
    ['ready', 'exporting'],
    ['review', 'exporting'],
    ['exporting', 'completed'],
    ['exporting', 'review'], // export failed → back to review
    ['completed', 'exporting'], // export again
    ['completed', 'queued'], // more suggestions later
  ] as const)('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it('rejects exporting a job that was never validated', () => {
    expect(canTransition('uploaded', 'exporting')).toBe(false);
    expect(canTransition('processing', 'exporting')).toBe(false);
  });

  it('lets reviewers review and export, but not editors review', () => {
    expect(hasPermission('reviewer', 'suggestions:review')).toBe(true);
    expect(hasPermission('editor', 'suggestions:review')).toBe(false);
    expect(hasPermission('reviewer', 'exports:create')).toBe(true);
    expect(hasPermission('editor', 'audit:read')).toBe(false);
  });
});
