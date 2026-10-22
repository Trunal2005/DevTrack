import { describe, expect, it } from 'vitest';
import {
  getResumePollingDelay,
  MAX_RESUME_RETRY_DELAY_MS,
  RESUME_POLL_INTERVAL_MS,
} from './resumePolling';

describe('getResumePollingDelay', () => {
  it('uses the normal interval for non-rate-limit failures', () => {
    expect(getResumePollingDelay({ statusCode: 503 })).toBe(RESUME_POLL_INTERVAL_MS);
  });

  it('honors Retry-After seconds from normalized 429 responses', () => {
    expect(getResumePollingDelay({ statusCode: 429, retryAfter: 30 })).toBe(30_000);
  });

  it('bounds invalid, short, and excessive retry delays', () => {
    expect(getResumePollingDelay({ statusCode: 429, retryAfter: 'invalid' })).toBe(RESUME_POLL_INTERVAL_MS);
    expect(getResumePollingDelay({ statusCode: 429, retryAfter: 0.1 })).toBe(RESUME_POLL_INTERVAL_MS);
    expect(getResumePollingDelay({ statusCode: 429, retryAfter: 600 })).toBe(MAX_RESUME_RETRY_DELAY_MS);
  });
});
