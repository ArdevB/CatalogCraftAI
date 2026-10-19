import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { describe, expect, it } from 'vitest';
import { buildExport, type ExportRowInput } from '../src/services/export/build-export.js';
import { neutralizeCell } from '../src/services/export/csv-safety.js';

describe('neutralizeCell (formula injection)', () => {
  it.each([
    ['=HYPERLINK("http://evil","Click")', `'=HYPERLINK("http://evil","Click")`],
    ['+cmd|" /C calc"!A0', `'+cmd|" /C calc"!A0`],
    ['-2+3', "'-2+3"],
    ['@SUM(A1:A2)', "'@SUM(A1:A2)"],
    ['\t=1+1', "'\t=1+1"],
  ])('neutralizes %j', (input, expected) => {
    expect(neutralizeCell(input)).toBe(expected);
  });

  it.each(['-3', '+12.50', '-1,234.5', 'Stoneware mug', '5001234000014', '', '12-pack'])('leaves %j unchanged', (value) => {
    expect(neutralizeCell(value)).toBe(value);
  });
});

describe('buildExport', () => {
  // Supplier columns: SKU | Name | Price | Notes(unmapped) | Description
  const headers = ['SKU', 'Name', 'Price', 'Notes', 'Description'];
  const mapping = { sku: 0, title: 1, price: 2, description: 4 };
  const row = (overrides: Partial<ExportRowInput>): ExportRowInput => ({
    rowNumber: 2,
    status: 'valid',
    sourceValues: [' 00123 ', 'mug', '12.50', 'internal note', 'A mug.'],
    suggestions: [],
    ...overrides,
  });
  const allFields = { fields: ['sku', 'title', 'price', 'description'] as const, includeUnmappedColumns: true, includeErrorRows: false };

  it('keeps the supplier column order and copies protected values exactly (untrimmed)', () => {
    const built = buildExport({ headers, mapping, rows: [row({})], options: { ...allFields, fields: [...allFields.fields] } });
    expect(built.header).toEqual(['SKU', 'Name', 'Price', 'Notes', 'Description']);
    expect(built.records).toEqual([[' 00123 ', 'mug', '12.50', 'internal note', 'A mug.']]);
    expect(built.changedCells).toBe(0);
  });

  it('uses only approved and edited suggestions — never pending, rejected or failed ones', () => {
    const built = buildExport({
      headers,
      mapping,
      rows: [
        row({
          suggestions: [
            { field: 'title', status: 'approved', value: 'Stoneware mug' },
            { field: 'description', status: 'edited', value: 'AI text', editedValue: 'Reviewer text' },
          ],
        }),
        row({
          rowNumber: 3,
          suggestions: [
            { field: 'title', status: 'pending', value: 'PENDING' },
            { field: 'description', status: 'rejected', value: 'REJECTED' },
          ],
        }),
        row({ rowNumber: 4, suggestions: [{ field: 'title', status: 'failed', value: 'FAILED' }] }),
      ],
      options: { ...allFields, fields: [...allFields.fields] },
    });
    expect(built.records.map((r) => [r[1], r[4]])).toEqual([
      ['Stoneware mug', 'Reviewer text'],
      ['mug', 'A mug.'],
      ['mug', 'A mug.'],
    ]);
    expect(built.changedCells).toBe(2);
    expect(JSON.stringify(built.records)).not.toMatch(/PENDING|REJECTED|FAILED|AI text/);
  });

  it('adds approved content fields the file did not have, but not empty protected ones', () => {
    const built = buildExport({
      headers,
      mapping,
      rows: [row({ suggestions: [{ field: 'seoTitle', status: 'approved', value: 'Mug | Shop' }] })],
      options: { fields: ['sku', 'seoTitle', 'barcode'], includeUnmappedColumns: false, includeErrorRows: false },
    });
    expect(built.header).toEqual(['SKU', 'SEO title']);
    expect(built.records).toEqual([[' 00123 ', 'Mug | Shop']]);
  });

  it('leaves out unmapped columns and error rows unless asked', () => {
    const rows = [row({}), row({ rowNumber: 3, status: 'error' })];
    const strict = buildExport({ headers, mapping, rows, options: { fields: ['sku'], includeUnmappedColumns: false, includeErrorRows: false } });
    expect(strict.header).toEqual(['SKU']);
    expect(strict.records).toHaveLength(1);

    const all = buildExport({ headers, mapping, rows, options: { fields: ['sku'], includeUnmappedColumns: true, includeErrorRows: true } });
    expect(all.header).toEqual(['SKU', 'Notes']);
    expect(all.records).toHaveLength(2);
  });

  it('neutralizes formulas in cells, approved text and headers', () => {
    const built = buildExport({
      headers: ['=SKU', 'Name'],
      mapping: { sku: 0, title: 1 },
      rows: [row({ sourceValues: ['A-1', '=cmd'], suggestions: [] }), row({ rowNumber: 3, sourceValues: ['A-2', 'x'], suggestions: [{ field: 'title', status: 'approved', value: '@evil' }] })],
      options: { fields: ['sku', 'title'], includeUnmappedColumns: false, includeErrorRows: false },
    });
    expect(built.header).toEqual(["'=SKU", 'Name']);
    expect(built.records).toEqual([
      ['A-1', "'=cmd"],
      ['A-2', "'@evil"],
    ]);
  });

  it('produces a CSV that round-trips quotes, commas and newlines', () => {
    const built = buildExport({
      headers,
      mapping,
      rows: [row({ sourceValues: ['A-1', 'Mug, "large"', '1', 'line one\nline two', 'Café £5'] })],
      options: { ...allFields, fields: [...allFields.fields] },
    });
    const csv = stringify([built.header, ...built.records], { bom: true });
    expect(csv.startsWith('﻿')).toBe(true);
    expect(parse(csv, { bom: true })).toEqual([built.header, ...built.records]);
  });
});
