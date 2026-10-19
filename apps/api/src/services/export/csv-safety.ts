/**
 * Spreadsheet formula injection: when a CSV is opened in Excel or Google
 * Sheets, a cell starting with "=", "+", "-" or "@" is treated as a formula.
 * Supplier data (or AI text) like `=HYPERLINK("http://evil", "Click")` could
 * then run in the agency's spreadsheet.
 *
 * Following OWASP's advice, such cells are prefixed with a single quote so
 * the spreadsheet shows them as plain text. Plain numbers such as "-3" or
 * "+12.50" can't be formulas and are left exactly as they are, so protected
 * numeric values (stock, prices) are never altered.
 */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?(\d+([.,]\d+)*|[.,]\d+)$/;

export function neutralizeCell(value: string): string {
  if (!FORMULA_TRIGGER.test(value)) return value;
  if (PLAIN_NUMBER.test(value)) return value;
  return `'${value}`;
}
