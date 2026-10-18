import { describe, expect, it } from 'vitest';
import { clientListQuerySchema, createClientSchema, DEFAULT_BRAND_PROFILE, updateClientSchema } from '../src/index.js';

describe('createClientSchema', () => {
  it('fills in the default brand profile when it is omitted', () => {
    expect(createClientSchema.parse({ name: '  Northwind  ' })).toEqual({
      name: 'Northwind',
      brandProfile: DEFAULT_BRAND_PROFILE,
    });
  });

  it('fills in defaults for brand profile fields that are left out', () => {
    const parsed = createClientSchema.parse({ name: 'N', brandProfile: { brandTone: ' Warm ', maxTitleLength: 80 } });
    expect(parsed.brandProfile).toEqual({ ...DEFAULT_BRAND_PROFILE, brandTone: 'Warm', maxTitleLength: 80 });
  });

  it.each([
    ['empty name', { name: '' }],
    ['unsupported language', { name: 'N', brandProfile: { defaultLanguage: 'klingon' } }],
    ['title length too small', { name: 'N', brandProfile: { maxTitleLength: 5 } }],
    ['fractional title length', { name: 'N', brandProfile: { maxTitleLength: 80.5 } }],
    ['empty prohibited claim', { name: 'N', brandProfile: { prohibitedClaims: ['  '] } }],
    ['too many terms', { name: 'N', brandProfile: { preferredTerminology: Array(51).fill('term') } }],
  ])('rejects %s', (_label, input) => {
    expect(createClientSchema.safeParse(input).success).toBe(false);
  });
});

describe('updateClientSchema', () => {
  it('accepts a partial brand profile without adding defaults', () => {
    expect(updateClientSchema.parse({ brandProfile: { brandTone: 'Playful' } })).toEqual({
      brandProfile: { brandTone: 'Playful' },
    });
  });

  it('allows clearing the internal reference', () => {
    expect(updateClientSchema.parse({ internalReference: null })).toEqual({ internalReference: null });
  });

  it('rejects an empty update', () => {
    expect(updateClientSchema.safeParse({}).success).toBe(false);
  });
});

describe('clientListQuerySchema', () => {
  it('combines pagination with an optional trimmed search', () => {
    expect(clientListQuerySchema.parse({ page: '2', search: ' north ' })).toEqual({
      page: 2,
      pageSize: 25,
      search: 'north',
    });
  });
});
