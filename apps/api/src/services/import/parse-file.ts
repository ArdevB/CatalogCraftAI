import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { AppError } from '../../utils/app-error.js';
import { inspectZip } from './zip-guard.js';

export type FileKind = 'csv' | 'xlsx';
export type ParsedSheet = { name: string; rows: string[][]; truncated: boolean };
export type ParsedFile = { fileType: FileKind; sheets: ParsedSheet[]; notices: string[] };

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]); // legacy .xls/.doc

function invalidFile(message: string): AppError {
  return new AppError('INVALID_FILE', message);
}

/**
 * Decides how to read an upload from its extension AND its first bytes. The
 * extension alone is not trusted: a renamed executable or a .xls saved as
 * ".xlsx" is rejected with a clear message.
 */
export function detectFileType(filename: string, data: Buffer): FileKind {
  if (data.length === 0) throw invalidFile('The file is empty.');
  const extension = filename.toLowerCase().split('.').pop() ?? '';
  const isZip = data.subarray(0, 4).equals(ZIP_MAGIC);
  const isOle = data.subarray(0, 4).equals(OLE_MAGIC);

  if (extension === 'xls' || (isOle && extension !== 'csv')) {
    throw invalidFile('Older .xls files are not supported. Open the file in Excel and save it as .xlsx or CSV.');
  }
  if (['xlsm', 'xlsb', 'xltm', 'xltx'].includes(extension)) {
    throw invalidFile('Macro-enabled and binary workbooks are not supported. Save the file as .xlsx or CSV.');
  }
  if (extension === 'xlsx') {
    if (!isZip) throw invalidFile('This file has an .xlsx name but is not a valid Excel workbook.');
    return 'xlsx';
  }
  if (extension === 'csv') {
    if (isZip || isOle) throw invalidFile('This file has a .csv name but is actually a spreadsheet. Rename it to .xlsx.');
    if (data.subarray(0, 8192).includes(0) && !hasUtf16Bom(data)) {
      throw invalidFile('This file contains binary data and is not a text CSV file.');
    }
    return 'csv';
  }
  throw invalidFile('Unsupported file type. Upload a .csv or .xlsx file.');
}

function hasUtf16Bom(data: Buffer): boolean {
  return (data[0] === 0xff && data[1] === 0xfe) || (data[0] === 0xfe && data[1] === 0xff);
}

/** Reads text as UTF-8; falls back to Windows-1252 (common for Excel CSV exports) with a notice. */
function decodeText(data: Buffer): { text: string; notice?: string } {
  if (data[0] === 0xff && data[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(data.subarray(2)) };
  if (data[0] === 0xfe && data[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(data.subarray(2)) };
  const body = data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf ? data.subarray(3) : data;
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(body) };
  } catch {
    return {
      text: new TextDecoder('windows-1252').decode(body),
      notice: 'The file is not UTF-8 encoded, so it was read as Windows-1252. Check that accented characters look right.',
    };
  }
}

/** Picks the delimiter that appears most often (outside quotes) in the first non-empty line. */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim() !== '') ?? '';
  const unquoted = firstLine.replace(/"[^"]*"/g, '');
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestCount = 0;
  for (const candidate of candidates) {
    const count = unquoted.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

function parseCsvFile(data: Buffer, maxRows: number): ParsedFile {
  const { text, notice } = decodeText(data);
  let records: string[][];
  try {
    records = parseCsv(text, {
      delimiter: detectDelimiter(text),
      relax_column_count: true,
      // Supplier files often contain stray quotes (6" pipe, ="formula"); keep them as text.
      relax_quotes: true,
      skip_empty_lines: false,
      to_line: maxRows + 1,
    }) as string[][];
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    throw invalidFile(`The CSV file could not be read: ${detail}`);
  }
  const truncated = records.length > maxRows;
  return {
    fileType: 'csv',
    sheets: [{ name: 'CSV', rows: truncated ? records.slice(0, maxRows) : records, truncated }],
    notices: notice ? [notice] : [],
  };
}

/* ------------------------------------------------------------------ XLSX */

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function formatDate(date: Date): string {
  const iso = date.toISOString();
  // Dates without a time of day are shown as plain dates.
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
}

/**
 * Converts any Excel cell value to text. Formulas are NEVER evaluated: we use
 * the result Excel saved in the file (or nothing, if there is none).
 */
export function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : formatDate(value);
  if (isObject(value)) {
    if ('formula' in value || 'sharedFormula' in value) return cellToString(value.result);
    if (Array.isArray(value.richText)) {
      return value.richText.map((part: unknown) => (isObject(part) ? cellToString(part.text) : '')).join('');
    }
    if ('text' in value) return cellToString(value.text); // hyperlinks
    if ('error' in value) return ''; // #N/A, #DIV/0!, …
  }
  return '';
}

/** Unpacked workbooks bigger than this are refused (protects against zip bombs). */
const MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;

async function parseXlsxFile(data: Buffer, maxRows: number): Promise<ParsedFile> {
  const zip = inspectZip(data, { maxUncompressedBytes: MAX_UNCOMPRESSED_BYTES, maxEntries: 5_000 });
  if (!zip.ok) throw invalidFile(`The Excel file could not be read: ${zip.reason}.`);

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(data as unknown as ArrayBuffer);
  } catch {
    throw invalidFile('The Excel file could not be read. It may be damaged or password-protected.');
  }

  const sheets: ParsedSheet[] = workbook.worksheets.map((worksheet) => {
    const lastRow = worksheet.actualRowCount === 0 ? 0 : worksheet.rowCount;
    const rows: string[][] = [];
    // Read by row number (not just non-empty rows) so numbers match what the user sees in Excel.
    for (let rowNumber = 1; rowNumber <= Math.min(lastRow, maxRows); rowNumber += 1) {
      const values = worksheet.getRow(rowNumber).values;
      rows.push(Array.isArray(values) ? Array.from(values.slice(1), (cell) => cellToString(cell)) : []);
    }
    return { name: worksheet.name, rows, truncated: lastRow > maxRows };
  });

  if (sheets.length === 0) throw invalidFile('The workbook does not contain any worksheets.');
  return { fileType: 'xlsx', sheets, notices: [] };
}

/** Reads every sheet of an upload into rows of text, keeping at most `maxRows` rows per sheet. */
export async function parseFile(data: Buffer, fileType: FileKind, options: { maxRows: number }): Promise<ParsedFile> {
  return fileType === 'csv' ? parseCsvFile(data, options.maxRows) : parseXlsxFile(data, options.maxRows);
}
