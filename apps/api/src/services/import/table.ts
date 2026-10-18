import { HEADER_ROW_MAX } from '@catalogcraft/shared';
import { AppError } from '../../utils/app-error.js';

export type DataRow = {
  /** 1-based row number as shown in Excel / a text editor. */
  rowNumber: number;
  /** Exactly as in the file (not trimmed), one per column. */
  values: string[];
};

export type DataTable = {
  headers: string[];
  rows: DataRow[];
  /** Completely blank rows below the header. Reported, never silently dropped. */
  skippedEmptyRows: number;
};

/**
 * Turns raw sheet rows into headers + data rows.
 *
 * - Rows above the chosen header row (e.g. a title or notes) are ignored.
 * - Blank header cells become "Column 3"; repeated names become "Price (2)",
 *   so every column can be told apart in the mapping screen.
 * - Columns that only have data below the header (no header text) still get a
 *   name, so no value is lost.
 */
export function buildTable(sheetRows: string[][], headerRow: number): DataTable {
  if (headerRow < 1 || headerRow > HEADER_ROW_MAX) {
    throw new AppError('VALIDATION_ERROR', `Header row must be between 1 and ${HEADER_ROW_MAX}.`);
  }
  if (headerRow > sheetRows.length) {
    throw new AppError('INVALID_FILE', `Row ${headerRow} is past the end of the sheet, which has ${sheetRows.length} rows.`);
  }

  const width = Math.max(0, ...sheetRows.slice(headerRow - 1).map((row) => row.length));
  const rawHeaders = sheetRows[headerRow - 1] ?? [];
  const seen = new Map<string, number>();
  const headers = Array.from({ length: width }, (_, index) => {
    const base = (rawHeaders[index] ?? '').trim() || `Column ${index + 1}`;
    const count = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), count);
    return count === 1 ? base : `${base} (${count})`;
  });

  if (headers.length === 0 || rawHeaders.every((cell) => cell.trim() === '')) {
    throw new AppError('INVALID_FILE', `Row ${headerRow} is empty. Choose the row that contains the column names.`);
  }

  const rows: DataRow[] = [];
  let skippedEmptyRows = 0;
  for (let index = headerRow; index < sheetRows.length; index += 1) {
    const raw = sheetRows[index] ?? [];
    if (raw.every((cell) => cell.trim() === '')) {
      skippedEmptyRows += 1;
      continue;
    }
    rows.push({ rowNumber: index + 1, values: Array.from({ length: width }, (_, column) => raw[column] ?? '') });
  }

  // Blank rows at the very end of a sheet are just formatting, not data gaps.
  let trailing = sheetRows.length - 1;
  while (trailing >= headerRow && (sheetRows[trailing] ?? []).every((cell) => cell.trim() === '')) {
    trailing -= 1;
    skippedEmptyRows -= 1;
  }

  return { headers, rows, skippedEmptyRows: Math.max(0, skippedEmptyRows) };
}
