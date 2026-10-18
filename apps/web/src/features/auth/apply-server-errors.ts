import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from '@/lib/api-client';

const stripBody = (path: string) => path.replace(/^body\./, '');

/**
 * Shows server-side validation errors (e.g. `body.email`) next to the matching
 * form field. `toField` maps an API path to a form field name when they differ.
 * Returns true if at least one field error was applied.
 */
export function applyServerFieldErrors<T extends FieldValues>(
  error: unknown,
  fields: readonly Path<T>[],
  setError: UseFormSetError<T>,
  toField: (apiPath: string) => string = stripBody,
): boolean {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_ERROR') return false;
  let applied = false;
  for (const detail of error.details) {
    const field = toField(detail.path) as Path<T>;
    if (fields.includes(field)) {
      setError(field, { type: 'server', message: detail.message });
      applied = true;
    }
  }
  return applied;
}
