/**
 * Small, pure checks for individual values. Kept in normal code (never the
 * LLM) because numbers, identifiers and uniqueness must be decided exactly.
 */

export type PriceCheck = 'valid' | 'negative' | 'currency-symbol' | 'ambiguous' | 'invalid';

/**
 * Accepts "12", "12.5", "1,234.50". Flags "12,50" / "1.234,56" as ambiguous
 * (a decimal comma could mean 12.50 or 1250), currency symbols as fixable,
 * and anything else as invalid.
 */
export function checkPrice(raw: string): PriceCheck {
  const value = raw.trim();
  if (/^\d+(\.\d+)?$/.test(value) || /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(value)) return 'valid';
  if (/^-\s*\d/.test(value)) return 'negative';
  // A symbol or 3-letter code next to an actual number, e.g. "$12.99" or "12.99 USD".
  if (/\d/.test(value) && (/[£$€¥₹]/.test(value) || /(^|\s)[A-Za-z]{3}(\s|$)/.test(value))) return 'currency-symbol';
  if (/^\d+,\d{1,2}$/.test(value) || /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(value)) return 'ambiguous';
  return 'invalid';
}

/**
 * GTIN (EAN-8, UPC-A, EAN-13, GTIN-14) check-digit validation. A wrong check
 * digit usually means a typo — or Excel dropping a leading zero.
 */
export function isValidGtin(raw: string): boolean {
  const digits = raw.trim();
  if (!/^\d+$/.test(digits) || ![8, 12, 13, 14].includes(digits.length)) return false;
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let i = 0; i < body.length; i += 1) {
    // Weights alternate 3,1,3,1… starting from the digit next to the check digit.
    const digit = Number(body[body.length - 1 - i]);
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1));
}

export function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw.trim());
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.includes('.');
  } catch {
    return false;
  }
}

export function isCurrencyCode(raw: string): boolean {
  return /^[A-Za-z]{3}$/.test(raw.trim());
}

export function isWholeNumber(raw: string): boolean {
  return /^-?\d+$/.test(raw.trim());
}
