import {
  ENRICHABLE_FIELD_KEYS,
  fieldLabel,
  STANDARD_FIELDS,
  type ColumnMapping,
  type EnrichableField,
  type RowStatus,
  type StandardField,
  type SuggestionStatus,
} from '@catalogcraft/shared';
import { neutralizeCell } from './csv-safety.js';

export type ExportRowInput = {
  rowNumber: number;
  status: RowStatus;
  /** Every cell exactly as imported. */
  sourceValues: string[];
  suggestions: Array<{ field: string; status: SuggestionStatus; value: string; editedValue?: string | null }>;
};

export type ExportOptions = {
  fields: StandardField[];
  includeUnmappedColumns: boolean;
  includeErrorRows: boolean;
};

export type BuiltExport = { header: string[]; records: string[][]; changedCells: number };

type Column =
  | { kind: 'source'; header: string; index: number; field: StandardField | null }
  | { kind: 'added'; header: string; field: EnrichableField };

const isEnrichable = (field: string | null): field is EnrichableField =>
  field !== null && (ENRICHABLE_FIELD_KEYS as readonly string[]).includes(field);

/** The value a reviewer accepted for this field, or null when there is none. */
function acceptedValue(row: ExportRowInput, field: EnrichableField): string | null {
  const suggestion = row.suggestions.find((candidate) => candidate.field === field);
  if (suggestion?.status === 'approved') return suggestion.value;
  if (suggestion?.status === 'edited' && suggestion.editedValue) return suggestion.editedValue;
  return null; // pending, rejected or failed suggestions are never exported
}

/**
 * Builds the export table.
 *
 * - Columns keep the supplier file's order, so the result re-imports cleanly
 *   wherever the original came from. Requested content fields that weren't in
 *   the file (e.g. a new SEO title) are added at the end.
 * - Only approved or edited suggestions replace content fields. Every other
 *   cell — SKUs, prices, stock, barcodes, variant links — is copied exactly
 *   as imported.
 * - Every cell (and header) is protected against formula injection.
 */
export function buildExport(input: {
  headers: string[];
  mapping: ColumnMapping;
  rows: ExportRowInput[];
  options: ExportOptions;
}): BuiltExport {
  const { headers, mapping, options } = input;
  const fieldByColumn = new Map<number, StandardField>();
  for (const [field, column] of Object.entries(mapping) as Array<[StandardField, number]>) fieldByColumn.set(column, field);
  const requested = new Set(options.fields);

  const columns: Column[] = [];
  headers.forEach((header, index) => {
    const field = fieldByColumn.get(index) ?? null;
    if (field ? requested.has(field) : options.includeUnmappedColumns) columns.push({ kind: 'source', header, index, field });
  });
  const rows = input.rows
    .filter((row) => options.includeErrorRows || row.status !== 'error')
    .sort((a, b) => a.rowNumber - b.rowNumber);

  // Content fields the file didn't have, when at least one product has an
  // approved value for them. (Only content fields, and never an all-empty
  // column: an empty "Price" or "SEO title" column would just be confusing.)
  for (const { key } of STANDARD_FIELDS) {
    if (
      requested.has(key) &&
      mapping[key] === undefined &&
      isEnrichable(key) &&
      rows.some((row) => acceptedValue(row, key) !== null)
    ) {
      columns.push({ kind: 'added', header: fieldLabel(key), field: key });
    }
  }

  let changedCells = 0;
  const records = rows.map((row) =>
      columns.map((column) => {
        const field = column.field;
        const accepted = isEnrichable(field) ? acceptedValue(row, field) : null;
        if (accepted !== null) changedCells += 1;
        const value = accepted ?? (column.kind === 'source' ? (row.sourceValues[column.index] ?? '') : '');
        return neutralizeCell(value);
      }),
    );

  return { header: columns.map((column) => neutralizeCell(column.header)), records, changedCells };
}
