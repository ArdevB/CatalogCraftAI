import type {
  IssueSummary,
  ProductValues,
  RowStatus,
  StandardField,
  ValidationIssue,
} from '@catalogcraft/shared';
import { fieldLabel } from '@catalogcraft/shared';
import { checkPrice, isCurrencyCode, isHttpUrl, isValidGtin, isWholeNumber } from './field-rules.js';

export type RowInput = { rowNumber: number; values: ProductValues };
export type RowResult = { rowNumber: number; issues: ValidationIssue[]; status: RowStatus; sourceIdentifier: string | null };

export type ValidationOptions = {
  /** From the client's brand profile. */
  maxTitleLength: number;
};

const LONG_DESCRIPTION = 5_000;
const LONG_FIELD = 1_000;

/** Shortens long values when quoting them in a message. */
function quote(value: string): string {
  return `“${value.length > 40 ? `${value.slice(0, 37)}…` : value}”`;
}

function rowList(rowNumbers: number[]): string {
  const shown = rowNumbers.slice(0, 5).join(', ');
  return rowNumbers.length > 5 ? `${shown} and ${rowNumbers.length - 5} more` : shown;
}

function groupBy(rows: RowInput[], key: (row: RowInput) => string | undefined): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const value = key(row);
    if (!value) continue;
    groups.set(value, [...(groups.get(value) ?? []), row.rowNumber]);
  }
  return groups;
}

export function rowStatus(issues: ValidationIssue[]): RowStatus {
  if (issues.some((issue) => issue.severity === 'error')) return 'error';
  if (issues.some((issue) => issue.severity === 'warning')) return 'warning';
  return 'valid';
}

/**
 * Deterministic validation of imported rows. Never changes a value — it only
 * reports problems so the user can decide what to do.
 *
 * Errors mark rows that can't be used safely (no identifier, duplicate SKU,
 * unreadable price). Warnings are worth a look. Info is just a note.
 */
export function validateRows(rows: RowInput[], options: ValidationOptions): RowResult[] {
  const has = (field: StandardField) => rows.some((row) => row.values[field] !== undefined);
  const skuMapped = has('sku');
  const variantsMapped = has('variantId');

  const skuGroups = groupBy(rows, (row) => row.values.sku?.toLowerCase());
  // Variant rows legitimately share a product ID; only check it when it is the identifier.
  const productIdGroups = !skuMapped && !variantsMapped ? groupBy(rows, (row) => row.values.productId?.toLowerCase()) : null;
  const variantGroups = groupBy(rows, (row) => row.values.variantId?.toLowerCase());
  const knownIdentifiers = new Set(
    rows.flatMap((row) => [row.values.sku, row.values.productId]).filter(Boolean).map((id) => id!.toLowerCase()),
  );
  const firstRowWithContent = new Map<string, number>();

  return rows.map(({ rowNumber, values }) => {
    const issues: ValidationIssue[] = [];
    const add = (field: string, type: ValidationIssue['type'], severity: ValidationIssue['severity'], message: string) =>
      issues.push({ field, type, severity, message });

    const sku = values.sku ?? '';
    const productId = values.productId ?? '';

    // Identifiers
    if (!sku && !productId) {
      add(skuMapped ? 'sku' : 'productId', 'missing', 'error', 'Missing SKU and product ID, so this product cannot be identified.');
    } else if (skuMapped && !sku) {
      add('sku', 'missing', 'warning', 'SKU is empty; the product ID will be used to identify this row.');
    }
    if (sku) {
      const duplicates = skuGroups.get(sku.toLowerCase()) ?? [];
      if (duplicates.length > 1) {
        add('sku', 'duplicate', 'error', `SKU ${quote(sku)} appears in ${duplicates.length} rows (${rowList(duplicates)}).`);
      }
    }
    if (productIdGroups && productId) {
      const duplicates = productIdGroups.get(productId.toLowerCase()) ?? [];
      if (duplicates.length > 1) {
        add('productId', 'duplicate', 'error', `Product ID ${quote(productId)} appears in ${duplicates.length} rows (${rowList(duplicates)}).`);
      }
    }

    // Content
    if (values.title !== undefined) {
      if (!values.title) add('title', 'missing', 'warning', 'Title is empty.');
      else if (values.title.length > options.maxTitleLength) {
        add('title', 'invalid', 'warning', `Title is ${values.title.length} characters; this client’s limit is ${options.maxTitleLength}.`);
      }
    }
    if (values.description !== undefined && !values.description) {
      add('description', 'missing', 'info', 'Description is empty.');
    }

    // Commercial facts
    if (values.price !== undefined) {
      const price = values.price;
      switch (price ? checkPrice(price) : 'empty') {
        case 'empty':
          add('price', 'missing', 'warning', 'Price is empty.');
          break;
        case 'negative':
          add('price', 'invalid', 'error', `Price ${quote(price)} is negative.`);
          break;
        case 'currency-symbol':
          add('price', 'invalid', 'warning', `Price ${quote(price)} includes a currency symbol or code. Keep only the number and map the currency separately.`);
          break;
        case 'ambiguous':
          add('price', 'ambiguous', 'warning', `Price ${quote(price)} uses a comma as the decimal separator or a dot for thousands; check the amount is read correctly.`);
          break;
        case 'invalid':
          add('price', 'invalid', 'error', `Price ${quote(price)} is not a valid number.`);
          break;
        default:
          break;
      }
      if (price && values.currency !== undefined && !values.currency) {
        add('currency', 'missing', 'info', 'Currency is empty for a priced product.');
      }
    }
    if (values.currency && !isCurrencyCode(values.currency)) {
      add('currency', 'invalid', 'warning', `Currency ${quote(values.currency)} should be a 3-letter code such as USD or EUR.`);
    }
    if (values.stockQuantity) {
      if (!isWholeNumber(values.stockQuantity)) {
        add('stockQuantity', 'invalid', 'warning', `Stock quantity ${quote(values.stockQuantity)} is not a whole number.`);
      } else if (values.stockQuantity.trim().startsWith('-')) {
        add('stockQuantity', 'inconsistent', 'warning', `Stock quantity ${quote(values.stockQuantity)} is negative.`);
      }
    }
    if (values.barcode && !isValidGtin(values.barcode)) {
      add('barcode', 'invalid', 'warning', `Barcode ${quote(values.barcode)} is not a valid EAN/UPC (wrong length or check digit — Excel may have removed a leading zero).`);
    }
    if (values.imageUrl && !isHttpUrl(values.imageUrl)) {
      add('imageUrl', 'invalid', 'warning', `Image URL ${quote(values.imageUrl)} is not a valid http(s) link.`);
    }

    // Variants
    if (values.variantId) {
      const duplicates = variantGroups.get(values.variantId.toLowerCase()) ?? [];
      if (duplicates.length > 1) {
        add('variantId', 'duplicate', 'error', `Variant ID ${quote(values.variantId)} appears in ${duplicates.length} rows (${rowList(duplicates)}).`);
      }
    }
    if (values.parentId) {
      const parent = values.parentId.toLowerCase();
      if (parent === sku.toLowerCase() && parent !== '') {
        add('parentId', 'inconsistent', 'warning', 'This product lists itself as its own parent.');
      } else if (!knownIdentifiers.has(parent)) {
        add('parentId', 'inconsistent', 'warning', `Parent ${quote(values.parentId)} is not a SKU or product ID in this file.`);
      }
    }

    // Suspiciously long values (often a broken export or merged cells)
    for (const [field, value] of Object.entries(values) as Array<[StandardField, string]>) {
      const limit = field === 'description' ? LONG_DESCRIPTION : LONG_FIELD;
      if (value.length > limit) {
        add(field, 'invalid', 'warning', `${fieldLabel(field)} is unusually long (${value.length} characters).`);
      }
    }

    // Exact duplicate rows
    const signature = JSON.stringify(values);
    const firstRow = firstRowWithContent.get(signature);
    if (firstRow === undefined) firstRowWithContent.set(signature, rowNumber);
    else add('row', 'duplicate', 'warning', `This row is an exact duplicate of row ${firstRow}.`);

    return { rowNumber, issues, status: rowStatus(issues), sourceIdentifier: sku || productId || null };
  });
}

/** Counts issues by field + type + severity for the job's validation report. */
export function summarizeIssues(results: RowResult[]): IssueSummary[] {
  const summary = new Map<string, IssueSummary>();
  for (const issue of results.flatMap((result) => result.issues)) {
    const key = `${issue.severity}|${issue.field}|${issue.type}`;
    const existing = summary.get(key);
    if (existing) existing.count += 1;
    else summary.set(key, { field: issue.field, type: issue.type, severity: issue.severity, count: 1, example: issue.message });
  }
  const severityOrder = { error: 0, warning: 1, info: 2 } as const;
  return [...summary.values()].sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity] || b.count - a.count,
  );
}
