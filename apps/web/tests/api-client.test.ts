import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiError, apiRequest } from '@/lib/api-client';
import { jsonResponse, mockFetch } from './utils';

const schema = z.object({ id: z.string() });

describe('apiRequest', () => {
  it('returns validated data and sends cookies', async () => {
    const fetchMock = mockFetch(jsonResponse({ success: true, data: { id: 'abc' } }));

    await expect(apiRequest('/things/abc', schema)).resolves.toEqual({ id: 'abc' });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/things/abc', expect.objectContaining({ credentials: 'include' }));
  });

  it('sends JSON bodies with the right content type', async () => {
    const fetchMock = mockFetch(jsonResponse({ success: true, data: { id: 'new' } }, 201));

    await apiRequest('/things', schema, { method: 'POST', body: { name: 'x' } });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"name":"x"}');
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('throws ApiError with the server error code and details', async () => {
    mockFetch(
      jsonResponse(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid.', details: [{ path: 'body.name', message: 'Required' }] },
        },
        400,
      ),
    );

    const error = await apiRequest('/things', schema).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'VALIDATION_ERROR', status: 400, message: 'Invalid.' });
    expect((error as ApiError).details).toHaveLength(1);
  });

  it('reports network failures clearly', async () => {
    mockFetch(new TypeError('Failed to fetch'));
    await expect(apiRequest('/things', schema)).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: null });
  });

  it('rejects responses that do not match the schema instead of passing bad data on', async () => {
    mockFetch(jsonResponse({ success: true, data: { id: 42 } }));
    await expect(apiRequest('/things', schema)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('rejects non-JSON responses (e.g. a proxy error page)', async () => {
    mockFetch(new Response('<html>Bad Gateway</html>', { status: 502 }));
    await expect(apiRequest('/things', schema)).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 502 });
  });
});
