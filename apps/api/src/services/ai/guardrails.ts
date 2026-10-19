import type { BrandProfile, EnrichableField, SuggestionStatus } from '@catalogcraft/shared';

/**
 * Deterministic checks applied to every AI suggestion before it is saved.
 * The model is instructed not to invent facts, but instructions are not a
 * guarantee — these checks catch common failures in plain code.
 *
 * A `failed` suggestion is stored for transparency but can never be approved.
 */
export type CheckedSuggestion = { value: string; status: Extract<SuggestionStatus, 'pending' | 'failed'>; warnings: string[] };

const LENGTH_WARNINGS: Partial<Record<EnrichableField, number>> = { seoTitle: 60, seoDescription: 160 };
const MAX_DESCRIPTION = 5_000;
const MAX_TAGS = 15;
const MAX_TAG_LENGTH = 40;

function normalizeTags(value: string | string[]): string {
  const tags = (Array.isArray(value) ? value : value.split(','))
    .map((tag) => tag.trim().toLowerCase().replace(/\s+/g, ' '))
    .filter((tag) => tag.length > 0 && tag.length <= MAX_TAG_LENGTH);
  return [...new Set(tags)].slice(0, MAX_TAGS).join(', ');
}

function normalize(field: EnrichableField, value: string | string[]): string {
  if (field === 'tags') return normalizeTags(value);
  const text = (Array.isArray(value) ? value.join(' ') : value).trim();
  // Titles and SEO fields are single lines; descriptions keep their paragraphs.
  return field === 'description' ? text.replace(/\n{3,}/g, '\n\n') : text.replace(/\s+/g, ' ');
}

/** Numbers like "350", "1.5" or "2,5" — compared without separators. */
function numbersIn(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(',', '.'));
}

export function checkSuggestion(input: {
  field: EnrichableField;
  value: string | string[];
  original: string | undefined;
  /** All product facts that were sent to the AI, used to spot invented numbers. */
  sourceText: string;
  brandProfile: BrandProfile;
}): CheckedSuggestion {
  const value = normalize(input.field, input.value);
  const warnings: string[] = [];
  const fail = (reason: string): CheckedSuggestion => ({ value, status: 'failed', warnings: [reason, ...warnings] });

  if (!value) return fail('The AI returned an empty value.');

  const lower = value.toLowerCase();
  for (const claim of input.brandProfile.prohibitedClaims) {
    if (claim.trim() && lower.includes(claim.trim().toLowerCase())) {
      return fail(`Uses the prohibited claim “${claim}”.`);
    }
  }
  if (input.field === 'description' && value.length > MAX_DESCRIPTION) {
    return fail(`The description is ${value.length} characters, longer than the ${MAX_DESCRIPTION}-character limit.`);
  }

  const limit = input.field === 'title' ? input.brandProfile.maxTitleLength : LENGTH_WARNINGS[input.field];
  if (limit !== undefined && value.length > limit) {
    warnings.push(`${value.length} characters — over the ${limit}-character limit.`);
  }
  if (/<\/?[a-z][^>]*>/i.test(value)) warnings.push('Contains HTML markup.');

  // A number the source never mentions is the clearest sign of an invented spec.
  const known = new Set(numbersIn(input.sourceText));
  const invented = [...new Set(numbersIn(value))].filter((n) => !known.has(n));
  if (invented.length > 0) {
    warnings.push(
      `Mentions ${invented.map((n) => `“${n}”`).join(', ')}, which ${invented.length === 1 ? "doesn't" : "don't"} appear in the product data. Check before approving.`,
    );
  }

  if (input.original && input.original.trim().toLowerCase() === value.toLowerCase()) {
    warnings.push('Same as the original value.');
  }
  return { value, status: 'pending', warnings };
}
