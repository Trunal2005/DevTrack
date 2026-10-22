import { afterEach, describe, expect, it, vi } from 'vitest';
import { getResumePollingDelay } from './resumePolling';

afterEach(() => vi.restoreAllMocks());

describe('resume polling retry delays', () => {
  it('honors server seconds including a ten-minute processing block', () => {
    expect(getResumePollingDelay({ statusCode: 429, retryAfter: '30' }, 1)).toBe(30_000);
    expect(getResumePollingDelay({ statusCode: 429, retryAfter: 600 }, 1)).toBe(600_000);
  });

  it('honors HTTP dates', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-22T00:00:00Z'));
    expect(getResumePollingDelay({ statusCode: 429, retryAfter: 'Thu, 22 Oct 2026 00:02:00 GMT' }, 1)).toBe(120_000);
  });

  it.each([undefined, '', 'invalid', -1, 0, Infinity])('backs off for an unusable Retry-After value %s', retryAfter => {
    expect(getResumePollingDelay({ statusCode: 429, retryAfter }, 1)).toBe(3_000);
    expect(getResumePollingDelay({ statusCode: 429, retryAfter }, 2)).toBe(6_000);
    expect(getResumePollingDelay({ statusCode: 429, retryAfter }, 100)).toBe(60_000);
  });

  it('bounds retries for network/server failures too', () => {
    expect(getResumePollingDelay(new Error('offline'), 1)).toBe(3_000);
    expect(getResumePollingDelay({ statusCode: 503 }, 100)).toBe(60_000);
  });
});
