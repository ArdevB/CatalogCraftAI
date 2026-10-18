import { describe, expect, it } from 'vitest';
import { assertValidMapping, extractValues, suggestMapping } from '../src/services/import/column-mapping.js';
import { cellToString, detectDelimiter, detectFileType, parseFile } from '../src/services/import/parse-file.js';
import { buildTable } from '../src/services/import/table.js';
import { inspectZip } from '../src/services/import/zip-guard.js';
import { AppError } from '../src/utils/app-error.js';
import { makeXlsx, SAMPLE_CSV } from './fixtures.js';

const csv = (text: string) => Buffer.from(text, 'utf8');

describe('detectFileType', () => {
  it('accepts CSV text and real XLSX workbooks', async () => {
    expect(detectFileType('products.CSV', csv(SAMPLE_CSV))).toBe('csv');
    expect(detectFileType('products.xlsx', await makeXlsx({ Sheet1: [['SKU']] }))).toBe('xlsx');
  });

  it.each([
    ['empty.csv', Buffer.alloc(0), /empty/],
    ['image.png', csv('x'), /Unsupported file type/],
    ['fake.xlsx', csv('SKU,Title'), /not a valid Excel workbook/],
    ['legacy.xls', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2]), /Older \.xls/],
    ['macro.xlsm', Buffer.from([0x50, 0x4b, 0x03, 0x04]), /Macro-enabled/],
    ['binary.csv', Buffer.from([0x41, 0x00, 0x42]), /binary data/],
  ])('rejects %s', (filename, data, message) => {
    expect(() => detectFileType(filename, data)).toThrow(message);
  });

  it('rejects a workbook renamed to .csv', async () => {
    expect(() => detectFileType('sneaky.csv', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0]))).toThrow(/actually a spreadsheet/);
  });
});

describe('CSV parsing', () => {
  it('detects the delimiter', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t');
    expect(detectDelimiter('"x,y";b;c')).toBe(';');
  });

  it('handles quotes, embedded newlines and a UTF-8 BOM', async () => {
    const text = '﻿SKU,Title\nA-1,"Mug, large"\nA-2,"Line one\nline two"';
    const parsed = await parseFile(csv(text), 'csv', { maxRows: 100 });
    expect(parsed.sheets[0]?.rows).toEqual([
      ['SKU', 'Title'],
      ['A-1', 'Mug, large'],
      ['A-2', 'Line one\nline two'],
    ]);
  });

  it('falls back to Windows-1252 with a notice for non-UTF-8 files', async () => {
    const latin1 = Buffer.from([0x53, 0x4b, 0x55, 0x0a, 0x43, 0x61, 0x66, 0xe9]); // "SKU\nCafé"
    const parsed = await parseFile(latin1, 'csv', { maxRows: 100 });
    expect(parsed.sheets[0]?.rows[1]).toEqual(['Café']);
    expect(parsed.notices[0]).toMatch(/Windows-1252/);
  });

  it('keeps formula-like text as plain text (nothing is evaluated)', async () => {
    const parsed = await parseFile(csv('SKU,Title\nA-1,=HYPERLINK("http://evil")'), 'csv', { maxRows: 10 });
    expect(parsed.sheets[0]?.rows[1]?.[1]).toBe('=HYPERLINK("http://evil")');
  });

  it('marks files that exceed the row limit', async () => {
    const parsed = await parseFile(csv(['SKU', 'a', 'b', 'c', 'd'].join('\n')), 'csv', { maxRows: 3 });
    expect(parsed.sheets[0]).toMatchObject({ truncated: true });
    expect(parsed.sheets[0]?.rows).toHaveLength(3);
  });

  it('reports malformed CSV clearly', async () => {
    await expect(parseFile(csv('SKU,Title\nA-1,"unclosed'), 'csv', { maxRows: 10 })).rejects.toThrow(
      /CSV file could not be read/,
    );
  });
});

describe('XLSX parsing', () => {
  it('reads every sheet, using cached formula results and readable dates', async () => {
    const file = await makeXlsx({
      Products: [
        ['SKU', 'Price', 'Total', 'Launched', 'Active'],
        ['A-1', 12.5, { formula: 'B2*2', result: 25 }, new Date(Date.UTC(2026, 0, 15)), true],
      ],
      Notes: [['Internal notes']],
    });
    const parsed = await parseFile(file, 'xlsx', { maxRows: 100 });

    expect(parsed.sheets.map((sheet) => sheet.name)).toEqual(['Products', 'Notes']);
    expect(parsed.sheets[0]?.rows[1]).toEqual(['A-1', '12.5', '25', '2026-01-15', 'TRUE']);
  });

  it('keeps blank rows so row numbers match Excel', async () => {
    const file = await makeXlsx({ Sheet1: [['SKU'], ['A-1'], [], ['A-3']] });
    const parsed = await parseFile(file, 'xlsx', { maxRows: 100 });
    expect(parsed.sheets[0]?.rows).toEqual([['SKU'], ['A-1'], [], ['A-3']]);
  });

  it('rejects a corrupted workbook', async () => {
    const corrupted = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('not really a zip')]);
    await expect(parseFile(corrupted, 'xlsx', { maxRows: 10 })).rejects.toBeInstanceOf(AppError);
  });

  it('refuses workbooks that would expand to a huge size (zip bomb)', async () => {
    const file = await makeXlsx({ Sheet1: [['SKU'], ['A-1']] });
    expect(inspectZip(file, { maxUncompressedBytes: 10_000_000, maxEntries: 100 })).toMatchObject({ ok: true });

    // Patch the first central-directory entry to claim ~2 GB of unpacked data.
    const bomb = Buffer.from(file);
    const directory = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bomb.writeUInt32LE(0x7fffffff, directory + 24);

    expect(inspectZip(bomb, { maxUncompressedBytes: 10_000_000, maxEntries: 100 })).toEqual({
      ok: false,
      reason: 'the workbook expands to too much data',
    });
    await expect(parseFile(bomb, 'xlsx', { maxRows: 10 })).rejects.toThrow(/expands to too much data/);
  });

  it('converts rich text, hyperlinks and error cells', () => {
    expect(cellToString({ richText: [{ text: 'Bold ' }, { text: 'mug' }] })).toBe('Bold mug');
    expect(cellToString({ text: 'Link', hyperlink: 'https://x.test' })).toBe('Link');
    expect(cellToString({ error: '#N/A' })).toBe('');
  });
});

describe('buildTable', () => {
  it('uses the chosen header row and names blank or repeated headers', () => {
    const table = buildTable(
      [['Supplier export 2026'], ['SKU', '', 'Price', 'price'], ['A-1', 'x', '1', '2', 'extra']],
      2,
    );
    expect(table.headers).toEqual(['SKU', 'Column 2', 'Price', 'price (2)', 'Column 5']);
    expect(table.rows).toEqual([{ rowNumber: 3, values: ['A-1', 'x', '1', '2', 'extra'] }]);
  });

  it('counts blank rows in the middle but ignores trailing ones', () => {
    const table = buildTable([['SKU'], ['A'], [''], ['B'], [''], ['']], 1);
    expect(table.rows.map((row) => row.rowNumber)).toEqual([2, 4]);
    expect(table.skippedEmptyRows).toBe(1);
  });

  it('rejects an empty or out-of-range header row', () => {
    expect(() => buildTable([['SKU']], 5)).toThrow(/past the end/);
    expect(() => buildTable([[''], ['SKU']], 1)).toThrow(/empty/);
  });
});

describe('column mapping', () => {
  it('suggests fields from common header spellings', () => {
    const mapping = suggestMapping(['Item SKU', 'Product Name', 'Colour', 'RRP', 'EAN-13', 'Qty', 'Mystery']);
    expect(mapping).toEqual({ sku: 0, title: 1, colour: 2, price: 3, barcode: 4, stockQuantity: 5 });
  });

  it('never suggests the same column twice', () => {
    expect(suggestMapping(['Name', 'Name (2)'])).toEqual({ title: 0 });
  });

  it('requires an identifier and rejects reused or missing columns', () => {
    const headers = ['SKU', 'Title'];
    expect(() => assertValidMapping({ title: 1 }, headers)).toThrow(/SKU or Product ID/);
    expect(() => assertValidMapping({ sku: 0, title: 0 }, headers)).toThrow(/mapped to both/);
    expect(() => assertValidMapping({ sku: 0, title: 7 }, headers)).toThrow(/does not exist/);
    expect(() => assertValidMapping({ sku: 0, title: 1 }, headers)).not.toThrow();
  });

  it('extracts trimmed mapped values, keeping empty mapped fields', () => {
    expect(extractValues(['  A-1 ', '', 'ignored'], { sku: 0, title: 1 })).toEqual({ sku: 'A-1', title: '' });
  });
});
