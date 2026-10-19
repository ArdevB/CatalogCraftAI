import { describe, expect, it } from 'vitest';
import {
  canTransition,
  ENRICHABLE_FIELDS,
  isProtectedField,
  JOB_STATUSES,
  JOB_TRANSITIONS,
  saveMappingSchema,
  statusesThatCanBecome,
} from '../src/index.js';

describe('job state transitions', () => {
  it.each([
    ['draft', 'uploaded'],
    ['uploaded', 'validating'],
    ['validating', 'ready'],
    ['validating', 'failed'],
    ['ready', 'uploaded'],
    ['failed', 'validating'],
    ['review', 'exporting'],
    ['review', 'queued'],
  ] as const)('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ['draft', 'validating'],
    ['draft', 'completed'],
    ['uploaded', 'ready'],
    ['validating', 'uploaded'],
    ['completed', 'draft'],
    ['processing', 'completed'],
  ] as const)('rejects %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('only references real statuses and lets every status except draft be reached', () => {
    const targets = new Set(Object.values(JOB_TRANSITIONS).flat());
    for (const status of JOB_STATUSES) {
      expect(JOB_STATUSES).toContain(status);
      if (status !== 'draft') expect(targets.has(status), status).toBe(true);
    }
  });

  it('lists the statuses a job may be validated from', () => {
    expect(statusesThatCanBecome('validating').sort()).toEqual(['failed', 'ready', 'uploaded']);
  });
});

describe('protected fields', () => {
  it('protects identifiers, prices, stock and measurements', () => {
    for (const field of ['sku', 'productId', 'price', 'currency', 'stockQuantity', 'barcode', 'dimensions', 'weight', 'variantId', 'parentId', 'imageUrl']) {
      expect(isProtectedField(field), field).toBe(true);
    }
  });

  it('never lets a protected field be enrichable', () => {
    for (const field of ENRICHABLE_FIELDS) expect(isProtectedField(field), field).toBe(false);
  });
});

describe('saveMappingSchema', () => {
  it('accepts a mapping of standard fields to column indexes', () => {
    expect(
      saveMappingSchema.parse({ sheetName: null, headerRow: '2', mapping: { sku: 0, title: 3 } }),
    ).toEqual({ sheetName: null, headerRow: 2, mapping: { sku: 0, title: 3 } });
  });

  it('rejects unknown fields and negative columns', () => {
    expect(saveMappingSchema.safeParse({ sheetName: null, headerRow: 1, mapping: { colour: -1 } }).success).toBe(false);
    expect(saveMappingSchema.safeParse({ sheetName: null, headerRow: 1, mapping: { flavour: 1 } }).success).toBe(false);
  });
});
