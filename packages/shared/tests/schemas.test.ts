import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  apiErrorResponseSchema,
  apiSuccessResponseSchema,
  buildPaginationMeta,
  healthSchema,
  objectIdSchema,
  paginationQuerySchema,
} from '../src/index.js';

describe('objectIdSchema', () => {
  it('accepts a 24-character hex id', () => {
    expect(objectIdSchema.safeParse('64b7f0c2a1b2c3d4e5f60718').success).toBe(true);
  });

  it.each(['', '123', '64b7f0c2a1b2c3d4e5f6071z', '../../etc/passwd', '64b7f0c2a1b2c3d4e5f607181'])(
    'rejects %j',
    (value) => {
      expect(objectIdSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('paginationQuerySchema', () => {
  it('applies defaults when values are missing', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25 });
  });

  it('coerces query-string numbers', () => {
    expect(paginationQuerySchema.parse({ page: '3', pageSize: '50' })).toEqual({ page: 3, pageSize: 50 });
  });

  it('rejects page sizes above the maximum and non-positive pages', () => {
    expect(paginationQuerySchema.safeParse({ pageSize: '1000' }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ page: 'abc' }).success).toBe(false);
  });

  it('builds pagination metadata', () => {
    expect(buildPaginationMeta({ page: 2, pageSize: 25 }, 51)).toEqual({
      page: 2,
      pageSize: 25,
      totalItems: 51,
      totalPages: 3,
    });
  });
});

describe('response envelopes', () => {
  it('validates a success envelope with typed data', () => {
    const schema = apiSuccessResponseSchema(z.object({ id: z.string() }));
    expect(schema.safeParse({ success: true, data: { id: 'a' } }).success).toBe(true);
    expect(schema.safeParse({ success: true, data: { id: 1 } }).success).toBe(false);
  });

  it('validates an error envelope and rejects unknown error codes', () => {
    expect(
      apiErrorResponseSchema.safeParse({
        success: false,
        error: { code: 'INVALID_FILE', message: 'The uploaded file could not be processed.' },
      }).success,
    ).toBe(true);
    expect(
      apiErrorResponseSchema.safeParse({ success: false, error: { code: 'NOPE', message: 'x' } }).success,
    ).toBe(false);
  });

  it('validates the health payload', () => {
    const result = healthSchema.safeParse({
      status: 'ok',
      service: 'catalogcraft-api',
      version: '0.1.0',
      environment: 'test',
      uptimeSeconds: 1.5,
      timestamp: new Date().toISOString(),
      checks: { database: 'connected' },
    });
    expect(result.success).toBe(true);
  });
});
