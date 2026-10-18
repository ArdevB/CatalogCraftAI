import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { objectIdSchema, paginationQuerySchema } from '@catalogcraft/shared';
import { AppError } from '../src/utils/app-error.js';
import { validateRequest } from '../src/utils/validate-request.js';

function fakeRequest(parts: Partial<Pick<Request, 'body' | 'params' | 'query'>>): Request {
  return { body: undefined, params: {}, query: {}, ...parts } as Request;
}

const schemas = {
  params: z.object({ clientId: objectIdSchema }),
  query: paginationQuerySchema,
  body: z.object({ name: z.string().trim().min(1).max(120) }),
};

describe('validateRequest', () => {
  it('returns parsed, coerced values and strips unknown keys', () => {
    const result = validateRequest(
      fakeRequest({
        params: { clientId: '64b7f0c2a1b2c3d4e5f60718' },
        query: { page: '2' },
        body: { name: '  Acme  ', organizationId: 'attacker-supplied' },
      }),
      schemas,
    );

    expect(result.params.clientId).toBe('64b7f0c2a1b2c3d4e5f60718');
    expect(result.query).toEqual({ page: 2, pageSize: 25 });
    expect(result.body).toEqual({ name: 'Acme' });
  });

  it('collects every problem across params, query and body', () => {
    try {
      validateRequest(fakeRequest({ params: { clientId: 'nope' }, query: { page: '0' }, body: {} }), schemas);
      expect.unreachable('validateRequest should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.code).toBe('VALIDATION_ERROR');
      expect(appError.statusCode).toBe(400);
      expect(appError.details?.map((d) => d.path)).toEqual(['params.clientId', 'query.page', 'body.name']);
    }
  });

  it('treats a missing body as an empty object', () => {
    expect(() => validateRequest(fakeRequest({}), { body: z.object({ name: z.string() }) })).toThrow(AppError);
  });
});
