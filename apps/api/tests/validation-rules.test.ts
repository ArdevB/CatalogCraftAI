import { describe, expect, it } from 'vitest';
import type { ProductValues } from '@catalogcraft/shared';
import { checkPrice, isHttpUrl, isValidGtin } from '../src/services/validation/field-rules.js';
import { summarizeIssues, validateRows } from '../src/services/validation/validate-rows.js';

const options = { maxTitleLength: 60 };

function validate(...rows: ProductValues[]) {
  return validateRows(
    rows.map((values, index) => ({ rowNumber: index + 2, values })),
    options,
  );
}

function issueKeys(result: ReturnType<typeof validate>[number]) {
  return result.issues.map((issue) => `${issue.severity}:${issue.field}:${issue.type}`);
}

describe('checkPrice', () => {
  it.each([
    ['12', 'valid'],
    ['12.50', 'valid'],
    ['1,234.50', 'valid'],
    ['-5', 'negative'],
    ['$12.99', 'currency-symbol'],
    ['12.99 USD', 'currency-symbol'],
    ['12,50', 'ambiguous'],
    ['1.234,56', 'ambiguous'],
    ['abc', 'invalid'],
    ['12.5.1', 'invalid'],
  ] as const)('%s → %s', (input, expected) => {
    expect(checkPrice(input)).toBe(expected);
  });
});

describe('isValidGtin', () => {
  it.each([
    ['4006381333931', true], // EAN-13
    ['036000291452', true], // UPC-A
    ['96385074', true], // EAN-8
    ['4006381333932', false], // wrong check digit
    ['36000291452', false], // UPC with leading zero lost
    ['ABC', false],
  ])('%s → %s', (input, expected) => {
    expect(isValidGtin(input)).toBe(expected);
  });
});

describe('isHttpUrl', () => {
  it('accepts http(s) links only', () => {
    expect(isHttpUrl('https://img.example.com/a.jpg')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('img/a.jpg')).toBe(false);
  });
});

describe('validateRows', () => {
  it('passes a clean row', () => {
    const [result] = validate({ sku: 'A-1', title: 'Mug', description: 'Nice', price: '9.99', currency: 'USD' });
    expect(result).toMatchObject({ status: 'valid', issues: [], sourceIdentifier: 'A-1' });
  });

  it('errors when a product cannot be identified', () => {
    const [result] = validate({ sku: '', productId: '', title: 'Mug' });
    expect(result?.status).toBe('error');
    expect(issueKeys(result!)).toContain('error:sku:missing');
    expect(result?.sourceIdentifier).toBeNull();
  });

  it('falls back to the product ID when the SKU is empty', () => {
    const [result] = validate({ sku: '', productId: 'P-9' });
    expect(result).toMatchObject({ status: 'warning', sourceIdentifier: 'P-9' });
  });

  it('flags every row of a duplicate SKU, ignoring case', () => {
    const results = validate({ sku: 'A-1' }, { sku: 'a-1' }, { sku: 'B-1' });
    expect(results.map((r) => r.status)).toEqual(['error', 'error', 'valid']);
    expect(results[0]?.issues[0]?.message).toMatch(/appears in 2 rows \(2, 3\)/);
  });

  it('allows shared product IDs when SKUs identify variants', () => {
    const results = validate({ sku: 'A-S', productId: 'P' }, { sku: 'A-M', productId: 'P' });
    expect(results.every((r) => r.status === 'valid')).toBe(true);
  });

  it('checks prices, currencies, stock, barcodes and image links', () => {
    const [result] = validate({
      sku: 'A-1',
      price: 'abc',
      currency: '$',
      stockQuantity: '1.5',
      barcode: '123',
      imageUrl: 'not a url',
    });
    expect(issueKeys(result!)).toEqual([
      'error:price:invalid',
      'warning:currency:invalid',
      'warning:stockQuantity:invalid',
      'warning:barcode:invalid',
      'warning:imageUrl:invalid',
    ]);
  });

  it('warns about missing and over-long titles using the client limit', () => {
    const [empty, long] = validate({ sku: 'A', title: '' }, { sku: 'B', title: 'x'.repeat(61) });
    expect(issueKeys(empty!)).toEqual(['warning:title:missing']);
    expect(long?.issues[0]?.message).toMatch(/61 characters; this client’s limit is 60/);
  });

  it('notes empty descriptions without failing the row', () => {
    const [result] = validate({ sku: 'A', description: '' });
    expect(result).toMatchObject({ status: 'valid' });
    expect(issueKeys(result!)).toEqual(['info:description:missing']);
  });

  it('checks variant relationships', () => {
    const results = validate(
      { sku: 'PARENT', parentId: '' },
      { sku: 'CHILD-1', parentId: 'PARENT', variantId: 'V1' },
      { sku: 'CHILD-2', parentId: 'MISSING', variantId: 'V1' },
      { sku: 'SELF', parentId: 'self' },
    );
    expect(results[1]?.issues.map((i) => i.type)).toEqual(['duplicate']);
    expect(issueKeys(results[2]!)).toEqual(['error:variantId:duplicate', 'warning:parentId:inconsistent']);
    expect(results[3]?.issues[0]?.message).toMatch(/its own parent/);
  });

  it('flags exact duplicate rows after the first', () => {
    const results = validate({ productId: 'X', title: 'Same' }, { productId: 'Y' }, { productId: 'X', title: 'Same' });
    expect(results[2]?.issues.find((i) => i.field === 'row')?.message).toBe('This row is an exact duplicate of row 2.');
  });

  it('summarizes issues by severity, then frequency', () => {
    const summary = summarizeIssues(validate({ sku: 'A', title: '' }, { sku: 'A', title: '' }, { sku: 'B', price: 'x' }));
    expect(summary.map((s) => `${s.severity}:${s.field}:${s.type}:${s.count}`)).toEqual([
      'error:sku:duplicate:2',
      'error:price:invalid:1',
      'warning:title:missing:2',
      // Rows 2 and 3 are identical, so row 3 is also reported as a duplicate row.
      'warning:row:duplicate:1',
    ]);
  });
});
