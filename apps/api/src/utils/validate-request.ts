import type { Request } from 'express';
import type { z } from 'zod';
import type { ValidationIssueDetail } from '@catalogcraft/shared';
import { AppError } from './app-error.js';

type RequestSchemas = {
  body?: z.ZodType;
  params?: z.ZodType;
  query?: z.ZodType;
};

type ParsedRequest<S extends RequestSchemas> = {
  [K in keyof S]: S[K] extends z.ZodType ? z.infer<S[K]> : never;
};

/**
 * Validates the parts of a request a handler cares about and returns fully
 * typed, parsed values. Unknown keys are stripped by Zod object schemas, so
 * handlers only ever see fields they declared.
 *
 *   const { params, body } = validateRequest(req, { params: idParams, body: updateSchema });
 *
 * Throws a 400 VALIDATION_ERROR listing every problem found.
 */
export function validateRequest<S extends RequestSchemas>(req: Request, schemas: S): ParsedRequest<S> {
  const parsed: Record<string, unknown> = {};
  const details: ValidationIssueDetail[] = [];

  for (const part of ['params', 'query', 'body'] as const) {
    const schema = schemas[part];
    if (!schema) continue;

    const result = schema.safeParse(req[part] ?? {});
    if (result.success) {
      parsed[part] = result.data;
    } else {
      for (const issue of result.error.issues) {
        details.push({ path: [part, ...issue.path.map(String)].join('.'), message: issue.message });
      }
    }
  }

  if (details.length > 0) {
    throw new AppError('VALIDATION_ERROR', 'The request contains invalid data.', { details });
  }

  return parsed as ParsedRequest<S>;
}
