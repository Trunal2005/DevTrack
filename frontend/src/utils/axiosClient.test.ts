import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';
import axiosClient from './axiosClient';

describe('rate-limit error normalization', () => {
  it.each([
    ['30', 600, '30'],
    ['Thu, 22 Oct 2026 00:02:00 GMT', undefined, 'Thu, 22 Oct 2026 00:02:00 GMT'],
    [undefined, 600, 600],
  ])('preserves Retry-After %s with body fallback %s', async (header, body, expected) => {
    await expect(axiosClient.get('/fixture/status', {
      adapter: async config => {
        throw new AxiosError('Too many requests', 'ERR_BAD_REQUEST', config, undefined, {
          config, status: 429, statusText: 'Too Many Requests',
          headers: new AxiosHeaders(header === undefined ? {} : { 'retry-after': header }),
          data: { code: 'RATE_LIMIT_EXCEEDED', retryAfter: body },
        });
      },
    })).rejects.toMatchObject({ statusCode: 429, retryAfter: expected });
  });
});
