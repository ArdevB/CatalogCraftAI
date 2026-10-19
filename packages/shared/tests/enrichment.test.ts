import { describe, expect, it } from 'vitest';
import {
  canTransition,
  ENRICHABLE_FIELD_KEYS,
  ENRICHABLE_FIELDS,
  isProtectedField,
  startEnrichmentSchema,
} from '../src/index.js';

describe('enrichable fields', () => {
  it('match the fields flagged as enrichable in STANDARD_FIELDS', () => {
    expect([...ENRICHABLE_FIELD_KEYS].sort()).toEqual([...ENRICHABLE_FIELDS].sort());
  });

  it('never include a protected field', () => {
    for (const field of ENRICHABLE_FIELD_KEYS) expect(isProtectedField(field), field).toBe(false);
  });
});

describe('startEnrichmentSchema', () => {
  it('applies defaults and removes repeated fields', () => {
    expect(startEnrichmentSchema.parse({ fields: ['title', 'title', 'description'] })).toEqual({
      fields: ['title', 'description'],
      includeWarningRows: true,
    });
  });

  it.each([
    ['no fields', { fields: [] }],
    ['a protected field', { fields: ['price'] }],
    ['an identifier', { fields: ['sku'] }],
    ['an unsupported language', { fields: ['title'], language: 'xx' }],
  ])('rejects %s', (_label, input) => {
    expect(startEnrichmentSchema.safeParse(input).success).toBe(false);
  });
});

describe('enrichment lifecycle', () => {
  it.each([
    ['ready', 'queued'],
    ['queued', 'processing'],
    ['queued', 'ready'], // cancelled before starting
    ['processing', 'review'],
    ['processing', 'ready'], // cancelled before anything succeeded
    ['review', 'queued'], // enrich more fields later
    ['failed', 'queued'], // retry after the AI service was down
  ] as const)('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ['uploaded', 'queued'],
    ['draft', 'queued'],
    ['processing', 'processing'],
    ['review', 'processing'],
  ] as const)('rejects %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });
});
